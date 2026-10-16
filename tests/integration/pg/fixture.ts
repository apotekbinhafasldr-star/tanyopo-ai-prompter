import { randomUUID } from "node:crypto";
import { PsqlSession, type ExecResult } from "./psql-session";
import { pgTestEnabled, type PgConfig } from "./pg-env";

export const pgEnabled = pgTestEnabled();

/**
 * Shared helpers for the PostgreSQL concurrency tests (PR #38).
 *
 * The SQL below is the statement-for-statement equivalent of the PostgREST
 * requests the application issues in features/campaigns/launch-actions.ts
 * (claimChannelCampaignLaunch, persistLaunchProgress, recordLaunchFailure).
 * tests/unit/integration/claim-sql-drift.test.ts fails when the application's
 * predicates and the ones used here stop matching.
 */

/** Mirrors LAUNCH_IN_PROGRESS_NOTE (lib/campaigns/launch-reconciliation.ts); a unit test pins equality. */
export const IN_PROGRESS_NOTE =
  "Peluncuran sedang diproses. Jika status ini tidak berubah, periksa Meta Ads Manager sebelum meluncurkan ulang (rekonsiliasi manual).";

export const TABLE = "prompter_channel_campaigns";
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ALL_STATUSES = ["DRAFT", "AWAITING_APPROVAL", "SCHEDULED", "ACTIVE", "PAUSED", "COMPLETED", "FAILED"] as const;
export type Status = (typeof ALL_STATUSES)[number];

export function lit(value: string | null): string {
  return value === null ? "null" : `'${value.replace(/'/g, "''")}'`;
}

export interface ProgressPatch {
  status?: "ACTIVE";
  external_campaign_id?: string;
  error?: string | null;
}

export const stmt = {
  /** claimChannelCampaignLaunch: SCHEDULED -> FAILED(+note), id AND tenant AND status. */
  claim: (id: string, tenant: string) =>
    `update ${TABLE} set status = 'FAILED', error = ${lit(IN_PROGRESS_NOTE)} where id = ${lit(id)} and tenant_id = ${lit(tenant)} and status = 'SCHEDULED' returning id;`,

  /** persistLaunchProgress: only while the row is still FAILED (claimed). */
  progress: (id: string, tenant: string, patch: ProgressPatch) => {
    const sets: string[] = [];
    if (patch.status !== undefined) sets.push(`status = ${lit(patch.status)}`);
    if (patch.external_campaign_id !== undefined) sets.push(`external_campaign_id = ${lit(patch.external_campaign_id)}`);
    if (patch.error !== undefined) sets.push(`error = ${lit(patch.error)}`);
    return `update ${TABLE} set ${sets.join(", ")} where id = ${lit(id)} and tenant_id = ${lit(tenant)} and status = 'FAILED' returning id;`;
  },

  /** recordLaunchFailure, releasable branch: back to SCHEDULED only from FAILED. */
  release: (id: string, tenant: string) =>
    `update ${TABLE} set status = 'SCHEDULED', error = null, external_campaign_id = null where id = ${lit(id)} and tenant_id = ${lit(tenant)} and status = 'FAILED' returning id;`,

  /** recordLaunchFailure, non-releasable branch: keep the claim, record the outcome. */
  fail: (id: string, tenant: string, message: string, externalId: string | null) =>
    `update ${TABLE} set status = 'FAILED', error = ${lit(message)}, external_campaign_id = ${lit(externalId)} where id = ${lit(id)} and tenant_id = ${lit(tenant)} and status = 'FAILED' returning id;`,

  // ---- NEGATIVE CONTROLS: deliberately unsafe claims (never used by the app) ----

  /** The defect fixed in PR #35: only rewrote `error`, left the status SCHEDULED. */
  unsafeRewriteErrorOnly: (id: string, tenant: string) =>
    `update ${TABLE} set error = ${lit(IN_PROGRESS_NOTE)} where id = ${lit(id)} and tenant_id = ${lit(tenant)} returning id;`,

  /** Check-then-act: unconditional write after a separate read. */
  unsafeUnconditionalClaim: (id: string, tenant: string) =>
    `update ${TABLE} set status = 'FAILED', error = ${lit(IN_PROGRESS_NOTE)} where id = ${lit(id)} and tenant_id = ${lit(tenant)} returning id;`,

  /** Missing tenant predicate. */
  unsafeNoTenantClaim: (id: string) =>
    `update ${TABLE} set status = 'FAILED', error = ${lit(IN_PROGRESS_NOTE)} where id = ${lit(id)} and status = 'SCHEDULED' returning id;`,

  readStatus: (id: string) => `select status from ${TABLE} where id = ${lit(id)};`,
};

