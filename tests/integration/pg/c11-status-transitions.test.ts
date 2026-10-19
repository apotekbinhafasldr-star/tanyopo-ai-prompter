import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeAllSessions } from "./psql-session";
import { resolvePgConfig } from "./pg-env";
import {
  ALL_STATUSES,
  FIXTURE_APPROVALS,
  FIXTURE_MASTERS,
  H1_TRANSITIONS,
  IN_PROGRESS_NOTE,
  LOCKED_STATUSES,
  TABLE,
  auditCount,
  channelStatuses,
  getRow,
  h1,
  interpretClaim,
  isConsistent,
  setMasterChannels,
  waitForLockWaiters,
  openAsTenant,
  openPool,
  openSessions,
  pgEnabled,
  raceStatements,
  returnedIds,
  seedApproval,
  seedChannels,
  seedMaster,
  seedRow,
  statusOf,
  stmt,
  winnersOf,
  type H1Transition,
  type SessionPool,
} from "./fixture";

// C11 — H1 / PR #39: ordinary approval / cancel / submit flows can never
// re-arm (FAILED/ACTIVE/PAUSED/COMPLETED -> SCHEDULED/DRAFT) a channel row.
const TRANSITIONS = Object.keys(H1_TRANSITIONS) as H1Transition[];

