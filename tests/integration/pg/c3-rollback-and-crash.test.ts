import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PsqlSession, closeAllSessions } from "./psql-session";
import { resolvePgConfig } from "./pg-env";
import {
  IN_PROGRESS_NOTE,
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

// C3 — rollback and crash behaviour of the claim.
describe.skipIf(!pgEnabled)("C3 rollback and crash", () => {
  let pool: SessionPool;
  beforeAll(async () => {
    pool = await openPool(resolvePgConfig());
  });
  afterAll(async () => {
    await closeAllSessions();
  });

  it("an uncommitted claim that is rolled back leaves the row SCHEDULED and hands the claim to the waiter", async () => {
    const tenant = randomUUID();
    const id = await seedRow(pool.admin, { tenant });
    const [holder, waiter] = await openSessions(pool.cfg, 2, "c3-rb-");
    try {
      const waiterPid = await waiter.backendPid();
      await holder.exec("begin;");
      expect(interpretClaim(await holder.exec(stmt.claim(id, tenant)))).toBe(true);
      const waiterRun = waiter.exec(stmt.claim(id, tenant));
      await waitForLockWaiters(pool.admin, [waiterPid]);

      await holder.exec("rollback;");
      expect(interpretClaim(await waiterRun)).toBe(true);
      expect((await getRow(pool.admin, id)).status).toBe("FAILED");
    } finally {
      await Promise.all([holder.close(), waiter.close()]);
    }
  });

  it("an error later in the same transaction rolls the claim back (no half-claimed row)", async () => {
    const tenant = randomUUID();
    const id = await seedRow(pool.admin, { tenant });
    const [s] = await openSessions(pool.cfg, 1, "c3-err-");
    try {
      await s.exec("begin;");
      expect(interpretClaim(await s.exec(stmt.claim(id, tenant)))).toBe(true);
      const bad = await s.exec(`update prompter_channel_campaigns set status = 'BOGUS' where id = '${id}';`);
      expect(bad.error).toMatch(/check constraint/i);
      await s.exec("rollback;");
      expect((await getRow(pool.admin, id)).status).toBe("SCHEDULED");
    } finally {
      await s.close();
    }
  });

  it("a client killed (SIGKILL) before COMMIT releases the lock; the waiting claimant wins and nothing was committed by the dead one", async () => {
    const tenant = randomUUID();
    const id = await seedRow(pool.admin, { tenant });
    const [holder, waiter] = await openSessions(pool.cfg, 2, "c3-kill-");
    try {
      const waiterPid = await waiter.backendPid();
      await holder.exec("begin;");
      expect(interpretClaim(await holder.exec(stmt.claim(id, tenant)))).toBe(true);
      const waiterRun = waiter.exec(stmt.claim(id, tenant));
      await waitForLockWaiters(pool.admin, [waiterPid]);

      await holder.crash();
      expect(interpretClaim(await waiterRun)).toBe(true);
      const row = await getRow(pool.admin, id);
      expect(row.status).toBe("FAILED");
      expect(row.error).toBe(IN_PROGRESS_NOTE);
    } finally {
      await waiter.close();
    }
  });

  it("a crash AFTER the claim committed keeps the row claimed: fail closed, no automatic release, no second launcher", async () => {
    const tenant = randomUUID();
    const id = await seedRow(pool.admin, { tenant });
    const launcher = await PsqlSession.open(pool.cfg, "c3-post");
    expect(interpretClaim(await launcher.exec(stmt.claim(id, tenant)))).toBe(true);
    await launcher.crash(); // process dies before any Meta call / progress write

    const row = await getRow(pool.admin, id);
    expect(row.status).toBe("FAILED");
    expect(row.error).toBe(IN_PROGRESS_NOTE);

    const [retry] = await openSessions(pool.cfg, 1, "c3-post-retry-");
    try {
      expect(interpretClaim(await retry.exec(stmt.claim(id, tenant)))).toBe(false);
    } finally {
      await retry.close();
    }
  });
});