export interface RowState {
  tenant_id: string;
  status: Status;
  error: string | null;
  external_campaign_id: string | null;
}

export async function seedRow(
  admin: PsqlSession,
  opts: {
    tenant: string;
    id?: string;
    master?: string;
    channel?: "FACEBOOK" | "INSTAGRAM" | "TIKTOK" | "X" | "SEO";
    status?: Status;
    error?: string | null;
    externalId?: string | null;
  },
): Promise<string> {
  const id = opts.id ?? randomUUID();
  const result = await admin.exec(
    `insert into ${TABLE} (id, tenant_id, master_campaign_id, channel, status, error, external_campaign_id)
     values (${lit(id)}, ${lit(opts.tenant)}, ${lit(opts.master ?? randomUUID())}, ${lit(opts.channel ?? "FACEBOOK")},
             ${lit(opts.status ?? "SCHEDULED")}, ${lit(opts.error ?? null)}, ${lit(opts.externalId ?? null)});`,
  );
  if (result.error) throw new Error(`seedRow failed: ${result.error}`);
  return id;
}

export async function getRow(admin: PsqlSession, id: string): Promise<RowState> {
  const result = await admin.exec(
    `select row_to_json(t) from (select tenant_id, status, error, external_campaign_id from ${TABLE} where id = ${lit(id)}) t;`,
  );
  if (result.error || result.rows.length !== 1) throw new Error(`getRow failed: ${result.error ?? "no row"}`);
  return JSON.parse(result.rows[0]) as RowState;
}

/** Rows (uuids) returned by an UPDATE ... RETURNING. */
export function returnedIds(result: ExecResult): string[] {
  return result.rows.filter((line) => UUID_RE.test(line));
}

/** Mirrors the application's rule: claimed only when there is no error and exactly one row came back. */
export function interpretClaim(result: ExecResult): boolean {
  return result.error === null && returnedIds(result).length === 1;
}

export function winnersOf(results: ExecResult[]): number {
  return results.filter(interpretClaim).length;
}

export async function waitUntil(
  what: string,
  predicate: () => Promise<boolean>,
  timeoutMs = 15_000,
  stepMs = 20,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}

/** Waits until every given backend is blocked on a heavyweight lock (row or advisory). */
export async function waitForLockWaiters(admin: PsqlSession, pids: number[]): Promise<void> {
  await waitUntil(`backends ${pids.join(",")} to wait on a lock`, async () => {
    const r = await admin.exec(
      `select count(*) from pg_stat_activity where pid = any(array[${pids.join(",")}]) and wait_event_type = 'Lock';`,
    );
    return Number(r.rows[0]) === pids.length;
  });
}

export interface SessionPool {
  cfg: PgConfig;
  admin: PsqlSession;
  gate: PsqlSession;
}

export async function openPool(cfg: PgConfig): Promise<SessionPool> {
  const [admin, gate] = await Promise.all([PsqlSession.open(cfg, "admin"), PsqlSession.open(cfg, "gate")]);
  return { cfg, admin, gate };
}

export async function openSessions(cfg: PgConfig, count: number, prefix: string): Promise<PsqlSession[]> {
  return Promise.all(Array.from({ length: count }, (_, i) => PsqlSession.open(cfg, `${prefix}${i}`)));
}