describe.skipIf(!pgEnabled)("C11 status transitions (H1)", () => {
  let pool: SessionPool;
  beforeAll(async () => {
    pool = await openPool(resolvePgConfig());
  });
  afterAll(async () => {
    await closeAllSessions();
  });

  describe.each(TRANSITIONS)("%s", (transition) => {
    const { from, to } = H1_TRANSITIONS[transition];

    it.each(ALL_STATUSES)("a channel row in %s", async (status) => {
      const tenant = randomUUID();
      const master = randomUUID();
      const id = await seedRow(pool.admin, { tenant, master, status });
      const result = await pool.admin.exec(h1.mirror(master, tenant, transition));
      expect(result.error).toBeNull();
      const moved = status === from;
      expect(returnedIds(result)).toHaveLength(moved ? 1 : 0);
      expect((await getRow(pool.admin, id)).status).toBe(moved ? to : status);
    });

    it.each(ALL_STATUSES)("a master row in %s", async (status) => {
      const tenant = randomUUID();
      const master = await seedMaster(pool.admin, { tenant, status });
      const result = await pool.admin.exec(h1.master(master, tenant, transition));
      expect(result.error).toBeNull();
      expect(interpretClaim(result)).toBe(status === from);
      expect(await statusOf(pool.admin, FIXTURE_MASTERS, master)).toBe(status === from ? to : status);
    });

    it("locked channels (FAILED/ACTIVE/PAUSED/COMPLETED) next to one in the source status stay exactly as they were", async () => {
      const tenant = randomUUID();
      const master = randomUUID();
      const ids = await seedChannels(pool.admin, { tenant, master, statuses: [from, ...LOCKED_STATUSES] });
      const before = await Promise.all(ids.map((id) => getRow(pool.admin, id)));
      await pool.admin.exec(h1.mirror(master, tenant, transition));
      const after = await Promise.all(ids.map((id) => getRow(pool.admin, id)));
      expect(after[0].status).toBe(to);
      for (let i = 1; i < ids.length; i++) expect(after[i]).toEqual(before[i]); // status, error AND external id untouched
    });
  });

  it("the claimed in-progress marker survives every ordinary transition", async () => {
    const tenant = randomUUID();
    const master = randomUUID();
    const [claimed] = await seedChannels(pool.admin, { tenant, master, statuses: ["FAILED"] });
    for (const t of TRANSITIONS) await pool.admin.exec(h1.mirror(master, tenant, t));
    const row = await getRow(pool.admin, claimed);
    expect(row.status).toBe("FAILED");
    expect(row.error).toBe(IN_PROGRESS_NOTE);
  });

  describe("tenant isolation", () => {
    it("right master id, wrong tenant: nothing matches, nothing changes", async () => {
      const owner = randomUUID();
      const other = randomUUID();
      const master = await seedMaster(pool.admin, { tenant: owner });
      const [ch] = await seedChannels(pool.admin, { tenant: owner, master, statuses: ["AWAITING_APPROVAL"] });
      for (const t of TRANSITIONS) {
        expect(interpretClaim(await pool.admin.exec(h1.master(master, other, t)))).toBe(false);
        expect(returnedIds(await pool.admin.exec(h1.mirror(master, other, t)))).toHaveLength(0);
      }
      expect(await statusOf(pool.admin, FIXTURE_MASTERS, master)).toBe("AWAITING_APPROVAL");
      expect((await getRow(pool.admin, ch)).status).toBe("AWAITING_APPROVAL");
    });

    it("a decision on another tenant's approval matches nothing", async () => {
      const owner = randomUUID();
      const other = randomUUID();
      const master = await seedMaster(pool.admin, { tenant: owner });
      const approval = await seedApproval(pool.admin, { tenant: owner, master });
      expect(interpretClaim(await pool.admin.exec(h1.decide(approval, other, "APPROVED")))).toBe(false);
      expect(await statusOf(pool.admin, FIXTURE_APPROVALS, approval)).toBe("PENDING");
    });

    it("two tenants sharing a master id: each mirror only moves its own rows", async () => {
      const a = randomUUID();
      const b = randomUUID();
      const master = randomUUID();
      const [ca] = await seedChannels(pool.admin, { tenant: a, master, statuses: ["AWAITING_APPROVAL"] });
      const idB = await seedRow(pool.admin, { tenant: b, master, channel: "TIKTOK", status: "AWAITING_APPROVAL" });
      await pool.admin.exec(h1.mirror(master, a, "APPROVE"));
      expect((await getRow(pool.admin, ca)).status).toBe("SCHEDULED");
      expect((await getRow(pool.admin, idB)).status).toBe("AWAITING_APPROVAL");
    });

    describe("RLS (SET ROLE authenticated, policies from the migration)", () => {
      it("another tenant's session cannot mirror the rows even with the correct tenant predicate forged", async () => {
        const owner = randomUUID();
        const other = randomUUID();
        const master = randomUUID();
        const [ch] = await seedChannels(pool.admin, { tenant: owner, master, statuses: ["AWAITING_APPROVAL"] });
        const s = await openAsTenant(pool.cfg, other, "owner", "c11-rls-other");
        try {
          const forged = await s.exec(h1.mirror(master, owner, "APPROVE"));
          expect(returnedIds(forged)).toHaveLength(0);
          expect((await getRow(pool.admin, ch)).status).toBe("AWAITING_APPROVAL");
        } finally {
          await s.close();
        }
      });

      it("a viewer cannot mirror; owner and marketing can; none can touch a locked row", async () => {
        const tenant = randomUUID();
        const master = randomUUID();
        const [open, failed] = await seedChannels(pool.admin, { tenant, master, statuses: ["AWAITING_APPROVAL", "FAILED"] });
        const viewer = await openAsTenant(pool.cfg, tenant, "viewer", "c11-rls-viewer");
        try {
          expect(returnedIds(await viewer.exec(h1.mirror(master, tenant, "APPROVE")))).toHaveLength(0);
          expect((await getRow(pool.admin, open)).status).toBe("AWAITING_APPROVAL");
        } finally {
          await viewer.close();
        }
        const owner = await openAsTenant(pool.cfg, tenant, "owner", "c11-rls-owner");
        try {
          expect(returnedIds(await owner.exec(h1.mirror(master, tenant, "APPROVE")))).toHaveLength(1);
        } finally {
          await owner.close();
        }
        expect((await getRow(pool.admin, open)).status).toBe("SCHEDULED");
        expect((await getRow(pool.admin, failed)).status).toBe("FAILED");
      });
    });
  });

  describe("concurrent approval decisions", () => {
    async function scenario(n: number, decisions: Array<"APPROVED" | "REJECTED">) {
      const tenant = randomUUID();
      const master = await seedMaster(pool.admin, { tenant });
      const approval = await seedApproval(pool.admin, { tenant, master });
      const channels = await seedChannels(pool.admin, { tenant, master, statuses: ["AWAITING_APPROVAL", "AWAITING_APPROVAL"] });
      const sessions = await openSessions(pool.cfg, n, "c11-dec-");
      try {
        const results = await raceStatements(
          pool,
          sessions,
          sessions.map((_, i) => h1.decide(approval, tenant, decisions[i % decisions.length])),
        );
        return { tenant, master, approval, channels, results };
      } finally {
        await Promise.all(sessions.map((s) => s.close()));
      }
    }

    it.each([2, 8])("%i identical APPROVE claims: exactly one winner", async (n) => {
      const { results, approval } = await scenario(n, ["APPROVED"]);
      expect(winnersOf(results)).toBe(1);
      expect(await statusOf(pool.admin, FIXTURE_APPROVALS, approval)).toBe("APPROVED");
    });

    it("APPROVE racing REJECT (4 + 4): exactly one winner and the stored decision is the winner's", async () => {
      const { results, approval } = await scenario(8, ["APPROVED", "REJECTED"]);
      expect(winnersOf(results)).toBe(1);
      const winnerIndex = results.findIndex(interpretClaim);
      expect(await statusOf(pool.admin, FIXTURE_APPROVALS, approval)).toBe(winnerIndex % 2 === 0 ? "APPROVED" : "REJECTED");
    });

    it("the whole decision flow raced 8 ways (mixed): one effect, one audit row, coherent master/channels", async () => {
      const tenant = randomUUID();
      const master = await seedMaster(pool.admin, { tenant });
      const approval = await seedApproval(pool.admin, { tenant, master });
      await seedChannels(pool.admin, { tenant, master, statuses: ["AWAITING_APPROVAL", "AWAITING_APPROVAL"] });
      const sessions = await openSessions(pool.cfg, 8, "c11-flow-");
      try {
        const results = await raceStatements(
          pool,
          sessions,
          sessions.map((_, i) => h1.decideFlow(approval, master, tenant, i % 2 === 0 ? "APPROVED" : "REJECTED")),
        );
        expect(results.every((r) => r.error === null)).toBe(true);
      } finally {
        await Promise.all(sessions.map((s) => s.close()));
      }
      const decided = await statusOf(pool.admin, FIXTURE_APPROVALS, approval);
      const expected = decided === "APPROVED" ? "SCHEDULED" : "DRAFT";
      expect(await statusOf(pool.admin, FIXTURE_MASTERS, master)).toBe(expected);
      expect(new Set(Object.values(await channelStatuses(pool.admin, master)))).toEqual(new Set([expected]));
      expect(await auditCount(pool.admin, master)).toBe(1);
    });

    it("a late REJECT after APPROVE and the launch claim leaves the claimed FAILED channel alone", async () => {
      const tenant = randomUUID();
      const master = await seedMaster(pool.admin, { tenant });
      const approval = await seedApproval(pool.admin, { tenant, master });
      const [ch] = await seedChannels(pool.admin, { tenant, master, statuses: ["AWAITING_APPROVAL"] });
      await pool.admin.exec(h1.decideFlow(approval, master, tenant, "APPROVED"));
      expect((await getRow(pool.admin, ch)).status).toBe("SCHEDULED");
      expect(interpretClaim(await pool.admin.exec(stmt.claim(ch, tenant)))).toBe(true); // launch claim
      await pool.admin.exec(h1.decideFlow(approval, master, tenant, "REJECTED")); // late, stale click
      const row = await getRow(pool.admin, ch);
      expect(row.status).toBe("FAILED");
      expect(row.error).toBe(IN_PROGRESS_NOTE);
      expect(await statusOf(pool.admin, FIXTURE_MASTERS, master)).toBe("SCHEDULED");
      expect(await auditCount(pool.admin, master)).toBe(1);
    });

    it("APPROVE flow racing CANCEL flow (20 rounds): the master and every channel always end in the same state", async () => {
      for (let round = 0; round < 20; round++) {
        const tenant = randomUUID();
        const master = await seedMaster(pool.admin, { tenant });
        const approval = await seedApproval(pool.admin, { tenant, master });
        await seedChannels(pool.admin, { tenant, master, statuses: ["AWAITING_APPROVAL", "AWAITING_APPROVAL", "AWAITING_APPROVAL"] });
        const sessions = await openSessions(pool.cfg, 2, `c11-ac-${round}-`);
        try {
          const results = await raceStatements(pool, sessions, [
            h1.decideFlow(approval, master, tenant, "APPROVED"),
            h1.cancelFlow(master, tenant),
          ]);
          expect(results.every((r) => r.error === null)).toBe(true);
        } finally {
          await Promise.all(sessions.map((s) => s.close()));
        }
        const masterStatus = await statusOf(pool.admin, FIXTURE_MASTERS, master);
        expect(["SCHEDULED", "DRAFT"]).toContain(masterStatus);
        expect(new Set(Object.values(await channelStatuses(pool.admin, master)))).toEqual(new Set([masterStatus]));
      }
    });
  });

  describe("launch claim regression (unchanged by H1)", () => {
    it("approve mirror -> exactly one of 8 racing launch claims wins -> a repeated approve mirror cannot re-arm it", async () => {
      const tenant = randomUUID();
      const master = randomUUID();
      const [ch] = await seedChannels(pool.admin, { tenant, master, statuses: ["AWAITING_APPROVAL"] });
      await pool.admin.exec(h1.mirror(master, tenant, "APPROVE"));
      expect((await getRow(pool.admin, ch)).status).toBe("SCHEDULED");

      const sessions = await openSessions(pool.cfg, 8, "c11-claim-");
      try {
        const results = await raceStatements(pool, sessions, sessions.map(() => stmt.claim(ch, tenant)));
        expect(winnersOf(results)).toBe(1);
      } finally {
        await Promise.all(sessions.map((s) => s.close()));
      }
      for (const t of TRANSITIONS) await pool.admin.exec(h1.mirror(master, tenant, t));
      expect((await getRow(pool.admin, ch)).status).toBe("FAILED");
    });

    it("the legitimate release (FAILED -> SCHEDULED by the launch itself) still works", async () => {
      const tenant = randomUUID();
      const [ch] = await seedChannels(pool.admin, { tenant, master: randomUUID(), statuses: ["FAILED"] });
      expect(interpretClaim(await pool.admin.exec(stmt.release(ch, tenant, IN_PROGRESS_NOTE)))).toBe(true);
      expect((await getRow(pool.admin, ch)).status).toBe("SCHEDULED");
    });

    it("mirror racing a launch claim never leaves the row re-armed after the claim", async () => {
      for (let round = 0; round < 10; round++) {
        const tenant = randomUUID();
        const master = randomUUID();
        const [ch] = await seedChannels(pool.admin, { tenant, master, statuses: ["SCHEDULED"] });
        const sessions = await openSessions(pool.cfg, 2, `c11-mc-${round}-`);
        try {
          await raceStatements(pool, sessions, [stmt.claim(ch, tenant), h1.mirror(master, tenant, "APPROVE")]);
        } finally {
          await Promise.all(sessions.map((s) => s.close()));
        }
        // Source status of APPROVE is AWAITING_APPROVAL: a SCHEDULED/FAILED row is never matched.
        const status = (await getRow(pool.admin, ch)).status;
        expect(status).toBe("FAILED");
      }
    });
  });

  describe("F1–F3 remediation: verified mirror, pre-flight, partial failure", () => {
    const sessionsFor = (n: number, label: string) => openSessions(pool.cfg, n, label);

    it.each(["before", "after"] as const)("consistency check truth table (APPROVE, phase %s) for one channel in every status", async (phase) => {
      for (const status of ALL_STATUSES) {
        const tenant = randomUUID();
        const master = await seedMaster(pool.admin, { tenant });
        await seedChannels(pool.admin, { tenant, master, statuses: [status] });
        const accepted: string[] = (phase === "before" ? ["AWAITING_APPROVAL", "SCHEDULED"] : ["SCHEDULED"]).concat([...LOCKED_STATUSES]);
        expect(await isConsistent(pool.admin, h1.consistent(master, tenant, "APPROVE", phase))).toBe(accepted.includes(status));
      }
    });

    it("zero rows moved is only fine when the state agrees: a DRAFT row under an approved master is NOT consistent, and is never re-armed", async () => {
      const tenant = randomUUID();
      const master = await seedMaster(pool.admin, { tenant, status: "SCHEDULED" });
      const [draft] = await seedChannels(pool.admin, { tenant, master, statuses: ["DRAFT"] });
      expect(returnedIds(await pool.admin.exec(h1.mirror(master, tenant, "APPROVE")))).toHaveLength(0);
      expect(await isConsistent(pool.admin, h1.consistent(master, tenant, "APPROVE", "after"))).toBe(false);
      expect((await getRow(pool.admin, draft)).status).toBe("DRAFT");
    });

    it("a legitimate zero (all rows already SCHEDULED or locked) IS consistent; an empty channel set too", async () => {
      const tenant = randomUUID();
      const master = await seedMaster(pool.admin, { tenant, status: "SCHEDULED" });
      await seedChannels(pool.admin, { tenant, master, statuses: ["SCHEDULED", "FAILED", "ACTIVE"] });
      expect(await isConsistent(pool.admin, h1.consistent(master, tenant, "APPROVE", "after"))).toBe(true);
      const empty = await seedMaster(pool.admin, { tenant, status: "SCHEDULED" });
      expect(await isConsistent(pool.admin, h1.consistent(empty, tenant, "APPROVE", "after"))).toBe(true);
    });

    it("a selected channel without a row (missing expected row) is NOT consistent", async () => {
      const tenant = randomUUID();
      const master = await seedMaster(pool.admin, { tenant, status: "SCHEDULED" });
      await seedChannels(pool.admin, { tenant, master, statuses: ["SCHEDULED"] });
      await setMasterChannels(pool.admin, master, ["FACEBOOK", "TIKTOK"]);
      expect(await isConsistent(pool.admin, h1.consistent(master, tenant, "APPROVE", "after"))).toBe(false);
    });

    it("the check is tenant-scoped: another tenant's master is invisible (not consistent)", async () => {
      const owner = randomUUID();
      const master = await seedMaster(pool.admin, { tenant: owner, status: "SCHEDULED" });
      await seedChannels(pool.admin, { tenant: owner, master, statuses: ["SCHEDULED"] });
      expect(await isConsistent(pool.admin, h1.consistent(master, owner, "APPROVE", "after"))).toBe(true);
      expect(await isConsistent(pool.admin, h1.consistent(master, randomUUID(), "APPROVE", "after"))).toBe(false);
    });

    it("F1 flow: DRAFT channels under an AWAITING_APPROVAL master block APPROVE before anything is written", async () => {
      const tenant = randomUUID();
      const master = await seedMaster(pool.admin, { tenant });
      const approval = await seedApproval(pool.admin, { tenant, master });
      const ids = await seedChannels(pool.admin, { tenant, master, statuses: ["DRAFT", "DRAFT"] });
      await pool.admin.exec(h1.decideFlow(approval, master, tenant, "APPROVED"));
      expect(await statusOf(pool.admin, FIXTURE_APPROVALS, approval)).toBe("PENDING");
      expect(await statusOf(pool.admin, FIXTURE_MASTERS, master)).toBe("AWAITING_APPROVAL");
      expect(await Promise.all(ids.map(async (id) => (await getRow(pool.admin, id)).status))).toEqual(["DRAFT", "DRAFT"]);
      expect(await auditCount(pool.admin, master)).toBe(0);
    });

    it("F1 flow raced 8 ways on that inconsistent state: still nothing written", async () => {
      const tenant = randomUUID();
      const master = await seedMaster(pool.admin, { tenant });
      const approval = await seedApproval(pool.admin, { tenant, master });
      await seedChannels(pool.admin, { tenant, master, statuses: ["DRAFT"] });
      const sessions = await sessionsFor(8, "c11-f1-race-");
      try {
        await raceStatements(pool, sessions, sessions.map(() => h1.decideFlow(approval, master, tenant, "APPROVED")));
      } finally {
        await Promise.all(sessions.map((x) => x.close()));
      }
      expect(await statusOf(pool.admin, FIXTURE_APPROVALS, approval)).toBe("PENDING");
      expect(await auditCount(pool.admin, master)).toBe(0);
    });

    it("F1 flow: locked channels next to an AWAITING one do not block and are untouched; success is audited once", async () => {
      const tenant = randomUUID();
      const master = await seedMaster(pool.admin, { tenant });
      const approval = await seedApproval(pool.admin, { tenant, master });
      const ids = await seedChannels(pool.admin, { tenant, master, statuses: ["AWAITING_APPROVAL", ...LOCKED_STATUSES] });
      const before = await Promise.all(ids.map((id) => getRow(pool.admin, id)));
      await pool.admin.exec(h1.decideFlow(approval, master, tenant, "APPROVED"));
      const after = await Promise.all(ids.map((id) => getRow(pool.admin, id)));
      expect(after[0].status).toBe("SCHEDULED");
      for (let i = 1; i < ids.length; i++) expect(after[i]).toEqual(before[i]);
      expect(await auditCount(pool.admin, master)).toBe(1);
    });

    it("F2 flow: the mirror UPDATE fails (lock timeout) after the master moved -> NOT success (no audit), no rollback, no retry, no re-approval", async () => {
      const tenant = randomUUID();
      const master = await seedMaster(pool.admin, { tenant });
      const approval = await seedApproval(pool.admin, { tenant, master });
      const [first, second] = await seedChannels(pool.admin, { tenant, master, statuses: ["AWAITING_APPROVAL", "AWAITING_APPROVAL"] });
      const [holder, worker] = await sessionsFor(2, "c11-f2-");
      try {
        const workerPid = await worker.backendPid();
        await holder.exec("begin;");
        await holder.exec(`select 1 from prompter_channel_campaigns where id = '${second}' for update;`);
        expect((await worker.exec("set lock_timeout = '300ms';")).error).toBeNull();
        const running = worker.exec(h1.decideFlow(approval, master, tenant, "APPROVED"));
        await waitForLockWaiters(pool.admin, [workerPid]);
        const result = await running;
        expect(result.error).toMatch(/lock timeout/i);
        await holder.exec("rollback;");
      } finally {
        await Promise.all([holder.close(), worker.close()]);
      }
      // Partial state, exactly as the application reports it: decision recorded, master moved, channels NOT moved.
      expect(await statusOf(pool.admin, FIXTURE_APPROVALS, approval)).toBe("APPROVED");
      expect(await statusOf(pool.admin, FIXTURE_MASTERS, master)).toBe("SCHEDULED");
      expect((await getRow(pool.admin, first)).status).toBe("AWAITING_APPROVAL");
      expect((await getRow(pool.admin, second)).status).toBe("AWAITING_APPROVAL");
      expect(await auditCount(pool.admin, master)).toBe(0);
      expect(await isConsistent(pool.admin, h1.consistent(master, tenant, "APPROVE", "after"))).toBe(false);
      // Nothing heals or repeats automatically; a second decision is refused and changes nothing.
      await pool.admin.exec(h1.decideFlow(approval, master, tenant, "APPROVED"));
      await pool.admin.exec(h1.decideFlow(approval, master, tenant, "REJECTED"));
      expect(await statusOf(pool.admin, FIXTURE_MASTERS, master)).toBe("SCHEDULED");
      expect((await getRow(pool.admin, first)).status).toBe("AWAITING_APPROVAL");
      expect(await auditCount(pool.admin, master)).toBe(0);
      // And the stuck channel cannot be launched: the launch claim needs SCHEDULED.
      expect(interpretClaim(await pool.admin.exec(stmt.claim(first, tenant)))).toBe(false);
    });

    it("approve / reject / cancel raced (20 rounds): master and channels always agree, at most one decision, at most one audit", async () => {
      for (let round = 0; round < 20; round++) {
        const tenant = randomUUID();
        const master = await seedMaster(pool.admin, { tenant });
        const approval = await seedApproval(pool.admin, { tenant, master });
        await seedChannels(pool.admin, { tenant, master, statuses: ["AWAITING_APPROVAL", "AWAITING_APPROVAL"] });
        const sessions = await sessionsFor(3, `c11-3way-${round}-`);
        try {
          await raceStatements(pool, sessions, [
            h1.decideFlow(approval, master, tenant, "APPROVED"),
            h1.decideFlow(approval, master, tenant, "REJECTED"),
            h1.cancelFlow(master, tenant),
          ]);
        } finally {
          await Promise.all(sessions.map((x) => x.close()));
        }
        const masterStatus = await statusOf(pool.admin, FIXTURE_MASTERS, master);
        expect(["SCHEDULED", "DRAFT"]).toContain(masterStatus);
        expect(new Set(Object.values(await channelStatuses(pool.admin, master)))).toEqual(new Set([masterStatus]));
        expect(await auditCount(pool.admin, master)).toBeLessThanOrEqual(1);
      }
    });

    it("no cross-tenant change: the flow run with another tenant's id changes nothing", async () => {
      const owner = randomUUID();
      const other = randomUUID();
      const master = await seedMaster(pool.admin, { tenant: owner });
      const approval = await seedApproval(pool.admin, { tenant: owner, master });
      const [ch] = await seedChannels(pool.admin, { tenant: owner, master, statuses: ["AWAITING_APPROVAL"] });
      await pool.admin.exec(h1.decideFlow(approval, master, other, "APPROVED"));
      expect(await statusOf(pool.admin, FIXTURE_APPROVALS, approval)).toBe("PENDING");
      expect(await statusOf(pool.admin, FIXTURE_MASTERS, master)).toBe("AWAITING_APPROVAL");
      expect((await getRow(pool.admin, ch)).status).toBe("AWAITING_APPROVAL");
    });
  });

  it("table name sanity: the H1 statements only touch the channel table and the two stand-ins", () => {
    for (const s of [h1.mirror("m", "t", "APPROVE"), h1.master("m", "t", "APPROVE"), h1.decide("a", "t", "APPROVED")]) {
      expect(s).toMatch(new RegExp(`update (${TABLE}|${FIXTURE_MASTERS}|${FIXTURE_APPROVALS}) `));
    }
  });
});
