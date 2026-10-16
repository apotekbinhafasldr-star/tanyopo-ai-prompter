import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Static safety-invariant checks for the P0 trial-security migrations, in the
 * same style as b9-entitlement-enforcement.test.ts (this repository has no
 * live-Postgres harness in CI). The behavioural proof lives in
 * supabase/tests/p0_trial_security.sql (local throwaway Postgres only).
 */
const root = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf-8");
const executable = (sql: string) =>
  sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

const AI_JOBS = "supabase/migrations/20261010110000_prompter_p0_ai_jobs_lockdown.sql";
const SUBS = "supabase/migrations/20261010110100_prompter_p0_subscription_trial_insert_guard.sql";
const AI_JOBS_DOWN = "supabase/rollback/20261010110000_prompter_p0_ai_jobs_lockdown.down.sql";
const SUBS_DOWN = "supabase/rollback/20261010110100_prompter_p0_subscription_trial_insert_guard.down.sql";

/** Columns services/ai-jobs.ts writes after the model call. */
const APP_WRITTEN_COLUMNS = [
  "status", "provider", "model", "tokens_input", "tokens_output", "fallback_provider",
  "output_reference", "error", "error_category", "completed_at",
];
const IMMUTABLE_COLUMNS = ["id", "tenant_id", "job_type", "input_reference", "estimated_cost", "created_at", "actor_user_id"];

describe("P0-1 prompter_ai_jobs lockdown migration", () => {
  const sql = executable(read(AI_JOBS));

  it("revokes INSERT, DELETE and TRUNCATE from authenticated and anon", () => {
    expect(sql).toMatch(/revoke insert, delete, truncate on public\.prompter_ai_jobs from authenticated, anon;/);
  });

  it("revokes table-level UPDATE, then grants UPDATE only on bookkeeping columns", () => {
    expect(sql).toMatch(/revoke update on public\.prompter_ai_jobs from authenticated, anon;/);
    const grant = sql.match(/grant update \(([^)]*)\) on public\.prompter_ai_jobs to authenticated;/);
    expect(grant).not.toBeNull();
    const cols = grant![1].split(",").map((c) => c.trim()).filter(Boolean);
    expect(cols.sort()).toEqual([...APP_WRITTEN_COLUMNS].sort());
    for (const c of IMMUTABLE_COLUMNS) expect(cols, c).not.toContain(c);
  });

  it("does not touch policies, service_role, the RPC, or any data", () => {
    expect(sql).not.toMatch(/create policy|drop policy|alter policy/i);
    expect(sql).not.toMatch(/service_role/i);
    expect(sql).not.toMatch(/fn_create_ai_job_if_entitled/);
    expect(sql).not.toMatch(/\b(insert into|delete from|update public\.)\b/i);
    expect(sql).not.toMatch(/security definer/i);
  });

  it("every column the app writes is still granted (app keeps working)", () => {
    const service = read("services/ai-jobs.ts");
    for (const c of APP_WRITTEN_COLUMNS) expect(service, c).toContain(c);
  });
});

describe("P0-2/P0-2b subscription trial-insert guard migration", () => {
  const sql = executable(read(SUBS));

  it("is a BEFORE INSERT trigger only (UPDATE paths, payment and cancellation are untouched)", () => {
    expect(sql).toMatch(/create trigger trg_prompter_subscriptions_enforce_trial_insert\s+before insert on public\.prompter_subscriptions/);
    expect(sql).not.toMatch(/before (insert or )?update/i);
    expect(sql).not.toMatch(/create policy|drop policy|revoke|grant /i);
  });

  it("is SECURITY INVOKER and only acts for anon/authenticated callers", () => {
    expect(sql).toMatch(/security invoker/);
    expect(sql).not.toMatch(/security definer/);
    expect(sql).toMatch(/current_user in \('anon', 'authenticated'\)/);
  });

  it("forces server-time, 14-day trial values and resets commercial fields", () => {
    for (const stmt of [
      "new.status := 'TRIALING';",
      "new.plan := 'FREE';",
      "new.created_at := now();",
      "new.current_period_start := now();",
      "new.current_period_end := now() + interval '14 days';",
      "new.billing_provider := null;",
      "new.payment_provider_customer_reference := null;",
      "new.provider_subscription_id := null;",
      "new.success_fee_rate_bps := null;",
      "new.cancel_at_period_end := false;",
    ]) {
      expect(sql, stmt).toContain(stmt);
    }
  });

  it("14 days matches TRIAL_DURATION_DAYS in the app", () => {
    expect(read("services/billing.ts")).toMatch(/TRIAL_DURATION_DAYS\s*=\s*14/);
  });
});

