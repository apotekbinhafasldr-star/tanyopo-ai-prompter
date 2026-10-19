import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Winning Ads Phase 2B — static safety-invariant checks on the migration, in
 * the same style as the other tests/unit/migrations files. The behavioural
 * proof (real PostgreSQL, RLS enforced) is tests/integration/pg/c13-*.
 */
const sql = readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261018160000_prompter_manual_ad_metrics.sql"),
  "utf-8",
);
const executable = sql
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");
const flat = executable.replace(/\s+/g, " ");

describe("manual ad metrics migration — additive-only", () => {
  it("creates exactly one table, and it is the new one", () => {
    const created = [...flat.matchAll(/create table (?:if not exists )?(public\.[a-z_]+)/g)].map((m) => m[1]);
    expect(created).toEqual(["public.prompter_manual_ad_metrics"]);
  });

  it("never alters, drops or renames any pre-existing object", () => {
    const alters = [...flat.matchAll(/alter table ([a-z_.]+)/g)].map((m) => m[1]);
    expect(new Set(alters)).toEqual(new Set(["public.prompter_manual_ad_metrics"]));
    expect(flat).not.toMatch(/drop table|drop column|drop function|truncate|rename to|alter column/i);
    for (const m of flat.matchAll(/drop (policy|trigger) if exists "?[^" ]+"? on ([a-z_.]+)/g)) {
      expect(m[2]).toBe("public.prompter_manual_ad_metrics");
    }
  });

  it("does not touch the connector metrics table, the channel campaign table (except to read it), or any cron", () => {
    expect(flat).not.toMatch(/(from|into|update|join|alter table|on|references|table) public\.prompter_marketing_metrics/);
    expect(flat).not.toMatch(/(insert into|update|delete from|alter table|create policy[^;]* on) public\.prompter_channel_campaigns/);
    expect(flat).not.toMatch(/cron\./);
  });

  it("adds exactly two functions (guard, audit) and two triggers", () => {
    expect([...flat.matchAll(/create or replace function ([a-z_.]+)/g)].map((m) => m[1])).toEqual([
      "public.fn_prompter_manual_ad_metrics_guard",
      "public.fn_prompter_manual_ad_metrics_audit",
    ]);
    expect([...flat.matchAll(/create trigger ([a-z_]+)/g)].map((m) => m[1])).toEqual([
      "trg_prompter_manual_ad_metrics_guard",
      "trg_prompter_manual_ad_metrics_audit",
    ]);
  });
});

