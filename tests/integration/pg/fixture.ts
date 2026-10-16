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