describe("rollback scripts", () => {
  it("exist outside supabase/migrations, so they are never applied automatically", () => {
    for (const f of [AI_JOBS_DOWN, SUBS_DOWN]) expect(existsSync(path.join(root, f)), f).toBe(true);
    const migrations = readdirSync(path.join(root, "supabase/migrations"));
    expect(migrations.some((m) => m.endsWith(".down.sql"))).toBe(false);
  });

  it("ai_jobs rollback restores the exact production grants observed before the lockdown", () => {
    const sql = executable(read(AI_JOBS_DOWN));
    expect(sql).toMatch(/grant delete, insert, references, select, trigger, truncate, update\s+on public\.prompter_ai_jobs to anon, authenticated;/);
  });

  it("subscription rollback removes the trigger and function and nothing else", () => {
    const sql = executable(read(SUBS_DOWN));
    expect(sql).toMatch(/drop trigger if exists trg_prompter_subscriptions_enforce_trial_insert/);
    expect(sql).toMatch(/drop function if exists public\.fn_enforce_trial_subscription_insert\(\)/);
    expect(sql).not.toMatch(/\b(delete|update|insert|truncate|grant|revoke)\b/i);
  });
});

describe("no other code path writes prompter_ai_jobs through a client", () => {
  const SKIP = new Set(["node_modules", ".next", ".git", "tests", "docs", "public", "supabase", ".netlify", "types"]);
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of readdirSync(dir)) {
      if (SKIP.has(e)) continue;
      const full = path.join(dir, e);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(e)) out.push(full);
    }
    return out;
  };
  const users = walk(root)
    .map((f) => ({ file: path.relative(root, f).split(path.sep).join("/"), text: readFileSync(f, "utf-8") }))
    .filter(({ text }) => /\.from\(\s*"prompter_ai_jobs"\s*\)/.test(text));

  it("only services/ai-jobs.ts (writes) and services/billing.ts (read-only count) touch the table", () => {
    expect(users.map((u) => u.file).sort()).toEqual(["services/ai-jobs.ts", "services/billing.ts"]);
  });

  it("services/billing.ts only reads it", () => {
    const text = users.find((u) => u.file === "services/billing.ts")!.text;
    const afterFrom = text.slice(text.indexOf('.from("prompter_ai_jobs")'));
    expect(afterFrom.slice(0, 200)).toMatch(/\.select\(/);
    expect(afterFrom.slice(0, 200)).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  });

  it("services/ai-jobs.ts never inserts, upserts, or deletes through the tenant client", () => {
    const text = users.find((u) => u.file === "services/ai-jobs.ts")!.text;
    expect(text).not.toMatch(/\.insert\(/);
    expect(text).not.toMatch(/\.upsert\(/);
    // The only delete is on the server-only admin client, scoped to tenant + id + PROCESSING.
    const deletes = text.match(/\.delete\(\)/g) ?? [];
    expect(deletes).toHaveLength(1);
    expect(text).toMatch(/admin\s*\.from\("prompter_ai_jobs"\)\s*\.delete\(\)\s*\.eq\("id", jobId\)\s*\.eq\("tenant_id", tenantId\)\s*\.eq\("status", "PROCESSING"\)/);
  });

  it("the subscription insert in the app is the canonical trial (status TRIALING, now → +14 days)", () => {
    const text = read("services/billing.ts");
    expect(text).toMatch(/status: "TRIALING"/);
    expect(text).toMatch(/current_period_end: trialEnd\.toISOString\(\)/);
  });
});