let barrierCounter = 0;

/**
 * Releases all statements at (nearly) the same instant. The gate session holds
 * an exclusive advisory lock; every session first blocks on the shared lock,
 * we wait until ALL of them are provably blocked, then drop the gate. The
 * statements then race on the same row inside PostgreSQL, not in Node.
 */
export async function raceStatements(pool: SessionPool, sessions: PsqlSession[], statements: string[]): Promise<ExecResult[]> {
  if (sessions.length !== statements.length) throw new Error("one statement per session");
  const key = 41_000 + ((barrierCounter++ + Math.floor(Math.random() * 1000)) % 900_000);

  const pids = await Promise.all(sessions.map((s) => s.backendPid()));
  const held = await pool.gate.exec(`select pg_advisory_lock(${key});`);
  if (held.error) throw new Error(`gate lock failed: ${held.error}`);

  const running = sessions.map((session, i) =>
    session.exec(
      `do $$ begin perform pg_advisory_lock_shared(${key}); end $$;\n${statements[i]}\ndo $$ begin perform pg_advisory_unlock_shared(${key}); end $$;`,
    ),
  );

  await waitForLockWaiters(pool.admin, pids);
  const released = await pool.gate.exec(`select pg_advisory_unlock(${key});`);
  if (released.error) throw new Error(`gate unlock failed: ${released.error}`);
  return Promise.all(running);
}

export async function withSessions<T>(
  pool: SessionPool,
  count: number,
  fn: (sessions: PsqlSession[]) => Promise<T>,
): Promise<T> {
  const sessions = await openSessions(pool.cfg, count, "s");
  try {
    return await fn(sessions);
  } finally {
    await Promise.all(sessions.map((s) => s.close()));
  }
}

/** A role-scoped session: RLS applies (superuser bypass is dropped with SET ROLE). */
export async function openAsTenant(cfg: PgConfig, tenant: string, role: string, label: string): Promise<PsqlSession> {
  const s = await PsqlSession.open(cfg, label);
  const r = await s.exec(
    `set role authenticated; select set_config('app.tenant_id', ${lit(tenant)}, false), set_config('app.role', ${lit(role)}, false);`,
  );
  if (r.error) throw new Error(`openAsTenant failed: ${r.error}`);
  return s;
}

// ---------------------------------------------------------------------------
// H1 / PR #39 — approval decision + status mirror statements.
// Statement-for-statement equivalents of services/channel-campaigns.ts
// (transitionMasterCampaign, mirrorChannelCampaignStatus) and of the atomic
// decision claim in features/approvals/actions.ts. A unit test
// (tests/unit/integration/pg-h1-drift.test.ts) fails when they drift apart.
// ---------------------------------------------------------------------------

export const FIXTURE_MASTERS = "fixture_master_campaigns";
export const FIXTURE_APPROVALS = "fixture_approvals";

export type H1Transition = "SUBMIT" | "CANCEL" | "APPROVE" | "REJECT";
/** Mirrors STATUS_TRANSITIONS in services/channel-campaigns.ts; a unit test pins equality. */
export const H1_TRANSITIONS: Readonly<Record<H1Transition, { from: Status; to: Status }>> = {
  SUBMIT: { from: "DRAFT", to: "AWAITING_APPROVAL" },
  CANCEL: { from: "AWAITING_APPROVAL", to: "DRAFT" },
  APPROVE: { from: "AWAITING_APPROVAL", to: "SCHEDULED" },
  REJECT: { from: "AWAITING_APPROVAL", to: "DRAFT" },
};
export const LOCKED_STATUSES = ["FAILED", "ACTIVE", "PAUSED", "COMPLETED"] as const;

