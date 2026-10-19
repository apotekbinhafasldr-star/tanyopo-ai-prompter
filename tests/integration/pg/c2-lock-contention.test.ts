import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeAllSessions } from "./psql-session";
import { resolvePgConfig } from "./pg-env";
import {
  IN_PROGRESS_NOTE,
  getRow,
  interpretClaim,
  openPool,
  openSessions,
  pgEnabled,
  returnedIds,
  seedRow,
  stmt,
  waitForLockWaiters,
  type SessionPool,
} from "./fixture";

// C2 — real row-lock contention with a deterministic winner and loser(s).
describe.skipIf(!pgEnabled)("C2 lock contention", () => {
  let pool: SessionPool;
  beforeAll(async () => {
    pool = await openPool(resolvePgConfig());
  });
  afterAll(async () => {
    await closeAllSessions();
  });

  it("the transaction that locked the row first wins; the blocked claimant re-evaluates and gets 0 rows", async () => {
    const tenant = randomUUID();
    const id = await seedRow(pool.admin, { tenant });
    const [holder, loser] = await openSessions(pool.cfg, 2, "c2-");
    try {
      const holderPid = await holder.backendPid();
      const loserPid = await loser.backendPid();

      await holder.exec("begin;");
      const held = await holder.exec(stmt.claim(id, tenant));
      expect(interpretClaim(held)).toBe(true);

      let settled = false;
      const loserRun = loser.exec(stmt.claim(id, tenant)).then((r) => {
        settled = true;
        return r;
      });

      await waitForLockWaiters(pool.admin, [loserPid]);
      expect(settled).toBe(false);
      const blockers = await pool.admin.exec(`select pg_blocking_pids(${loserPid});`);
      expect(blockers.rows[0]).toContain(String(holderPid));

      // Not visible to anyone else before COMMIT.
      expect((await getRow(pool.admin, id)).status).toBe("SCHEDULED");

      await holder.exec("commit;");
      const lost = await loserRun;
      expect(lost.error).toBeNull();
      expect(returnedIds(lost)).toHaveLength(0);
      expect(interpretClaim(lost)).toBe(false);

      const row = await getRow(pool.admin, id);
      expect(row.status).toBe("FAILED");
      expect(row.error).toBe(IN_PROGRESS_NOTE);
    } finally {
      await Promise.all([holder.close(), loser.close()]);
    }
  });

  it("several claimants queued behind one holder all lose after it commits", async () => {
    const tenant = randomUUID();
    const id = await seedRow(pool.admin, { tenant });
    const sessions = await openSessions(pool.cfg, 5, "c2-q-");
    const [holder, ...losers] = sessions;
    try {
      const loserPids = await Promise.all(losers.map((s) => s.backendPid()));
      await holder.exec("begin;");
      expect(interpretClaim(await holder.exec(stmt.claim(id, tenant)))).toBe(true);

      const runs = losers.map((s) => s.exec(stmt.claim(id, tenant)));
      await waitForLockWaiters(pool.admin, loserPids);
      await holder.exec("commit;");

      const results = await Promise.all(runs);
      expect(results.map(interpretClaim)).toEqual([false, false, false, false]);
      expect(results.every((r) => r.error === null)).toBe(true);
    } finally {
      await Promise.all(sessions.map((s) => s.close()));
    }
  });
});
