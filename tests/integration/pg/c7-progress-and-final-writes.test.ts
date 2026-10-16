import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeAllSessions } from "./psql-session";
import { resolvePgConfig } from "./pg-env";
import {
  ALL_STATUSES,
  getRow,
  interpretClaim,
  openPool,
  pgEnabled,
  seedRow,
  stmt,
  type SessionPool,
} from "./fixture";

// C7 — progress / final / failure writes only apply to a row that is still claimed (FAILED).
describe.skipIf(!pgEnabled)("C7 progress and final writes", () => {
  let pool: SessionPool;
  beforeAll(async () => {
    pool = await openPool(resolvePgConfig());
  });
  afterAll(async () => {
    await closeAllSessions();
  });

  const exec = (sql: string) => pool.admin.exec(sql);

  for (const status of ALL_STATUSES.filter((s) => s !== "FAILED")) {
    it(`progress, final-ACTIVE, failure and release writes are all rejected on a ${status} row`, async () => {
      const tenant = randomUUID();
      const id = await seedRow(pool.admin, { tenant, status, error: "keep", externalId: null });
      const writes = [
        stmt.progress(id, tenant, { external_campaign_id: "camp-1", error: "x" }),
        stmt.progress(id, tenant, { status: "ACTIVE", error: null }),
        stmt.fail(id, tenant, "boom", "camp-1"),
        stmt.release(id, tenant),
      ];
      for (const sql of writes) {
        const r = await exec(sql);
        expect(r.error).toBeNull();
        expect(interpretClaim(r)).toBe(false);
      }
      expect(await getRow(pool.admin, id)).toMatchObject({ status, error: "keep", external_campaign_id: null });
    });
  }

  it("an operator PAUSE between creates is not overwritten by the next progress or final write", async () => {
    const tenant = randomUUID();
    const id = await seedRow(pool.admin, { tenant });
    expect(interpretClaim(await exec(stmt.claim(id, tenant)))).toBe(true);
    expect(interpretClaim(await exec(stmt.progress(id, tenant, { external_campaign_id: "camp-1", error: "p1" })))).toBe(true);

    await exec(`update prompter_channel_campaigns set status = 'PAUSED' where id = '${id}';`);

    expect(interpretClaim(await exec(stmt.progress(id, tenant, { error: "p2" })))).toBe(false);
    expect(interpretClaim(await exec(stmt.progress(id, tenant, { status: "ACTIVE", error: null })))).toBe(false);
    expect((await getRow(pool.admin, id)).status).toBe("PAUSED");
  });

  it("happy path: claim -> progress -> final ACTIVE; afterwards every later write is rejected", async () => {
    const tenant = randomUUID();
    const id = await seedRow(pool.admin, { tenant });
    expect(interpretClaim(await exec(stmt.claim(id, tenant)))).toBe(true);
    expect(interpretClaim(await exec(stmt.progress(id, tenant, { external_campaign_id: "camp-9", error: "step" })))).toBe(true);
    expect(interpretClaim(await exec(stmt.progress(id, tenant, { status: "ACTIVE", error: null })))).toBe(true);
    expect(await getRow(pool.admin, id)).toMatchObject({ status: "ACTIVE", error: null, external_campaign_id: "camp-9" });

    expect(interpretClaim(await exec(stmt.progress(id, tenant, { error: "late" })))).toBe(false);
    expect(interpretClaim(await exec(stmt.release(id, tenant)))).toBe(false);
    expect((await getRow(pool.admin, id)).status).toBe("ACTIVE");
  });

  it("release (only 'createCampaign 4xx, nothing created') returns a claimed row to SCHEDULED, then it can be claimed again once", async () => {
    const tenant = randomUUID();
    const id = await seedRow(pool.admin, { tenant });
    expect(interpretClaim(await exec(stmt.claim(id, tenant)))).toBe(true);
    expect(interpretClaim(await exec(stmt.release(id, tenant)))).toBe(true);
    expect((await getRow(pool.admin, id)).status).toBe("SCHEDULED");
    expect(interpretClaim(await exec(stmt.claim(id, tenant)))).toBe(true);
    expect(interpretClaim(await exec(stmt.claim(id, tenant)))).toBe(false);
  });

  it("a progress write by the wrong tenant matches nothing", async () => {
    const tenant = randomUUID();
    const id = await seedRow(pool.admin, { tenant });
    await exec(stmt.claim(id, tenant));
    expect(interpretClaim(await exec(stmt.progress(id, randomUUID(), { status: "ACTIVE", error: null })))).toBe(false);
    expect((await getRow(pool.admin, id)).status).toBe("FAILED");
  });
});