export const h1 = {
  /** mirrorChannelCampaignStatus: master id AND tenant AND source status. */
  mirror: (master: string, tenant: string, t: H1Transition) =>
    `update ${TABLE} set status = ${lit(H1_TRANSITIONS[t].to)} where master_campaign_id = ${lit(master)} and tenant_id = ${lit(tenant)} and status = ${lit(H1_TRANSITIONS[t].from)} returning id;`,

  /** transitionMasterCampaign: id AND tenant AND source status. */
  master: (master: string, tenant: string, t: H1Transition) =>
    `update ${FIXTURE_MASTERS} set status = ${lit(H1_TRANSITIONS[t].to)} where id = ${lit(master)} and tenant_id = ${lit(tenant)} and status = ${lit(H1_TRANSITIONS[t].from)} returning id;`,

  /** decideApprovalAction claim: id AND tenant AND status = PENDING. */
  decide: (approval: string, tenant: string, decision: "APPROVED" | "REJECTED") =>
    `update ${FIXTURE_APPROVALS} set status = ${lit(decision)}, decided_at = now() where id = ${lit(approval)} and tenant_id = ${lit(tenant)} and status = 'PENDING' returning id;`,

  /**
   * The whole decideApprovalAction CAMPAIGN_LAUNCH sequence with its fail-closed
   * branching: claim (exactly 1) -> master (exactly 1) -> mirror -> audit.
   * Written with psql \gset / \if so that EVERY statement is its own
   * autocommit transaction, exactly like the separate PostgREST requests the
   * application sends (a DO block would wrongly make the flow one transaction).
   */
  decideFlow: (approval: string, master: string, tenant: string, decision: "APPROVED" | "REJECTED") => {
    const t: H1Transition = decision === "APPROVED" ? "APPROVE" : "REJECT";
    const { from, to } = H1_TRANSITIONS[t];
    return `with u as (update ${FIXTURE_APPROVALS} set status = ${lit(decision)}, decided_at = now() where id = ${lit(approval)} and tenant_id = ${lit(tenant)} and status = 'PENDING' returning 1) select count(*) = 1 as ok from u \\gset
\\if :ok
with u as (update ${FIXTURE_MASTERS} set status = ${lit(to)} where id = ${lit(master)} and tenant_id = ${lit(tenant)} and status = ${lit(from)} returning 1) select count(*) = 1 as ok from u \\gset
\\if :ok
update ${TABLE} set status = ${lit(to)} where master_campaign_id = ${lit(master)} and tenant_id = ${lit(tenant)} and status = ${lit(from)};
insert into prompter_audit_logs (tenant_id, action, resource_type, resource_id) values (${lit(tenant)}, ${lit(decision === "APPROVED" ? "campaign.approved" : "campaign.launch_rejected")}, 'fixture_master_campaigns', ${lit(master)});
\\endif
\\endif`;
  },

  /** cancelSubmissionAction: master CANCEL (exactly 1) -> mirror CANCEL -> expire the pending approval (separate autocommit statements). */
  cancelFlow: (master: string, tenant: string) => `with u as (update ${FIXTURE_MASTERS} set status = 'DRAFT' where id = ${lit(master)} and tenant_id = ${lit(tenant)} and status = 'AWAITING_APPROVAL' returning 1) select count(*) = 1 as ok from u \\gset
\\if :ok
update ${TABLE} set status = 'DRAFT' where master_campaign_id = ${lit(master)} and tenant_id = ${lit(tenant)} and status = 'AWAITING_APPROVAL';
update ${FIXTURE_APPROVALS} set status = 'EXPIRED' where tenant_id = ${lit(tenant)} and resource_id = ${lit(master)} and status = 'PENDING';
\\endif`,

  // ---- NEGATIVE CONTROLS: the pre-H1 behaviour (never used by the app any more) ----

  /** Old setChannelCampaignsStatus: by master id only — no tenant, no source status. */
  unsafeMirror: (master: string, t: H1Transition) =>
    `update ${TABLE} set status = ${lit(H1_TRANSITIONS[t].to)} where master_campaign_id = ${lit(master)} returning id;`,

  /** Source status checked but the tenant predicate is missing. */
  unsafeMirrorNoTenant: (master: string, t: H1Transition) =>
    `update ${TABLE} set status = ${lit(H1_TRANSITIONS[t].to)} where master_campaign_id = ${lit(master)} and status = ${lit(H1_TRANSITIONS[t].from)} returning id;`,

  /** Old master write: by id only. */
  unsafeMaster: (master: string, t: H1Transition) =>
    `update ${FIXTURE_MASTERS} set status = ${lit(H1_TRANSITIONS[t].to)} where id = ${lit(master)} returning id;`,

  /** Old decision write: by id only — no PENDING predicate, no tenant. */
  unsafeDecide: (approval: string, decision: "APPROVED" | "REJECTED") =>
    `update ${FIXTURE_APPROVALS} set status = ${lit(decision)}, decided_at = now() where id = ${lit(approval)} returning id;`,
};

