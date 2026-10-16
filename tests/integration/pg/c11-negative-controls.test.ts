import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeAllSessions } from "./psql-session";
import { resolvePgConfig } from "./pg-env";
import {
  FIXTURE_APPROVALS,
  auditCount,
  FIXTURE_MASTERS,
  LOCKED_STATUSES,
  getRow,
  h1,
  interpretClaim,
  openPool,
  openSessions,
  pgEnabled,
  raceStatements,
  seedApproval,
  seedChannels,
  seedMaster,
  seedRow,
  statusOf,
  winnersOf,
  type RowState,
  type SessionPool,
} from "./fixture";

/**
 * H1 NEGATIVE CONTROLS — prove the C11 assertions can fail. Each pre-H1
 * (unsafe) statement MUST be caught by the very same checker the safe
 * statements pass. If one of these starts looking "safe", C11 has gone blind.
 */
const lockedIntact = (before: RowState[], after: RowState[]) =>
  before.every((b, i) => JSON.stringify(b) === JSON.stringify(after[i]));

describe.skipIf(!pgEnabled)("C11 negative controls (H1)", () => {
  let pool: SessionPool;
  beforeAll(async () => {
    pool = await openPool(resolvePgConfig());
  });
  afterAll(async () => {
    await closeAllSessions();
  });

  async function masterOf(channelId: string): Promise<string> {
    const r = await pool.admin.exec(`select master_campaign_id from prompter_channel_campaigns where id = '${channelId}';`);
    return r.rows[0];
  }

  async function lockedScenario(run: (master: string, tenant: string) => string) {
    const tenant = randomUUID();
    const master = randomUUID();
    const ids = await seedChannels(pool.admin, { tenant, master, statuses: [...LOCKED_STATUSES] });
    const before = await Promise.all(ids.map((id) => getRow(pool.admin, id)));
    await pool.admin.exec(run(master, tenant));
    const after = await Promise.all(ids.map((id) => getRow(pool.admin, id)));
    return { before, after };
  }

  it("checker control: the SAFE mirror leaves locked rows intact", async () => {
    for (const t of ["APPROVE", "REJECT", "CANCEL", "SUBMIT"] as const) {
      const { before, after } = await lockedScenario((m, tn) => h1.mirror(m, tn, t));
      expect(lockedIntact(before, after)).toBe(true);
    }
  });

  it("UNSAFE pre-H1 mirror (master id only) re-arms FAILED/ACTIVE/PAUSED/COMPLETED -> detected", async () => {
    const { before, after } = await lockedScenario((m) => h1.unsafeMirror(m, "APPROVE"));
    expect(lockedIntact(before, after)).toBe(false);
    expect(after.map((r) => r.status)).toEqual(["SCHEDULED", "SCHEDULED", "SCHEDULED", "SCHEDULED"]);
    // ...and the claimed row's marker is still there, now pointing at a re-armed row:
    expect(after[0].error).toBe(before[0].error);
  });

  it("UNSAFE pre-H1 mirror on REJECT/CANCEL pushes a launched campaign back to DRAFT -> detected", async () => {
    const { before, after } = await lockedScenario((m) => h1.unsafeMirror(m, "REJECT"));
    expect(lockedIntact(before, after)).toBe(false);
    expect(after.every((r) => r.status === "DRAFT")).toBe(true);
  });

  it("UNSAFE mirror without a tenant predicate changes another tenant's rows -> detected", async () => {
    const owner = randomUUID();
    const victim = randomUUID();
    const master = randomUUID();
    const id = await seedRow(pool.admin, { tenant: victim, master, channel: "X", status: "AWAITING_APPROVAL" });
    await pool.admin.exec(h1.unsafeMirrorNoTenant(master, "APPROVE"));
    expect((await getRow(pool.admin, id)).status).toBe("SCHEDULED"); // cross-tenant write happened
    // the safe statement (tenant predicate) does not:
    const id2 = await seedRow(pool.admin, { tenant: victim, master: randomUUID(), channel: "X", status: "AWAITING_APPROVAL" });
    await pool.admin.exec(h1.mirror((await masterOf(id2)), owner, "APPROVE"));
    expect((await getRow(pool.admin, id2)).status).toBe("AWAITING_APPROVAL");
  });

  it("UNSAFE pre-H1 master write (id only) overwrites a SCHEDULED/launched master -> detected", async () => {
    const tenant = randomUUID();
    const master = await seedMaster(pool.admin, { tenant, status: "SCHEDULED" });
    expect(interpretClaim(await pool.admin.exec(h1.unsafeMaster(master, "CANCEL")))).toBe(true);
    expect(await statusOf(pool.admin, FIXTURE_MASTERS, master)).toBe("DRAFT"); // wrongly rewritten
    const safe = await seedMaster(pool.admin, { tenant, status: "SCHEDULED" });
    expect(interpretClaim(await pool.admin.exec(h1.master(safe, tenant, "CANCEL")))).toBe(false);
    expect(await statusOf(pool.admin, FIXTURE_MASTERS, safe)).toBe("SCHEDULED");
  });

  it("UNSAFE pre-H1 decision (no PENDING predicate): 8 racing decisions ALL 'win' -> detected; the safe claim has one", async () => {
    const tenant = randomUUID();
    const master = await seedMaster(pool.admin, { tenant });
    const approval = await seedApproval(pool.admin, { tenant, master });
    const sessions = await openSessions(pool.cfg, 8, "c11-nc-unsafe-");
    try {
      const results = await raceStatements(
        pool,
        sessions,
        sessions.map((_, i) => h1.unsafeDecide(approval, i % 2 === 0 ? "APPROVED" : "REJECTED")),
      );
      expect(winnersOf(results)).toBe(8);
    } finally {
      await Promise.all(sessions.map((s) => s.close()));
    }

    const approval2 = await seedApproval(pool.admin, { tenant, master });
    const safe = await openSessions(pool.cfg, 8, "c11-nc-safe-");
    try {
      const results = await raceStatements(
        pool,
        safe,
        safe.map((_, i) => h1.decide(approval2, tenant, i % 2 === 0 ? "APPROVED" : "REJECTED")),
      );
      expect(winnersOf(results)).toBe(1);
    } finally {
      await Promise.all(safe.map((s) => s.close()));
    }
    expect(["APPROVED", "REJECTED"]).toContain(await statusOf(pool.admin, FIXTURE_APPROVALS, approval2));
  });

  it("F1 control: the b783c8a flow (no pre-flight / verification) reports success on DRAFT channels -> detected; the F1 flow does not", async () => {
    const tenant = randomUUID();
    const unsafeMaster = await seedMaster(pool.admin, { tenant });
    const unsafeApproval = await seedApproval(pool.admin, { tenant, master: unsafeMaster });
    await seedChannels(pool.admin, { tenant, master: unsafeMaster, statuses: ["DRAFT"] });
    await pool.admin.exec(h1.unsafeDecideFlowNoVerify(unsafeApproval, unsafeMaster, tenant, "APPROVED"));
    expect(await auditCount(pool.admin, unsafeMaster)).toBe(1); // "approved" audited...
    expect(await statusOf(pool.admin, FIXTURE_MASTERS, unsafeMaster)).toBe("SCHEDULED"); // ...with channels still DRAFT: the defect

    const master = await seedMaster(pool.admin, { tenant });
    const approval = await seedApproval(pool.admin, { tenant, master });
    await seedChannels(pool.admin, { tenant, master, statuses: ["DRAFT"] });
    await pool.admin.exec(h1.decideFlow(approval, master, tenant, "APPROVED"));
    expect(await auditCount(pool.admin, master)).toBe(0);
    expect(await statusOf(pool.admin, FIXTURE_APPROVALS, approval)).toBe("PENDING");
  });
});
