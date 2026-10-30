import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Static invariants for the P0 plan-tampering migration (no live Postgres in this job). The behavioural
 * proof (an Owner cannot change `plan` at any status, the verified payment path still works, rollback is
 * fail-closed) runs in CI job plan-tampering-sql: supabase/tests/plan-tampering, PostgreSQL 17, synthetic data.
 */
const root = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf-8");
const executable = (sql: string) => sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

const MIG = "supabase/migrations/20261029220000_prompter_p0_subscription_plan_tampering_lockdown.sql";
const DOWN = "supabase/rollback/20261029220000_prompter_p0_subscription_plan_tampering_lockdown.down.sql";
// COMMENT ON strings legitimately name other objects; only executable statements are checked.
const sql = executable(read(MIG)).replace(/comment on function[\s\S]*?';/g, "");

describe("plan-tampering migration: no client write path to prompter_subscriptions remains", () => {
  it("drops the Owner UPDATE policy and revokes table-level AND column-level UPDATE", () => {
    expect(sql).toContain('drop policy if exists "Owner kelola subscription" on public.prompter_subscriptions;');
    expect(sql).toMatch(/revoke update on public\.prompter_subscriptions from public, anon, authenticated;/);
    expect(sql).toMatch(/revoke update \(plan\) on public\.prompter_subscriptions from public, anon, authenticated;/);
  });

  it("also revokes DELETE and TRUNCATE (idempotent with S1), so no client write path other than the first-trial INSERT remains", () => {
    expect(sql).toMatch(/revoke delete, truncate on public\.prompter_subscriptions from public, anon, authenticated;/);
  });

  it("adds a SECURITY INVOKER BEFORE UPDATE trigger that rejects anon/authenticated (defense in depth)", () => {
    expect(sql).toMatch(/create or replace function public\.fn_block_client_subscription_update\(\)[\s\S]*?security invoker/);
    expect(sql).toContain("if current_user in ('anon', 'authenticated') then");
    expect(sql).toMatch(/create trigger trg_prompter_subscriptions_block_client_update\s+before update on public\.prompter_subscriptions/);
  });

  it("is DDL only: modifies no data and leaves the payment functions, other tables and service_role alone", () => {
    expect(sql).not.toMatch(/\b(insert into|delete from|truncate table|truncate public)\b/i);
    expect(sql).not.toMatch(/\bupdate public\.(?!prompter_subscriptions set plan = p_plan where tenant_id = v_tenant_id;)/i);
    expect(sql).not.toMatch(/fn_apply_verified_payment|fn_schedule_cancellation|fn_create_ai_job_if_entitled|service_role/);
    expect(sql).not.toMatch(/alter table|create policy|grant update/i);
    const touched = [...sql.matchAll(/\bpublic\.(prompter_[a-z_]+)/g)].map((m) => m[1]);
    expect(new Set(touched)).toEqual(new Set(["prompter_subscriptions", "prompter_plan_entitlements"]));
    expect(sql).toContain("set local lock_timeout = '3s';");
  });
});

describe("fn_set_trial_plan_preference", () => {
  const fn = sql.slice(sql.indexOf("create or replace function public.fn_set_trial_plan_preference"));

  it("is SECURITY DEFINER with a pinned search_path and takes only the plan (tenant comes from the session)", () => {
    expect(fn).toMatch(/fn_set_trial_plan_preference\(p_plan text\)/);
    expect(fn).toMatch(/security definer\s+set search_path = public/);
    expect(fn).toContain("v_tenant_id := public.fn_current_tenant_id();");
    expect(fn).not.toMatch(/p_tenant/);
  });

  it("requires a signed-in Owner, an ACTIVE known plan and a TRIALING subscription, and writes plan only", () => {
    expect(fn).toContain("auth.uid() is null");
    expect(fn).toMatch(/fn_current_role\(\) is distinct from 'owner'/);
    expect(fn).toContain("v_availability <> 'ACTIVE'");
    expect(fn).toContain("v_status <> 'TRIALING'");
    expect(fn).toContain("for update");
    expect(fn).toContain("update public.prompter_subscriptions set plan = p_plan where tenant_id = v_tenant_id;");
    expect(fn).not.toMatch(/set status|status =\s*'ACTIVE'/);
  });

  it("is executable by authenticated only", () => {
    expect(sql).toContain("revoke all on function public.fn_set_trial_plan_preference(text) from public, anon;");
    expect(sql).toContain("grant execute on function public.fn_set_trial_plan_preference(text) to authenticated;");
  });
});

describe("rollback", () => {
  const down = read(DOWN);
  it("is fail-closed: refuses unless the exact confirmation text is substituted", () => {
    expect(down).toContain("v_confirm text := 'REPLACE_WITH_CONFIRMATION';");
    expect(down).toContain("I_UNDERSTAND_THIS_REOPENS_PLAN_TAMPERING");
    expect(down).toMatch(/raise exception 'rollback refused/);
  });
  it("restores exactly the previous policy and column grant", () => {
    expect(executable(down)).toMatch(/create policy "Owner kelola subscription"[\s\S]*?for update/);
    expect(executable(down)).toContain("grant update (plan) on public.prompter_subscriptions to authenticated;");
  });
});

describe("application code never writes prompter_subscriptions as the signed-in user", () => {
  const files = (): string[] => {
    const out: string[] = [];
    const walk = (p: string) => {
      for (const e of readdirSync(p)) {
        if (e === "node_modules" || e === ".next") continue;
        const f = path.join(p, e);
        if (statSync(f).isDirectory()) walk(f);
        else if (/\.(ts|tsx)$/.test(f)) out.push(f);
      }
    };
    for (const d of ["services", "features", "lib", "app", "components", "hooks", "middleware", "utils"]) if (existsSync(path.join(root, d))) walk(path.join(root, d));
    return out;
  };

  it("the only write to the table is the first-trial INSERT (everything else goes through an RPC or the service role)", () => {
    for (const f of files()) {
      const code = executable(readFileSync(f, "utf-8"));
      expect(code, f).not.toMatch(/from\(\s*["'`]prompter_subscriptions["'`]\s*\)\s*\.(update|upsert|delete)\(/);
    }
  });

  it("changePlan calls the RPC and not the table", () => {
    const code = executable(read("services/billing.ts"));
    expect(code).toContain('supabase.rpc("fn_set_trial_plan_preference", { p_plan: plan })');
    expect(code).not.toMatch(/\.update\(\{ plan \}\)/);
  });
});