describe("manual ad metrics migration — tenant integrity and access", () => {
  it("enables RLS, removes anon access, and defines no FOR ALL policy", () => {
    expect(flat).toContain("alter table public.prompter_manual_ad_metrics enable row level security");
    expect(flat).toContain("revoke all on public.prompter_manual_ad_metrics from public, anon, authenticated");
    expect(flat).toContain("grant select, insert, update, delete on public.prompter_manual_ad_metrics to authenticated");
    expect(flat).not.toMatch(/grant [^;]*(truncate|references|trigger|all)[^;]* to (public|anon|authenticated)/);
    expect(flat).not.toMatch(/create policy [^;]* for all/);
    const ops = [...flat.matchAll(/create policy "[^"]+" on public\.prompter_manual_ad_metrics for (select|insert|update|delete)/g)].map((m) => m[1]);
    expect(ops.sort()).toEqual(["delete", "insert", "select", "update"]);
  });

  it("insert and update WITH CHECK verify the channel campaign belongs to the same tenant, master, channel and is not platform-linked", () => {
    for (const op of ["insert", "update"]) {
      const m = flat.match(new RegExp(`for ${op}[^;]*?;`));
      expect(m, `${op} policy`).not.toBeNull();
      const policy = m![0];
      expect(policy).toContain("fn_current_role() in ('owner', 'marketing')");
      expect(policy).toContain("tenant_id = public.fn_current_tenant_id()");
      expect(policy).toContain("cc.tenant_id = prompter_manual_ad_metrics.tenant_id");
      expect(policy).toContain("cc.master_campaign_id = prompter_manual_ad_metrics.master_campaign_id");
      expect(policy).toContain("cc.channel = prompter_manual_ad_metrics.channel");
      expect(policy).toContain("cc.external_campaign_id is null");
    }
  });

  it("every policy is tenant-scoped; writes are owner/marketing only", () => {
    const policies = flat.split("create policy").slice(1);
    expect(policies).toHaveLength(4);
    for (const p of policies) expect(p).toContain("tenant_id = public.fn_current_tenant_id()");
    for (const p of policies.filter((x) => !/for select/.test(x))) {
      expect(p).toContain("fn_current_role() in ('owner', 'marketing')");
    }
  });

  it("the guard is SECURITY DEFINER with a pinned search_path and is not callable by clients", () => {
    expect(flat).toContain("security definer");
    expect(flat).toContain("set search_path = public");
    expect(flat).toContain("revoke all on function public.fn_prompter_manual_ad_metrics_guard() from public, anon, authenticated");
  });

  it("the audit trigger is atomic (AFTER row trigger), SECURITY DEFINER with a pinned search_path, trigger-only, and tolerates only tenant-cascade deletes", () => {
    expect(flat).toContain("after insert or update or delete on public.prompter_manual_ad_metrics for each row execute function public.fn_prompter_manual_ad_metrics_audit()");
    expect(flat).toMatch(/fn_prompter_manual_ad_metrics_audit\(\) returns trigger language plpgsql security definer set search_path = pg_catalog, public/);
    expect(flat).toContain("revoke all on function public.fn_prompter_manual_ad_metrics_audit() from public, anon, authenticated");
    expect(flat).toContain("auth.uid()");
    expect(flat).toContain("tg_op = 'DELETE' and v_constraint = 'prompter_audit_logs_tenant_id_fkey'");
    // no blanket exception swallowing
    expect(flat).not.toMatch(/when others/);
  });

  it("the guard re-checks tenant, master, channel, platform link and future date, and freezes identity on update", () => {
    for (const needle of [
      "v_cc.tenant_id is distinct from new.tenant_id",
      "v_cc.master_campaign_id is distinct from new.master_campaign_id",
      "v_cc.channel is distinct from new.channel",
      "v_cc.external_campaign_id is not null",
      "new.metric_date > (current_date + 1)",
      "new.channel_campaign_id is distinct from old.channel_campaign_id",
      "new.currency is distinct from old.currency",
      "new.entered_by := old.entered_by",
      "v_actor := auth.uid()",
    ]) {
      expect(flat, needle).toContain(needle);
    }
  });
});

describe("manual ad metrics migration — data integrity", () => {
  it("declares every CHECK the app relies on, plus the per-day unique key", () => {
    for (const needle of [
      "unique (channel_campaign_id, metric_date)",
      "channel in ('FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'X')",
      "currency ~ '^[A-Z]{3}$'",
      "spend >= 0 and spend <= 100000000000",
      "revenue >= 0 and revenue <= 100000000000",
      "impressions >= 0 and impressions <= 10000000000",
      "clicks >= 0 and clicks <= impressions",
      "conversions >= 0 and conversions <= clicks",
      "revenue = 0 or conversions > 0",
    ]) {
      expect(flat, needle).toContain(needle);
    }
  });

  it("references tenants, master campaigns and channel campaigns with ON DELETE CASCADE", () => {
    expect(flat).toContain("references public.tenants(id) on delete cascade");
    expect(flat).toContain("references public.prompter_master_campaigns(id) on delete cascade");
    expect(flat).toContain("references public.prompter_channel_campaigns(id) on delete cascade");
  });

  it("is marked as not applied to production", () => {
    expect(sql).toMatch(/NOT APPLIED TO PRODUCTION/);
  });
});
