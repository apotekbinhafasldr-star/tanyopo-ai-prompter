import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PsqlSession, closeAllSessions } from "./psql-session";
import { resolvePgConfig, type PgConfig } from "./pg-env";
import { lit, openPool, pgEnabled, seedRow, type SessionPool } from "./fixture";

/**
 * C13 — Winning Ads Phase 2B: prompter_manual_ad_metrics against a real
 * PostgreSQL 16.
 *
 * The table, its guard function/trigger and its RLS policies are loaded from the
 * REAL migration file (only the foreign keys to production tables, which must
 * not exist in this throw-away database, are stripped), so there is no
 * hand-copied fixture that could drift from what would be applied.
 *
 * What is proven here, with RLS genuinely enforced (SET ROLE authenticated):
 *   - tenant integrity holds when a client writes straight to the database API:
 *     the RLS WITH CHECK ALONE rejects a foreign/mismatched/launched channel
 *     campaign (trigger disabled for that block), AND the guard trigger ALONE
 *     rejects the same writes even for a role that bypasses RLS;
 *   - role gating, cross-tenant read/update/delete isolation, anon lockout;
 *   - every CHECK constraint, the unique (channel campaign, date) rule, and
 *     identity-column immutability.
 */

const MIGRATION = fileURLToPath(
  new URL("../../../supabase/migrations/20261018160000_prompter_manual_ad_metrics.sql", import.meta.url),
);

function loadableMigration(): string {
  return readFileSync(MIGRATION, "utf8").replace(/\s+references public\.\w+\(id\) on delete cascade/g, "");
}

const TABLE = "prompter_manual_ad_metrics";
const TRIGGER = "trg_prompter_manual_ad_metrics_guard";

interface Row {
  tenant: string;
  master: string;
  cc: string;
  channel?: string;
  date?: string;
  spend?: number;
  impressions?: number;
  clicks?: number;
  conversions?: number;
  revenue?: number;
  currency?: string;
  enteredBy?: string | null;
}

function insertSql(r: Row, returning = true): string {
  return `insert into ${TABLE}
    (tenant_id, master_campaign_id, channel_campaign_id, channel, metric_date, spend, impressions, clicks, conversions, revenue, currency, entered_by)
    values (${lit(r.tenant)}, ${lit(r.master)}, ${lit(r.cc)}, ${lit(r.channel ?? "FACEBOOK")},
            ${r.date ? lit(r.date) : "current_date"}, ${r.spend ?? 150000}, ${r.impressions ?? 12000}, ${r.clicks ?? 300},
            ${r.conversions ?? 10}, ${r.revenue ?? 300000}, ${lit(r.currency ?? "IDR")}, ${r.enteredBy === undefined ? "null" : lit(r.enteredBy)})
    ${returning ? "returning id" : ""};`;
}

async function openAs(cfg: PgConfig, tenant: string, role: string, user: string, label: string): Promise<PsqlSession> {
  const s = await PsqlSession.open(cfg, label);
  const r = await s.exec(
    `set role authenticated; select set_config('app.tenant_id', ${lit(tenant)}, false), set_config('app.role', ${lit(role)}, false), set_config('app.user_id', ${lit(user)}, false);`,
  );
  if (r.error) throw new Error(`openAs failed: ${r.error}`);
  return s;
}

const RLS = /row-level security|violates row-level/i;

