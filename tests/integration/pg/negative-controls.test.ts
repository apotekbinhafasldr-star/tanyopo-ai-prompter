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
  raceStatements,
  returnedIds,
  seedRow,
  stmt,
  winnersOf,
  type SessionPool,
} from "./fixture";

/**
 * NEGATIVE CONTROLS — prove the harness can fail. Each deliberately unsafe
 * claim implementation MUST be detected (more than one winner, or a
 * cross-tenant winner). If one of these starts passing as "safe", the harness
 * has gone blind and the C1/C4 results mean nothing.
 */
describe.skipIf(!pgEnabled)("negative controls", () => {
  let pool: SessionPool;
  beforeAll(async () => {
    pool = await openPool(resolvePgConfig());
  });
  afterAll(async () => {
    await closeAllSessions();
  });

  it("barrier sanity: 8 sessions run pg_sleep in parallel, not serially", async () => {
    const sessions = await openSessions(pool.cfg, 8, "nc-barrier-");
    try {
      const started = Date.now();
      const results = await raceStatements(
        pool,
        sessions,
        sessions.map(() => "select extract(epoch from clock_timestamp()); select pg_sleep(0.5);"),
      );
      const elapsed = Date.now() - started;
      expect(elapsed).toBeLessThan(3_000); // serial would be >= 4 s
      const starts = results.map((r) => Number(r.rows[0])).filter((n) => Number.isFinite(n));
      expect(starts).toHaveLength(8);
      expect(Math.max(...starts) - Math.min(...starts)).toBeLessThan(1);
    } finally {
      await Promise.all(sessions.map((s) => s.close()));
    }
  });

  it("NC1 rewrite-only-error claim (the PR #35 defect): every racer 'wins' and the row is still SCHEDULED", async () => {
    const tenant = randomUUID();
    const id = await seedRow(pool.admin, { tenant });
    const sessions = await openSessions(pool.cfg, 8, "nc1-");
    try {
      const results = await raceStatements(
        pool,
        sessions,
        sessions.map(() => stmt.unsafeRewriteErrorOnly(id, tenant)),
      );
      expect(winnersOf(results)).toBeGreaterThan(1);
      expect((await getRow(pool.admin, id)).status).toBe("SCHEDULED");
    } finally {
      await Promise.all(sessions.map((s) => s.close()));
    }
  });

  it("NC2 unconditional claim (no status predicate): all racers win", async () => {
    const tenant = randomUUID();
    const id = await seedRow(pool.admin, { tenant });
    const sessions = await openSessions(pool.cfg, 8, "nc2-");
    try {
      const results = await raceStatements(
        pool,
        sessions,
        sessions.map(() => stmt.unsafeUnconditionalClaim(id, tenant)),
      );
      expect(winnersOf(results)).toBe(8);
    } finally {
      await Promise.all(sessions.map((s) => s.close()));
    }
  });

  it("NC3 check-then-act (read status, then write unconditionally): more than one racer sees SCHEDULED and wins", async () => {
    const tenant = randomUUID();
    const id = await seedRow(pool.admin, { tenant });
    const sessions = await openSessions(pool.cfg, 8, "nc3-");
    try {
      const reads = await raceStatements(
        pool,
        sessions,
        sessions.map(() => stmt.readStatus(id)),
      );
      const sawScheduled = reads.map((r) => r.rows[0] === "SCHEDULED");
      expect(sawScheduled.filter(Boolean).length).toBeGreaterThan(1);

      const writes = await raceStatements(
        pool,
        sessions,
        sessions.map((_, i) => (sawScheduled[i] ? stmt.unsafeUnconditionalClaim(id, tenant) : "select 1;")),
      );
      const winners = writes.filter((r, i) => sawScheduled[i] && interpretClaim(r)).length;
      expect(winners).toBeGreaterThan(1);
    } finally {
      await Promise.all(sessions.map((s) => s.close()));
    }
  });

  it("NC4 claim without tenant predicate: another tenant's session wins the owner's row", async () => {
    const owner = randomUUID();
    const id = await seedRow(pool.admin, { tenant: owner });
    const intruder = await pool.admin.exec(stmt.unsafeNoTenantClaim(id));
    expect(returnedIds(intruder)).toEqual([id]);
    expect((await getRow(pool.admin, id)).status).toBe("FAILED");
    // The same attempt through the real claim (with the wrong tenant) loses: see C4.
    const real = await seedRow(pool.admin, { tenant: owner });
    expect(interpretClaim(await pool.admin.exec(stmt.claim(real, randomUUID())))).toBe(false);
  });
});
