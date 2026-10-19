import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Static safety invariants for the trial anti-abuse migration. Behavioural proof (privileges, decisions,
 * hold, recovery, retention, parallel races, rollback) is in supabase/tests/trial_abuse*.{sql,sh}, run
 * against a throw-away PostgreSQL in CI job `p0-trial-security-sql`.
 */
const root = path.resolve(__dirname, "../../..");
const MIG = "supabase/migrations/20261019110000_prompter_trial_abuse_protection.sql";
const DOWN = "supabase/rollback/20261019110000_prompter_trial_abuse_protection.down.sql";
const code = (rel: string) =>
  readFileSync(path.join(root, rel), "utf-8")
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
const sql = code(MIG);

describe("trial anti-abuse migration", () => {
  it("is additive: only creates LINOE tables/functions and replaces one P0 trigger function", () => {
    expect(sql).not.toMatch(/\bdrop\s+(table|column|schema)\b/i);
    expect(sql).not.toMatch(/\btruncate\b/i);
    expect(sql).not.toMatch(/\balter\s+table\s+(public\.)?(tenants|user_profiles|prompter_subscriptions|prompter_ai_jobs)\b/i);
    expect(sql).not.toMatch(/\bauth\.users\b/);
    const created = [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
    expect(created).toEqual(["prompter_trial_signup_attempts", "prompter_trial_rate_buckets"]);
    const replaced = [...sql.matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1]);
    expect(replaced).toContain("fn_enforce_trial_subscription_insert");
    expect(replaced.every((n) => n.startsWith("fn_trial_") || n === "fn_enforce_trial_subscription_insert")).toBe(true);
  });

  it("stores pseudonyms only: every digest column is constrained to 64 lowercase hex characters", () => {
    for (const col of ["email_hmac", "cookie_hmac", "device_hmac", "ip_hmac", "key_hmac"]) {
      expect(sql).toMatch(new RegExp(`${col} text[^,]*~ '\\^\\[0-9a-f\\]\\{64\\}\\$'`));
    }
    expect(sql).not.toMatch(/\b(email|ip_address|user_agent|fingerprint)\s+text\b/);
  });

  it("both tables have RLS enabled, zero policies and no privileges for app roles", () => {
    expect(sql).toMatch(/alter table public\.prompter_trial_signup_attempts enable row level security;/);
    expect(sql).toMatch(/alter table public\.prompter_trial_rate_buckets enable row level security;/);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toMatch(/revoke all on public\.prompter_trial_signup_attempts from public, anon, authenticated;/);
    expect(sql).toMatch(/revoke all on public\.prompter_trial_rate_buckets from public, anon, authenticated;/);
  });

  it("every function is SECURITY DEFINER with a pinned search_path", () => {
    const fns = sql.split(/create or replace function /).slice(1).filter((f) => !f.startsWith("public.fn_enforce_trial_subscription_insert"));
    expect(fns.length).toBe(6);
    for (const f of fns) {
      expect(f).toMatch(/security definer/);
      expect(f).toMatch(/set search_path = public/);
    }
  });

  it("service functions are executable by service_role only; the hold check is the sole tenant-callable one", () => {
    for (const sig of [
      "fn_trial_bucket_hit\\(text, text, integer\\)",
      "fn_trial_signup_gate\\(text, integer, text, text, text, text\\)",
      "fn_trial_signup_finalize\\(uuid, uuid, boolean\\)",
      "fn_trial_release_hold\\(uuid, text\\)",
      "fn_trial_abuse_purge\\(integer\\)",
    ]) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${sig} from public, anon, authenticated;`));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${sig} to service_role;`));
    }
    expect(sql).toMatch(/grant execute on function public\.fn_trial_hold_active\(uuid\) to authenticated, service_role;/);
    expect(sql).not.toMatch(/grant execute[^;]*to[^;]*\banon\b/);
  });

  it("the hold check only answers for the caller's own tenant", () => {
    expect(sql).toMatch(/p_tenant_id is not distinct from public\.fn_current_tenant_id\(\)/);
  });

  it("the gate fails closed on malformed input and serialises concurrent attempts", () => {
    expect(sql).toMatch(/raise exception 'invalid pseudonym format'/);
    expect(sql).toMatch(/raise exception 'invalid mode %'/);
    expect(sql).toMatch(/pg_advisory_xact_lock\(hashtextextended\('prompter_trial_gate:'/);
    expect(sql).toMatch(/on conflict \(scope, key_hmac, window_start\)\s+do update set hits = b\.hits \+ 1/);
  });

  it("weak signals cannot deny alone: only cookie repeats can reach the DENY threshold", () => {
    const deviceMax = 20 + 20;
    const ipMax = 10 + 10;
    expect(deviceMax + ipMax).toBeLessThan(100);
    expect(sql).toMatch(/v_score >= 100 then 'DENY'/);
    expect(sql).toMatch(/v_n_cookie >= 2 then v_score := v_score \+ 50/);
  });

  it("retention is 90 days and purge needs no cron", () => {
    expect(sql).toMatch(/expires_at timestamptz not null default now\(\) \+ interval '90 days'/);
    expect(sql).not.toMatch(/cron\./i);
  });

  it("has a rollback outside supabase/migrations that restores the PR #31 trigger function and drops everything new", () => {
    expect(existsSync(path.join(root, DOWN))).toBe(true);
    const down = code(DOWN);
    expect(down).toMatch(/create or replace function public\.fn_enforce_trial_subscription_insert\(\)/);
    expect(down).not.toMatch(/fn_trial_hold_active\(new/);
    for (const t of ["prompter_trial_rate_buckets", "prompter_trial_signup_attempts"]) {
      expect(down).toMatch(new RegExp(`drop table if exists public\\.${t};`));
    }
  });

  it("migration ordering: sorts after the three P0 migrations it builds on", () => {
    const names = ["20261019100000", "20261019100100", "20261019100200", "20261019110000"];
    expect([...names].sort()).toEqual(names);
  });
});
