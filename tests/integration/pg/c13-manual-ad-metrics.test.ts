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
 *     identity-column immutability;
 *   - the atomic audit trigger: one audit row per change, in the same
 *     transaction (a failing audit sink rolls the change back; a failing change
 *     leaves no audit row), actor/tenant/operation/record correctness, and the
 *     ON DELETE CASCADE tenant-deletion case against real foreign keys;
 *   - table/function privileges after the migration revokes Supabase's default
 *     ACLs (simulated here with ALTER DEFAULT PRIVILEGES).
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
  id?: string;
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
    (${r.id ? "id, " : ""}tenant_id, master_campaign_id, channel_campaign_id, channel, metric_date, spend, impressions, clicks, conversions, revenue, currency, entered_by)
    values (${r.id ? `${lit(r.id)}, ` : ""}${lit(r.tenant)}, ${lit(r.master)}, ${lit(r.cc)}, ${lit(r.channel ?? "FACEBOOK")},
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
      alter table prompter_audit_logs add column if not exists before_data jsonb, add column if not exists after_data jsonb;
      -- Supabase grants ALL on every new public table to anon/authenticated by default; simulate it
      -- so the migration's REVOKE is what the privilege tests actually exercise.
      alter default privileges in schema public grant all on tables to anon, authenticated;
      drop table if exists ${TABLE} cascade;
    `);
    if (setup.error) throw new Error(`c13 prerequisites failed: ${setup.error}`);
    const loaded = await pool.admin.exec(loadableMigration(), 60_000);
    if (loaded.error) throw new Error(`migration failed to load: ${loaded.error}`);
  });

  afterAll(async () => {
    await pool.admin.exec("alter default privileges in schema public revoke all on tables from anon, authenticated;");
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
    for (const role of ["apoteker", "kasir", "hr", "admin_gudang", ""]) {
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

    it("a non-writer role can read own-tenant rows but cannot update or delete them", async () => {
      const t = await tenantWithChannel();
      await pool.admin.exec(insertSql(t));
      const s = await openAs(pool.cfg, t.tenant, "apoteker", t.user, "c13-viewer");
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

  describe("atomic audit trigger", () => {
    const AUDIT_COLS = `action, coalesce(actor_user_id::text, 'null'), tenant_id, before_data is null, after_data is null, context->>'recorded_by', context->>'verified_by_platform'`;

    async function auditOf(id: string): Promise<string[]> {
      const r = await pool.admin.exec(`select ${AUDIT_COLS} from prompter_audit_logs where resource_id = ${lit(id)} order by created_at, action;`);
      if (r.error) throw new Error(r.error);
      return r.rows;
    }

    it("a direct SQL (PostgREST-equivalent) insert, update and delete each write exactly one audit row with actor, tenant, operation and record reference", async () => {
      const t = await tenantWithChannel();
      const id = randomUUID();
      const s = await openAs(pool.cfg, t.tenant, "owner", t.user, "c13-audit-crud");
      try {
        expect((await s.exec(insertSql({ ...t, id }))).error).toBeNull();
        expect(await auditOf(id)).toEqual([`manual_metrics.create|${t.user}|${t.tenant}|t|f|db_trigger|false`]);

        expect((await s.exec(`update ${TABLE} set spend = 777 where id = ${lit(id)};`)).error).toBeNull();
        expect(await auditOf(id)).toHaveLength(2);

        expect((await s.exec(`delete from ${TABLE} where id = ${lit(id)};`)).error).toBeNull();
        const rows = await auditOf(id);
        expect(rows).toHaveLength(3);
        expect(rows).toContain(`manual_metrics.update|${t.user}|${t.tenant}|f|f|db_trigger|false`);
        expect(rows).toContain(`manual_metrics.delete|${t.user}|${t.tenant}|f|t|db_trigger|false`);
      } finally {
        await s.close();
      }
      const payload = await pool.admin.exec(
        `select (before_data->>'spend')::numeric, (after_data->>'spend')::numeric from prompter_audit_logs where resource_id = ${lit(id)} and action = 'manual_metrics.update';`,
      );
      expect(payload.rows[0]).toBe("150000.00|777.00");
      const resource = await pool.admin.exec(`select distinct resource_type from prompter_audit_logs where resource_id = ${lit(id)};`);
      expect(resource.rows).toEqual([TABLE]);
    });

    it("the actor is auth.uid() from the session, never client input; a service-style session without a user records a NULL actor", async () => {
      const t = await tenantWithChannel();
      const id = randomUUID();
      const forged = randomUUID();
      const s = await openAs(pool.cfg, t.tenant, "owner", t.user, "c13-audit-actor");
      try {
        // context / audit-looking values smuggled in the row cannot influence the audit actor
        expect((await s.exec(insertSql({ ...t, id, enteredBy: forged }))).error).toBeNull();
      } finally {
        await s.close();
      }
      expect((await auditOf(id))[0].split("|")[1]).toBe(t.user);

      const id2 = randomUUID();
      const t2 = await tenantWithChannel();
      expect((await pool.admin.exec(insertSql({ ...t2, id: id2 }))).error).toBeNull();
      expect((await auditOf(id2))[0]).toBe(`manual_metrics.create|null|${t2.tenant}|t|f|db_trigger|false`);
    });

    it("failed data changes leave NO audit row: CHECK, unique, RLS, guard and cross-tenant attempts", async () => {
      const a = await tenantWithChannel();
      const b = await tenantWithChannel();
      const s = await openAs(pool.cfg, a.tenant, "owner", a.user, "c13-audit-fail");
      const ids: string[] = [];
      try {
        const attempt = async (sql: (id: string) => string) => {
          const id = randomUUID();
          ids.push(id);
          const r = await s.exec(sql(id));
          expect(r.error).not.toBeNull();
        };
        await attempt((id) => insertSql({ ...a, id, clicks: 99999999, impressions: 10 })); // CHECK
        await attempt((id) => insertSql({ ...a, id, tenant: b.tenant })); // RLS: other tenant stamped
        await attempt((id) => insertSql({ ...a, id, cc: b.cc, master: b.master })); // RLS/guard: foreign channel campaign
        await attempt((id) => insertSql({ ...a, id, date: "2999-01-01" })); // guard: future date
        const ok = randomUUID();
        expect((await s.exec(insertSql({ ...a, id: ok }))).error).toBeNull();
        await attempt((id) => insertSql({ ...a, id })); // unique (channel campaign, date)
        expect(await auditOf(ok)).toHaveLength(1);
      } finally {
        await s.close();
      }
      for (const id of ids) expect(await auditOf(id), id).toEqual([]);
      const strays = await pool.admin.exec(`select count(*) from prompter_audit_logs where resource_type = ${lit(TABLE)} and tenant_id in (${lit(a.tenant)}, ${lit(b.tenant)});`);
      expect(Number(strays.rows[0])).toBe(1); // only the one successful insert
    });

    it("another tenant's update/delete touches nothing and writes no audit row", async () => {
      const a = await tenantWithChannel();
      const b = await tenantWithChannel();
      const id = randomUUID();
      expect((await pool.admin.exec(insertSql({ ...a, id }))).error).toBeNull();
      const s = await openAs(pool.cfg, b.tenant, "owner", b.user, "c13-audit-xt");
      try {
        expect((await s.exec(`update ${TABLE} set spend = 1 where id = ${lit(id)};`)).error).toBeNull();
        expect((await s.exec(`delete from ${TABLE} where id = ${lit(id)};`)).error).toBeNull();
      } finally {
        await s.close();
      }
      expect(await count(`id = ${lit(id)}`)).toBe(1);
      expect(await auditOf(id)).toHaveLength(1);
      const none = await pool.admin.exec(`select count(*) from prompter_audit_logs where tenant_id = ${lit(b.tenant)};`);
      expect(Number(none.rows[0])).toBe(0);
    });

    /**
     * Runs `body` inside a transaction that first installs an audit sink which
     * always fails, so the ONLY thing that can make a statement fail is the audit
     * insert. The transaction is always rolled back; nothing leaks to other tests.
     */
    async function withBrokenAudit(
      t: { tenant: string; user: string },
      role: string,
      body: (s: PsqlSession) => Promise<void>,
    ) {
      const s = await PsqlSession.open(pool.cfg, "c13-audit-broken");
      try {
        expect((await s.exec("begin;")).error).toBeNull();
        expect(
          (
            await s.exec(
              `create function public.c13_fail_audit() returns trigger language plpgsql as $f$ begin raise exception 'c13 audit sink down'; end $f$;`,
            )
          ).error,
        ).toBeNull();
        expect((await s.exec(`create trigger c13_fail_audit before insert on prompter_audit_logs for each row execute function public.c13_fail_audit();`)).error).toBeNull();
        await body(s);
      } finally {
        await s.exec("rollback;");
        await s.close();
      }
    }

    async function asClient(s: PsqlSession, t: { tenant: string; user: string }, role: string) {
      const r = await s.exec(
        `set local role authenticated; select set_config('app.tenant_id', ${lit(t.tenant)}, true), set_config('app.role', ${lit(role)}, true), set_config('app.user_id', ${lit(t.user)}, true);`,
      );
      expect(r.error).toBeNull();
    }

    it("if the audit insert fails, the INSERT is rolled back (no row without its audit)", async () => {
      const t = await tenantWithChannel();
      const id = randomUUID();
      await withBrokenAudit(t, "owner", async (s) => {
        expect((await s.exec("savepoint s1;")).error).toBeNull();
        await asClient(s, t, "owner");
        const r = await s.exec(insertSql({ ...t, id }));
        expect(r.error).toMatch(/c13 audit sink down/);
        expect((await s.exec("rollback to savepoint s1;")).error).toBeNull();
        expect((await s.exec("reset role;")).error).toBeNull();
        const c = await s.exec(`select count(*) from ${TABLE} where id = ${lit(id)};`);
        expect(c.rows[0]).toBe("0");
      });
      expect(await count(`id = ${lit(id)}`)).toBe(0);
    });

    it("if the audit insert fails, UPDATE and DELETE are rolled back too (data unchanged, row still present)", async () => {
      const t = await tenantWithChannel();
      const id = randomUUID();
      expect((await pool.admin.exec(insertSql({ ...t, id }))).error).toBeNull();
      const before = await auditOf(id);
      await withBrokenAudit(t, "owner", async (s) => {
        expect((await s.exec("savepoint s1;")).error).toBeNull();
        await asClient(s, t, "owner");
        const up = await s.exec(`update ${TABLE} set spend = 424242 where id = ${lit(id)};`);
        expect(up.error).toMatch(/c13 audit sink down/);
        expect((await s.exec("rollback to savepoint s1;")).error).toBeNull();

        expect((await s.exec("savepoint s2;")).error).toBeNull();
        await asClient(s, t, "owner");
        const del = await s.exec(`delete from ${TABLE} where id = ${lit(id)};`);
        expect(del.error).toMatch(/c13 audit sink down/);
        expect((await s.exec("rollback to savepoint s2;")).error).toBeNull();

        expect((await s.exec("reset role;")).error).toBeNull();
        const r = await s.exec(`select spend from ${TABLE} where id = ${lit(id)};`);
        expect(r.rows[0]).toBe("150000.00");
      });
      expect(await auditOf(id)).toEqual(before);
    });

    it("an audit failure also stops a service-style (RLS-bypassing) write", async () => {
      const t = await tenantWithChannel();
      const id = randomUUID();
      await withBrokenAudit(t, "owner", async (s) => {
        expect((await s.exec("savepoint s1;")).error).toBeNull();
        expect((await s.exec(insertSql({ ...t, id }))).error).toMatch(/c13 audit sink down/);
        expect((await s.exec("rollback to savepoint s1;")).error).toBeNull();
        expect((await s.exec(`select count(*) from ${TABLE} where id = ${lit(id)};`)).rows[0]).toBe("0");
      });
    });

    it("with real foreign keys: a vanished actor aborts the change, but deleting a whole tenant (ON DELETE CASCADE) still works", async () => {
      const t = await tenantWithChannel();
      const t2 = await tenantWithChannel();
      const s = await PsqlSession.open(pool.cfg, "c13-audit-fk");
      try {
        expect((await s.exec("begin;")).error).toBeNull();
        const setup = await s.exec(`
          create table c13_tenants (id uuid primary key);
          create table c13_users (id uuid primary key);
          insert into c13_tenants values (${lit(t.tenant)}), (${lit(t2.tenant)});
          insert into c13_users values (${lit(t.user)});
          alter table prompter_audit_logs add constraint prompter_audit_logs_tenant_id_fkey foreign key (tenant_id) references c13_tenants(id) on delete cascade not valid;
          alter table prompter_audit_logs add constraint prompter_audit_logs_actor_user_id_fkey foreign key (actor_user_id) references c13_users(id) not valid;
          alter table ${TABLE} add constraint c13_manual_tenant_fkey foreign key (tenant_id) references c13_tenants(id) on delete cascade not valid;
        `);
        expect(setup.error).toBeNull();

        // (1) actor that does not exist -> audit FK fails -> the data change must not survive
        expect((await s.exec("savepoint s1;")).error).toBeNull();
        const ghost = randomUUID();
        const idGhost = randomUUID();
        const r = await s.exec(
          `set local role authenticated; select set_config('app.tenant_id', ${lit(t2.tenant)}, true), set_config('app.role', 'owner', true), set_config('app.user_id', ${lit(ghost)}, true);`,
        );
        expect(r.error).toBeNull();
        expect((await s.exec(insertSql({ ...t2, id: idGhost }))).error).toMatch(/prompter_audit_logs_actor_user_id_fkey/);
        expect((await s.exec("rollback to savepoint s1;")).error).toBeNull();
        expect((await s.exec(`select count(*) from ${TABLE} where id = ${lit(idGhost)};`)).rows[0]).toBe("0");

        // (2) a real actor works, then the tenant is deleted: cascade removes the metric row without tripping on its own audit
        const idOk = randomUUID();
        expect((await s.exec(insertSql({ ...t, id: idOk }))).error).toBeNull();
        expect((await s.exec(`select count(*) from prompter_audit_logs where resource_id = ${lit(idOk)};`)).rows[0]).toBe("1");
        const del = await s.exec(`delete from c13_tenants where id = ${lit(t.tenant)};`);
        expect(del.error).toBeNull();
        expect((await s.exec(`select count(*) from ${TABLE} where id = ${lit(idOk)};`)).rows[0]).toBe("0");
      } finally {
        await s.exec("rollback;");
        await s.close();
      }
    });
  });

  describe("privileges (Supabase default ACLs simulated, then removed by the migration)", () => {
    it("sanity: the simulated default ACL would have granted authenticated/anon everything", async () => {
      const r = await pool.admin.exec(
        `select count(*) from pg_default_acl where defaclnamespace = 'public'::regnamespace and defaclacl::text like '%authenticated=%' and defaclacl::text like '%anon=%';`,
      );
      expect(Number(r.rows[0])).toBeGreaterThan(0);
    });

    it("authenticated holds exactly SELECT/INSERT/UPDATE/DELETE; anon and PUBLIC hold nothing", async () => {
      const privs = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
      const q = (role: string) => privs.map((p) => `has_table_privilege('${role}', 'public.${TABLE}', '${p}')`).join(", ");
      const auth = await pool.admin.exec(`select ${q("authenticated")};`);
      expect(auth.rows[0]).toBe("t|t|t|t|f|f|f");
      const anon = await pool.admin.exec(`select ${q("anon")};`);
      expect(anon.rows[0]).toBe("f|f|f|f|f|f|f");
      const pub = await pool.admin.exec(
        `select count(*) from pg_class c, aclexplode(c.relacl) a where c.oid = 'public.${TABLE}'::regclass and a.grantee = 0;`,
      );
      expect(pub.rows[0]).toBe("0");
      const colPriv = await pool.admin.exec(
        `select count(*) from information_schema.column_privileges where table_name = '${TABLE}' and grantee in ('anon', 'PUBLIC');`,
      );
      expect(colPriv.rows[0]).toBe("0");
    });

    it("authenticated cannot TRUNCATE, add triggers, or disable the audit/guard triggers", async () => {
      const t = await tenantWithChannel();
      const s = await openAs(pool.cfg, t.tenant, "owner", t.user, "c13-priv");
      try {
        expect((await s.exec(`truncate ${TABLE};`)).error).toMatch(/permission denied/i);
        expect((await s.exec(`alter table ${TABLE} disable trigger trg_prompter_manual_ad_metrics_audit;`)).error).toMatch(/must be owner|permission denied/i);
        expect((await s.exec(`alter table ${TABLE} disable trigger trg_prompter_manual_ad_metrics_guard;`)).error).toMatch(/must be owner|permission denied/i);
        expect((await s.exec(`drop trigger trg_prompter_manual_ad_metrics_audit on ${TABLE};`)).error).toMatch(/must be owner|permission denied/i);
      } finally {
        await s.close();
      }
    });

    it("the audit and guard functions are executable by no client role, directly or via PUBLIC", async () => {
      for (const fn of ["fn_prompter_manual_ad_metrics_audit", "fn_prompter_manual_ad_metrics_guard"]) {
        const r = await pool.admin.exec(
          `select has_function_privilege('authenticated', 'public.${fn}()', 'execute'), has_function_privilege('anon', 'public.${fn}()', 'execute'),
                  (select count(*) from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.${fn}()'::regprocedure and a.grantee = 0);`,
        );
        expect(r.rows[0], fn).toBe("f|f|0");
      }
      const s = await openAs(pool.cfg, randomUUID(), "owner", randomUUID(), "c13-priv-fn");
      try {
        expect((await s.exec("select fn_prompter_manual_ad_metrics_audit();")).error).toMatch(/permission denied|trigger functions can only be called as triggers/i);
      } finally {
        await s.close();
      }
    });

    it("both functions are SECURITY DEFINER with a pinned search_path", async () => {
      const r = await pool.admin.exec(
        `select proname, prosecdef, array_to_string(proconfig, ',') from pg_proc where proname in ('fn_prompter_manual_ad_metrics_audit', 'fn_prompter_manual_ad_metrics_guard') order by proname;`,
      );
      expect(r.rows).toEqual([
        "fn_prompter_manual_ad_metrics_audit|t|search_path=pg_catalog, public",
        "fn_prompter_manual_ad_metrics_guard|t|search_path=public",
      ]);
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
