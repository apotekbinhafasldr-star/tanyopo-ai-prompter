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
  seedRow,
  stmt,
  winnersOf,
  type SessionPool,
} from "./fixture";

// C8 — Facebook and Instagram channel rows of one master campaign are independent.
describe.skipIf(!pgEnabled)("C8 channel independence", () => {
  let pool: SessionPool;
  beforeAll(async () => {
    pool = await openPool(resolvePgConfig());
  });
  afterAll(async () => {
    await closeAllSessions();
  });

  it("claiming Facebook does not touch Instagram of the same master campaign", async () => {
    const tenant = randomUUID();
    const master = randomUUID();
    const fb = await seedRow(pool.admin, { tenant, master, channel: "FACEBOOK" });
    const ig = await seedRow(pool.admin, { tenant, master, channel: "INSTAGRAM" });
    expect(interpretClaim(await pool.admin.exec(stmt.claim(fb, tenant)))).toBe(true);
    expect((await getRow(pool.admin, ig)).status).toBe("SCHEDULED");
    expect(interpretClaim(await pool.admin.exec(stmt.claim(ig, tenant)))).toBe(true);
  });

  it("4 racing claims per channel: exactly one winner per channel (two in total)", async () => {
    const tenant = randomUUID();
    const master = randomUUID();
    const fb = await seedRow(pool.admin, { tenant, master, channel: "FACEBOOK" });
    const ig = await seedRow(pool.admin, { tenant, master, channel: "INSTAGRAM" });
    const sessions = await openSessions(pool.cfg, 8, "c8-race-");
    try {
      const results = await raceStatements(
        pool,
        sessions,
        sessions.map((_, i) => stmt.claim(i < 4 ? fb : ig, tenant)),
      );
      expect(winnersOf(results.slice(0, 4))).toBe(1);
      expect(winnersOf(results.slice(4))).toBe(1);
      expect((await getRow(pool.admin, fb)).status).toBe("FAILED");
      expect((await getRow(pool.admin, ig)).status).toBe("FAILED");
    } finally {
      await Promise.all(sessions.map((s) => s.close()));
    }
  });

  it("a failed Facebook launch does not release, fail or alter Instagram", async () => {
    const tenant = randomUUID();
    const master = randomUUID();
    const fb = await seedRow(pool.admin, { tenant, master, channel: "FACEBOOK" });
    const ig = await seedRow(pool.admin, { tenant, master, channel: "INSTAGRAM" });
    await pool.admin.exec(stmt.claim(fb, tenant));
    await pool.admin.exec(stmt.claim(ig, tenant));
    await pool.admin.exec(stmt.fail(fb, tenant, "Facebook gagal", "fb-camp"));
    await pool.admin.exec(stmt.progress(ig, tenant, { status: "ACTIVE", error: null }));
    expect(await getRow(pool.admin, fb)).toMatchObject({ status: "FAILED", error: "Facebook gagal", external_campaign_id: "fb-camp" });
    expect(await getRow(pool.admin, ig)).toMatchObject({ status: "ACTIVE", error: null });
  });

  it("the (master_campaign_id, channel) unique constraint forbids a duplicate channel row", async () => {
    const tenant = randomUUID();
    const master = randomUUID();
    await seedRow(pool.admin, { tenant, master, channel: "FACEBOOK" });
    await expect(seedRow(pool.admin, { tenant, master, channel: "FACEBOOK" })).rejects.toThrow(/unique|duplicate/i);
  });
});