describe.skipIf(!pgEnabled)("C13 manual ad metrics (Winning Ads Phase 2B)", () => {
  let pool: SessionPool;

  beforeAll(async () => {
    pool = await openPool(resolvePgConfig());
    const setup = await pool.admin.exec(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      end $$;
      create schema if not exists auth;
      create or replace function auth.uid() returns uuid language sql stable
        as $f$ select nullif(current_setting('app.user_id', true), '')::uuid $f$;
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;
      drop table if exists ${TABLE} cascade;
    `);
    if (setup.error) throw new Error(`c13 prerequisites failed: ${setup.error}`);
    const loaded = await pool.admin.exec(loadableMigration(), 60_000);
    if (loaded.error) throw new Error(`migration failed to load: ${loaded.error}`);
  });

  afterAll(async () => {
    await closeAllSessions();
  });

  async function tenantWithChannel(opts: { channel?: "FACEBOOK" | "INSTAGRAM" | "TIKTOK" | "X" | "SEO"; externalId?: string | null } = {}) {
    const tenant = randomUUID();
    const master = randomUUID();
    const cc = await seedRow(pool.admin, {
      tenant,
      master,
      channel: opts.channel ?? "FACEBOOK",
      status: "DRAFT",
      externalId: opts.externalId ?? null,
    });
    return { tenant, master, cc, user: randomUUID() };
  }

  async function count(where: string): Promise<number> {
    const r = await pool.admin.exec(`select count(*) from ${TABLE} where ${where};`);
    return Number(r.rows[0]);
  }

  describe("happy path and audit columns", () => {
    it("an owner can insert a valid row for their own channel campaign; entered_by comes from auth.uid(), not the client", async () => {
      const t = await tenantWithChannel();
      const forged = randomUUID();
      const s = await openAs(pool.cfg, t.tenant, "owner", t.user, "c13-ok");
      try {
        const r = await s.exec(insertSql({ ...t, enteredBy: forged }));
        expect(r.error).toBeNull();
      } finally {
        await s.close();
      }
      const row = await pool.admin.exec(`select entered_by, updated_by from ${TABLE} where channel_campaign_id = ${lit(t.cc)};`);
      expect(row.rows[0]).toBe(`${t.user}|${t.user}`);
    });

    it("a marketing user can insert too", async () => {
      const t = await tenantWithChannel();
      const s = await openAs(pool.cfg, t.tenant, "marketing", t.user, "c13-mkt");
      try {
        expect((await s.exec(insertSql(t))).error).toBeNull();
      } finally {
        await s.close();
      }
    });
  });

  describe("role gating", () => {
    for (const role of ["viewer", "finance", "support", ""]) {
      it(`role "${role || "(none)"}" cannot insert`, async () => {
        const t = await tenantWithChannel();
        const s = await openAs(pool.cfg, t.tenant, role, t.user, "c13-role");
        try {
          expect((await s.exec(insertSql(t))).error).toMatch(RLS);
        } finally {
          await s.close();
        }
        expect(await count(`channel_campaign_id = ${lit(t.cc)}`)).toBe(0);
      });
    }

    it("a viewer can read own-tenant rows but cannot update or delete them", async () => {
      const t = await tenantWithChannel();
      await pool.admin.exec(insertSql(t));
      const s = await openAs(pool.cfg, t.tenant, "viewer", t.user, "c13-viewer");
      try {
        expect((await s.exec(`select count(*) from ${TABLE};`)).rows[0]).toBe("1");
        await s.exec(`update ${TABLE} set spend = 1;`);
        await s.exec(`delete from ${TABLE};`);
      } finally {
        await s.close();
      }
      const after = await pool.admin.exec(`select spend from ${TABLE} where channel_campaign_id = ${lit(t.cc)};`);
      expect(Number(after.rows[0])).toBe(150000);
    });
  });

  describe("cross-tenant isolation", () => {
    it("another tenant cannot read, update or delete the rows", async () => {
      const a = await tenantWithChannel();
      const b = await tenantWithChannel();
      await pool.admin.exec(insertSql(a));
      const s = await openAs(pool.cfg, b.tenant, "owner", b.user, "c13-other");
      try {
        expect((await s.exec(`select count(*) from ${TABLE} where tenant_id = ${lit(a.tenant)};`)).rows[0]).toBe("0");
        await s.exec(`update ${TABLE} set spend = 1 where tenant_id = ${lit(a.tenant)};`);
        await s.exec(`delete from ${TABLE} where tenant_id = ${lit(a.tenant)};`);
      } finally {
        await s.close();
      }
      expect(await count(`tenant_id = ${lit(a.tenant)} and spend = 150000`)).toBe(1);
    });

    it("anon has no privileges on the table at all", async () => {
      const s = await PsqlSession.open(pool.cfg, "c13-anon");
      try {
        await s.exec("set role anon;");
        expect((await s.exec(`select count(*) from ${TABLE};`)).error).toMatch(/permission denied/i);
        expect((await s.exec(insertSql({ tenant: randomUUID(), master: randomUUID(), cc: randomUUID() }))).error).toMatch(
          /permission denied/i,
        );
      } finally {
        await s.close();
      }
    });
  });

  describe("tenant integrity through the guard trigger ALONE (a role that bypasses RLS)", () => {
    it("rejects a channel campaign that belongs to another tenant", async () => {
      const a = await tenantWithChannel();
      const b = await tenantWithChannel();
      const r = await pool.admin.exec(insertSql({ tenant: b.tenant, master: a.master, cc: a.cc }));
      expect(r.error).toMatch(/belongs to another tenant/);
      expect(await count(`channel_campaign_id = ${lit(a.cc)}`)).toBe(0);
    });

    it("rejects a channel campaign id that does not exist", async () => {
      const t = await tenantWithChannel();
      const r = await pool.admin.exec(insertSql({ ...t, cc: randomUUID() }));
      expect(r.error).toMatch(/channel campaign not found/);
    });

    it("rejects a master campaign that does not match the channel campaign", async () => {
      const t = await tenantWithChannel();
      const r = await pool.admin.exec(insertSql({ ...t, master: randomUUID() }));
      expect(r.error).toMatch(/master campaign does not match/);
    });

    it("rejects a channel that does not match the channel campaign", async () => {
      const t = await tenantWithChannel({ channel: "FACEBOOK" });
      const r = await pool.admin.exec(insertSql({ ...t, channel: "TIKTOK" }));
      expect(r.error).toMatch(/channel does not match/);
    });

    it("rejects a channel campaign that already has an external campaign id", async () => {
      const t = await tenantWithChannel({ externalId: "ext-123" });
      const r = await pool.admin.exec(insertSql(t));
      expect(r.error).toMatch(/external campaign id/);
      expect(await count(`channel_campaign_id = ${lit(t.cc)}`)).toBe(0);
    });

    it("rejects a future date (and accepts tomorrow, for timezones ahead of UTC)", async () => {
      const t = await tenantWithChannel();
      const future = await pool.admin.exec(insertSql({ ...t, date: "2999-01-01" }));
      expect(future.error).toMatch(/in the future/);
      const tomorrow = await pool.admin.exec(
        insertSql({ ...t, date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) }),
      );
      expect(tomorrow.error).toBeNull();
    });
  });

  describe("tenant integrity through RLS WITH CHECK ALONE (guard trigger temporarily disabled)", () => {
    beforeAll(async () => {
      const r = await pool.admin.exec(`alter table ${TABLE} disable trigger ${TRIGGER};`);
      if (r.error) throw new Error(r.error);
    });
    afterAll(async () => {
      const r = await pool.admin.exec(`alter table ${TABLE} enable trigger ${TRIGGER};`);
      if (r.error) throw new Error(r.error);
    });

    it("sanity: the trigger really is disabled for this block", async () => {
      const t = await tenantWithChannel({ externalId: "ext-1" });
      expect((await pool.admin.exec(insertSql(t))).error).toBeNull(); // would be rejected if the trigger ran
      await pool.admin.exec(`delete from ${TABLE} where channel_campaign_id = ${lit(t.cc)};`);
    });

    it("an owner cannot attach a row to ANOTHER tenant's channel campaign", async () => {
      const mine = await tenantWithChannel();
      const theirs = await tenantWithChannel();
      const s = await openAs(pool.cfg, mine.tenant, "owner", mine.user, "c13-rls-foreign");
      try {
        const r = await s.exec(insertSql({ tenant: mine.tenant, master: theirs.master, cc: theirs.cc }));
        expect(r.error).toMatch(RLS);
      } finally {
        await s.close();
      }
      expect(await count(`channel_campaign_id = ${lit(theirs.cc)}`)).toBe(0);
    });

    it("an owner cannot write a row stamped with another tenant's id", async () => {
      const mine = await tenantWithChannel();
      const theirs = await tenantWithChannel();
      const s = await openAs(pool.cfg, mine.tenant, "owner", mine.user, "c13-rls-stamp");
      try {
        const r = await s.exec(insertSql({ tenant: theirs.tenant, master: theirs.master, cc: theirs.cc }));
        expect(r.error).toMatch(RLS);
      } finally {
        await s.close();
      }
    });

    it("an owner cannot use own channel campaign with a wrong master campaign or channel", async () => {
      const t = await tenantWithChannel({ channel: "FACEBOOK" });
      const s = await openAs(pool.cfg, t.tenant, "owner", t.user, "c13-rls-mismatch");
      try {
        expect((await s.exec(insertSql({ ...t, master: randomUUID() }))).error).toMatch(RLS);
        expect((await s.exec(insertSql({ ...t, channel: "TIKTOK" }))).error).toMatch(RLS);
      } finally {
        await s.close();
      }
      expect(await count(`channel_campaign_id = ${lit(t.cc)}`)).toBe(0);
    });

    it("an owner cannot insert for a channel campaign that already has an external campaign id", async () => {
      const t = await tenantWithChannel({ externalId: "ext-9" });
      const s = await openAs(pool.cfg, t.tenant, "owner", t.user, "c13-rls-ext");
      try {
        expect((await s.exec(insertSql(t))).error).toMatch(RLS);
      } finally {
        await s.close();
      }
    });

    it("an owner cannot MOVE an existing row to another tenant's channel campaign via UPDATE", async () => {
      const mine = await tenantWithChannel();
      const theirs = await tenantWithChannel();
      await pool.admin.exec(insertSql(mine));
      const s = await openAs(pool.cfg, mine.tenant, "owner", mine.user, "c13-rls-move");
      try {
        const r = await s.exec(
          `update ${TABLE} set channel_campaign_id = ${lit(theirs.cc)}, master_campaign_id = ${lit(theirs.master)} where channel_campaign_id = ${lit(mine.cc)};`,
        );
        expect(r.error).toMatch(RLS);
      } finally {
        await s.close();
      }
      expect(await count(`channel_campaign_id = ${lit(mine.cc)}`)).toBe(1);
      expect(await count(`channel_campaign_id = ${lit(theirs.cc)}`)).toBe(0);
    });

    it("an owner cannot UPDATE a row whose channel campaign has since been launched", async () => {
      const t = await tenantWithChannel();
      await pool.admin.exec(insertSql(t));
      await pool.admin.exec(`update prompter_channel_campaigns set external_campaign_id = 'ext-late' where id = ${lit(t.cc)};`);
      const s = await openAs(pool.cfg, t.tenant, "owner", t.user, "c13-rls-late");
      try {
        const r = await s.exec(`update ${TABLE} set spend = 1 where channel_campaign_id = ${lit(t.cc)};`);
        expect(r.error).toMatch(RLS);
      } finally {
        await s.close();
      }
      expect(await count(`channel_campaign_id = ${lit(t.cc)} and spend = 150000`)).toBe(1);
    });
  });

  describe("CHECK constraints (database-enforced, independent of the app)", () => {
    const bad: Array<[string, Partial<Row>, RegExp]> = [
      ["negative spend", { spend: -1 }, /spend_range/],
      ["spend over the cap", { spend: 100_000_000_001 }, /spend_range|out of range/],
      ["negative revenue", { revenue: -1, conversions: 1 }, /revenue_range/],
      ["negative impressions", { impressions: -1 }, /impressions_range|clicks_le_impressions/],
      ["clicks greater than impressions", { impressions: 10, clicks: 11, conversions: 0, revenue: 0 }, /clicks_le_impressions/],
      ["conversions greater than clicks", { clicks: 5, conversions: 6, revenue: 0 }, /conversions_le_clicks/],
      ["revenue without any conversion", { conversions: 0, revenue: 5 }, /revenue_needs_conversions/],
      ["lowercase currency", { currency: "idr" }, /currency/],
      ["currency of the wrong length", { currency: "RUPIAH" }, /currency/],
      ["date before the floor", { date: "2019-12-31" }, /date_floor/],
    ];
    for (const [name, patch, re] of bad) {
      it(`rejects ${name}`, async () => {
        const t = await tenantWithChannel();
        const r = await pool.admin.exec(insertSql({ ...t, ...patch }));
        expect(r.error).toMatch(re);
        expect(await count(`channel_campaign_id = ${lit(t.cc)}`)).toBe(0);
      });
    }

    it("rejects SEO (not a paid-ad channel)", async () => {
      const t = await tenantWithChannel({ channel: "SEO" });
      const r = await pool.admin.exec(insertSql({ ...t, channel: "SEO" }));
      expect(r.error).toMatch(/prompter_manual_ad_metrics_channel/);
    });

    it("accepts the boundary values", async () => {
      const t = await tenantWithChannel();
      const r = await pool.admin.exec(
        insertSql({ ...t, spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 }),
      );
      expect(r.error).toBeNull();
    });
  });

  describe("duplicates and updates", () => {
    it("a second row for the same channel campaign and date is rejected (unique), a different date is fine", async () => {
      const t = await tenantWithChannel();
      expect((await pool.admin.exec(insertSql({ ...t, date: "2026-10-01" }))).error).toBeNull();
      expect((await pool.admin.exec(insertSql({ ...t, date: "2026-10-01" }))).error).toMatch(/prompter_manual_ad_metrics_unique/);
      expect((await pool.admin.exec(insertSql({ ...t, date: "2026-10-02" }))).error).toBeNull();
      expect(await count(`channel_campaign_id = ${lit(t.cc)}`)).toBe(2);
    });

    it("metrics can be edited; identity columns and entered_by cannot", async () => {
      const t = await tenantWithChannel();
      const editor = randomUUID();
      const creator = await openAs(pool.cfg, t.tenant, "owner", t.user, "c13-edit-a");
      try {
        expect((await creator.exec(insertSql(t))).error).toBeNull();
      } finally {
        await creator.close();
      }
      const s = await openAs(pool.cfg, t.tenant, "marketing", editor, "c13-edit-b");
      try {
        const edit = await s.exec(
          `update ${TABLE} set spend = 200000, entered_by = ${lit(editor)} where channel_campaign_id = ${lit(t.cc)};`,
        );
        expect(edit.error).toBeNull();
        for (const col of [
          `metric_date = current_date - 1`,
          `currency = 'USD'`,
          `channel = 'TIKTOK'`,
          `master_campaign_id = ${lit(randomUUID())}`,
          `tenant_id = ${lit(randomUUID())}`,
        ]) {
          const r = await s.exec(`update ${TABLE} set ${col} where channel_campaign_id = ${lit(t.cc)};`);
          expect(r.error, col).not.toBeNull();
        }
      } finally {
        await s.close();
      }
      const row = await pool.admin.exec(`select spend, entered_by, updated_by from ${TABLE} where channel_campaign_id = ${lit(t.cc)};`);
      expect(row.rows[0]).toBe(`200000.00|${t.user}|${editor}`);
    });

    it("a row may still be DELETED after its channel was launched (cleanup of stale manual data)", async () => {
      const t = await tenantWithChannel();
      await pool.admin.exec(insertSql(t));
      await pool.admin.exec(`update prompter_channel_campaigns set external_campaign_id = 'ext-x' where id = ${lit(t.cc)};`);
      const s = await openAs(pool.cfg, t.tenant, "owner", t.user, "c13-del");
      try {
        expect((await s.exec(`delete from ${TABLE} where channel_campaign_id = ${lit(t.cc)};`)).error).toBeNull();
      } finally {
        await s.close();
      }
      expect(await count(`channel_campaign_id = ${lit(t.cc)}`)).toBe(0);
    });
  });

  describe("migration hygiene", () => {
    it("the guard function cannot be executed by clients", async () => {
      const s = await openAs(pool.cfg, randomUUID(), "owner", randomUUID(), "c13-fn");
      try {
        const r = await s.exec("select fn_prompter_manual_ad_metrics_guard();");
        expect(r.error).toMatch(/permission denied|trigger functions can only be called as triggers/i);
      } finally {
        await s.close();
      }
    });

    it("re-applying the migration is a no-op (idempotent guards)", async () => {
      const r = await pool.admin.exec(loadableMigration(), 60_000);
      expect(r.error).toBeNull();
    });
  });
});
