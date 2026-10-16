import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeAllSessions } from "./psql-session";
import { resolvePgConfig } from "./pg-env";
import {
  ALL_STATUSES,
  IN_PROGRESS_NOTE,
  getRow,
  interpretClaim,
  openPool,
  openSessions,
  pgEnabled,
  raceStatements,
  seedRow,
  stmt,
  winnersOf,
  type SessionPool,
} from "./fixture";

// C5 — the claim accepts SCHEDULED and nothing else.
describe.skipIf(!pgEnabled)("C5 claim status gate", () => {
  let pool: SessionPool;
  beforeAll(async () => {
    pool = await openPool(resolvePgConfig());
  });
  afterAll(async () => {
    await closeAllSessions();
  });

  for (const status of ALL_STATUSES.filter((s) => s !== "SCHEDULED")) {
    it(`rejects a ${status} row and leaves it untouched`, async () => {
      const tenant = randomUUID();
      const id = await seedRow(pool.admin, { tenant, status, error: "original", externalId: "ext-1" });
      const result = await pool.admin.exec(stmt.claim(id, tenant));
      expect(result.error).toBeNull();
      expect(interpretClaim(result)).toBe(false);
      const row = await getRow(pool.admin, id);
      expect(row).toMatchObject({ status, error: "original", external_campaign_id: "ext-1" });
    });
  }

  it("accepts SCHEDULED exactly once (a second claim sees FAILED and loses)", async () => {
    const tenant = randomUUID();
    const id = await seedRow(pool.admin, { tenant });
    expect(interpretClaim(await pool.admin.exec(stmt.claim(id, tenant)))).toBe(true);
    expect(interpretClaim(await pool.admin.exec(stmt.claim(id, tenant)))).toBe(false);
    expect((await getRow(pool.admin, id)).error).toBe(IN_PROGRESS_NOTE);
  });

  it("8 concurrent claims on an ACTIVE row: zero winners", async () => {
    const tenant = randomUUID();
    const id = await seedRow(pool.admin, { tenant, status: "ACTIVE", externalId: "ext-2" });
    const sessions = await openSessions(pool.cfg, 8, "c5-active-");
    try {
      const results = await raceStatements(
        pool,
        sessions,
        sessions.map(() => stmt.claim(id, tenant)),
      );
      expect(winnersOf(results)).toBe(0);
      expect((await getRow(pool.admin, id)).status).toBe("ACTIVE");
    } finally {
      await Promise.all(sessions.map((s) => s.close()));
    }
  });

  it("a row paused by an operator between two claim attempts cannot be claimed", async () => {
    const tenant = randomUUID();
    const id = await seedRow(pool.admin, { tenant });
    await pool.admin.exec(`update prompter_channel_campaigns set status = 'PAUSED' where id = '${id}';`);
    expect(interpretClaim(await pool.admin.exec(stmt.claim(id, tenant)))).toBe(false);
  });
});
