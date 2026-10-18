import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeAllSessions } from "./psql-session";
import { resolvePgConfig } from "./pg-env";
import {
  IN_PROGRESS_NOTE,
  getRow,
  interpretClaim,
  openAsTenant,
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

// C4 — cross-tenant claim isolation (explicit tenant predicate AND RLS).
describe.skipIf(!pgEnabled)("C4 tenant isolation", () => {
  let pool: SessionPool;
  beforeAll(async () => {
    pool = await openPool(resolvePgConfig());
  });
  afterAll(async () => {
    await closeAllSessions();
  });

  it("claiming another tenant's row (right id, wrong tenant) matches nothing and changes nothing", async () => {
    const owner = randomUUID();
    const other = randomUUID();
    const id = await seedRow(pool.admin, { tenant: owner });
    const result = await pool.admin.exec(stmt.claim(id, other));
    expect(result.error).toBeNull();
    expect(returnedIds(result)).toHaveLength(0);
    const row = await getRow(pool.admin, id);
    expect(row.status).toBe("SCHEDULED");
    expect(row.error).toBeNull();
  });

  it("4 claims by the owning tenant racing 4 claims by another tenant: exactly one winner, and it is the owner", async () => {
    const owner = randomUUID();
    const other = randomUUID();
    const id = await seedRow(pool.admin, { tenant: owner });
    const sessions = await openSessions(pool.cfg, 8, "c4-race-");
    try {
      const results = await raceStatements(
        pool,
        sessions,
        sessions.map((_, i) => stmt.claim(id, i % 2 === 0 ? owner : other)),
      );
      expect(winnersOf(results)).toBe(1);
      const winnerIndex = results.findIndex(interpretClaim);
      expect(winnerIndex % 2).toBe(0); // owner sessions are the even indexes
      expect((await getRow(pool.admin, id)).tenant_id).toBe(owner);
    } finally {
      await Promise.all(sessions.map((s) => s.close()));
    }
  });

  describe("RLS (SET ROLE authenticated, policies from the migration)", () => {
    it("another tenant cannot see or update the row", async () => {
      const owner = randomUUID();
      const other = randomUUID();
      const id = await seedRow(pool.admin, { tenant: owner });
      const s = await openAsTenant(pool.cfg, other, "owner", "c4-rls-other");
      try {
        const seen = await s.exec(`select count(*) from prompter_channel_campaigns where id = '${id}';`);
        expect(seen.rows[0]).toBe("0");
        // Even with the correct tenant predicate forged to the row's tenant, RLS filters it.
        const forged = await s.exec(stmt.claim(id, owner));
        expect(returnedIds(forged)).toHaveLength(0);
        expect((await getRow(pool.admin, id)).status).toBe("SCHEDULED");
      } finally {
        await s.close();
      }
    });

    it("a session with no tenant context sees nothing", async () => {
      const id = await seedRow(pool.admin, { tenant: randomUUID() });
      const s = await openAsTenant(pool.cfg, "", "", "c4-rls-none");
      // set_config with '' yields NULL tenant: fn_current_tenant_id() is NULL, no row matches.
      {
        try {
          const seen = await s.exec(`select count(*) from prompter_channel_campaigns where id = '${id}';`);
          expect(seen.rows[0]).toBe("0");
        } finally {
          await s.close();
        }
      }
    });

    it("a same-tenant viewer can read but cannot claim; owner and marketing can", async () => {
      const tenant = randomUUID();
      const id = await seedRow(pool.admin, { tenant });
      const viewer = await openAsTenant(pool.cfg, tenant, "viewer", "c4-rls-viewer");
      try {
        const seen = await viewer.exec(`select count(*) from prompter_channel_campaigns where id = '${id}';`);
        expect(seen.rows[0]).toBe("1");
        expect(interpretClaim(await viewer.exec(stmt.claim(id, tenant)))).toBe(false);
        expect((await getRow(pool.admin, id)).status).toBe("SCHEDULED");
      } finally {
        await viewer.close();
      }

      const marketing = await openAsTenant(pool.cfg, tenant, "marketing", "c4-rls-marketing");
      try {
        expect(interpretClaim(await marketing.exec(stmt.claim(id, tenant)))).toBe(true);
        expect((await getRow(pool.admin, id)).error).toBe(IN_PROGRESS_NOTE);
      } finally {
        await marketing.close();
      }
    });

    it("an owner cannot move a row to another tenant (WITH CHECK)", async () => {
      const tenant = randomUUID();
      const other = randomUUID();
      const id = await seedRow(pool.admin, { tenant });
      const s = await openAsTenant(pool.cfg, tenant, "owner", "c4-rls-move");
      try {
        const moved = await s.exec(
          `update prompter_channel_campaigns set tenant_id = '${other}' where id = '${id}';`,
        );
        expect(moved.error).toMatch(/row-level security/i);
        expect((await getRow(pool.admin, id)).tenant_id).toBe(tenant);
      } finally {
        await s.close();
      }
    });

    it("concurrent claims through RLS-scoped sessions still yield one winner", async () => {
      const tenant = randomUUID();
      const id = await seedRow(pool.admin, { tenant });
      const sessions = await Promise.all(
        Array.from({ length: 6 }, (_, i) => openAsTenant(pool.cfg, tenant, "owner", `c4-rls-race-${i}`)),
      );
      try {
        const results = await raceStatements(
          pool,
          sessions,
          sessions.map(() => stmt.claim(id, tenant)),
        );
        expect(winnersOf(results)).toBe(1);
      } finally {
        await Promise.all(sessions.map((s) => s.close()));
      }
    });
  });
});
