import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeAllSessions } from "./psql-session";
import { resolvePgConfig } from "./pg-env";
import {
  IN_PROGRESS_NOTE,
  getRow,
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

// C1 — N truly concurrent claims on one SCHEDULED row: exactly one winner.
describe.skipIf(!pgEnabled)("C1 concurrent claims", () => {
  let pool: SessionPool;
  beforeAll(async () => {
    pool = await openPool(resolvePgConfig());
  });
  afterAll(async () => {
    await closeAllSessions();
  });

  for (const n of [2, 8, 32]) {
    it(`${n} concurrent claims -> exactly one winner, row FAILED + in-progress note`, async () => {
      const tenant = randomUUID();
      const id = await seedRow(pool.admin, { tenant });
      const sessions = await openSessions(pool.cfg, n, `c1-${n}-`);
      try {
        const results = await raceStatements(
          pool,
          sessions,
          sessions.map(() => stmt.claim(id, tenant)),
        );
        expect(results.every((r) => r.error === null)).toBe(true);
        expect(winnersOf(results)).toBe(1);
        const total = results.reduce((sum, r) => sum + returnedIds(r).length, 0);
        expect(total).toBe(1);

        const row = await getRow(pool.admin, id);
        expect(row.status).toBe("FAILED");
        expect(row.error).toBe(IN_PROGRESS_NOTE);
      } finally {
        await Promise.all(sessions.map((s) => s.close()));
      }
    });
  }

  it("repeats the 8-way race 10 times on fresh rows: never 0, never 2 winners", async () => {
    const sessions = await openSessions(pool.cfg, 8, "c1-rep-");
    try {
      for (let round = 0; round < 10; round++) {
        const tenant = randomUUID();
        const id = await seedRow(pool.admin, { tenant });
        const results = await raceStatements(
          pool,
          sessions,
          sessions.map(() => stmt.claim(id, tenant)),
        );
        expect(winnersOf(results)).toBe(1);
      }
    } finally {
      await Promise.all(sessions.map((s) => s.close()));
    }
  });

  it("a claim never matches more than one row even when many rows are SCHEDULED", async () => {
    const tenant = randomUUID();
    const a = await seedRow(pool.admin, { tenant });
    const b = await seedRow(pool.admin, { tenant });
    const [session] = await openSessions(pool.cfg, 1, "c1-two-");
    try {
      const first = await session.exec(stmt.claim(a, tenant));
      expect(returnedIds(first)).toEqual([a]);
      expect((await getRow(pool.admin, b)).status).toBe("SCHEDULED");
    } finally {
      await session.close();
    }
  });
});
