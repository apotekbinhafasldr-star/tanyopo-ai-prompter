import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeAllSessions } from "./psql-session";
import { resolvePgConfig } from "./pg-env";
import {
  getRow,
  interpretClaim,
  openPool,
  openSessions,
  pgEnabled,
  seedRow,
  stmt,
  waitForLockWaiters,
  type SessionPool,
} from "./fixture";

// C6 — lock_timeout / statement_timeout turn a stuck claim into an error, never into a claim.
describe.skipIf(!pgEnabled)("C6 timeouts fail closed", () => {
  let pool: SessionPool;
  beforeAll(async () => {
    pool = await openPool(resolvePgConfig());
  });
  afterAll(async () => {
    await closeAllSessions();
  });

  for (const [name, setting, message] of [
    ["lock_timeout", "lock_timeout", /lock timeout/i],
    ["statement_timeout", "statement_timeout", /statement timeout/i],
  ] as const) {
    it(`${name}: the blocked claimant errors out, is NOT treated as claimed, and the holder stays the only winner`, async () => {
      const tenant = randomUUID();
      const id = await seedRow(pool.admin, { tenant });
      const [holder, waiter] = await openSessions(pool.cfg, 2, `c6-${name}-`);
      try {
        const waiterPid = await waiter.backendPid();
        await holder.exec("begin;");
        expect(interpretClaim(await holder.exec(stmt.claim(id, tenant)))).toBe(true);

        expect((await waiter.exec(`set ${setting} = '300ms';`)).error).toBeNull();
        const blocked = waiter.exec(stmt.claim(id, tenant));
        await waitForLockWaiters(pool.admin, [waiterPid]);
        const timedOut = await blocked;

        expect(timedOut.error).toMatch(message);
        expect(interpretClaim(timedOut)).toBe(false);

        // The waiter never claimed anything: the holder's rollback leaves SCHEDULED.
        await holder.exec("rollback;");
        expect((await getRow(pool.admin, id)).status).toBe("SCHEDULED");

        // The timed-out session is healthy (not stuck in a transaction) and can claim normally later.
        expect((await waiter.exec(`reset ${setting};`)).error).toBeNull();
        expect(interpretClaim(await waiter.exec(stmt.claim(id, tenant)))).toBe(true);
      } finally {
        await Promise.all([holder.close(), waiter.close()]);
      }
    });
  }

  it("a timed-out claimant inside a transaction cannot commit a claim (transaction is aborted)", async () => {
    const tenant = randomUUID();
    const id = await seedRow(pool.admin, { tenant });
    const [holder, waiter] = await openSessions(pool.cfg, 2, "c6-tx-");
    try {
      const waiterPid = await waiter.backendPid();
      await holder.exec("begin;");
      await holder.exec(stmt.claim(id, tenant));
      await waiter.exec("begin; set local lock_timeout = '300ms';");
      const blocked = waiter.exec(stmt.claim(id, tenant));
      await waitForLockWaiters(pool.admin, [waiterPid]);
      expect((await blocked).error).toMatch(/lock timeout/i);
      const commit = await waiter.exec("commit;");
      expect(commit.rows.join(" ")).not.toMatch(/UPDATE/);
      await holder.exec("rollback;");
      expect((await getRow(pool.admin, id)).status).toBe("SCHEDULED");
    } finally {
      await Promise.all([holder.close(), waiter.close()]);
    }
  });
});