export async function seedMaster(admin: PsqlSession, opts: { tenant: string; id?: string; status?: Status }): Promise<string> {
  const id = opts.id ?? randomUUID();
  const r = await admin.exec(
    `insert into ${FIXTURE_MASTERS} (id, tenant_id, status) values (${lit(id)}, ${lit(opts.tenant)}, ${lit(opts.status ?? "AWAITING_APPROVAL")});`,
  );
  if (r.error) throw new Error(`seedMaster failed: ${r.error}`);
  return id;
}

export async function seedApproval(
  admin: PsqlSession,
  opts: { tenant: string; master: string; id?: string; status?: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" },
): Promise<string> {
  const id = opts.id ?? randomUUID();
  const r = await admin.exec(
    `insert into ${FIXTURE_APPROVALS} (id, tenant_id, resource_id, status) values (${lit(id)}, ${lit(opts.tenant)}, ${lit(opts.master)}, ${lit(opts.status ?? "PENDING")});`,
  );
  if (r.error) throw new Error(`seedApproval failed: ${r.error}`);
  return id;
}

export async function statusOf(admin: PsqlSession, table: string, id: string): Promise<string> {
  const r = await admin.exec(`select status from ${table} where id = ${lit(id)};`);
  if (r.error || r.rows.length !== 1) throw new Error(`statusOf failed: ${r.error ?? "no row"}`);
  return r.rows[0];
}

export async function channelStatuses(admin: PsqlSession, master: string): Promise<Record<string, Status>> {
  const r = await admin.exec(
    `select coalesce(json_object_agg(channel, status), '{}'::json) from ${TABLE} where master_campaign_id = ${lit(master)};`,
  );
  if (r.error) throw new Error(`channelStatuses failed: ${r.error}`);
  return JSON.parse(r.rows[0]) as Record<string, Status>;
}

export async function auditCount(admin: PsqlSession, master: string): Promise<number> {
  const r = await admin.exec(`select count(*) from prompter_audit_logs where resource_id = ${lit(master)};`);
  if (r.error) throw new Error(`auditCount failed: ${r.error}`);
  return Number(r.rows[0]);
}

export const CHANNELS = ["FACEBOOK", "INSTAGRAM", "TIKTOK", "X", "SEO"] as const;

/** Seeds one channel row per (channel, status) pair under `master`. */
export async function seedChannels(
  admin: PsqlSession,
  opts: { tenant: string; master: string; statuses: Status[] },
): Promise<string[]> {
  if (opts.statuses.length > CHANNELS.length) throw new Error("at most 5 channels per master");
  const ids: string[] = [];
  for (const [i, status] of opts.statuses.entries()) {
    ids.push(
      await seedRow(admin, {
        tenant: opts.tenant,
        master: opts.master,
        channel: CHANNELS[i],
        status,
        error: status === "FAILED" ? IN_PROGRESS_NOTE : null,
        externalId: status === "ACTIVE" || status === "PAUSED" || status === "COMPLETED" ? `ext_${i}` : null,
      }),
    );
  }
  return ids;
}
