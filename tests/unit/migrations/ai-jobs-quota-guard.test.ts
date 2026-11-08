import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * AI Jobs quota guard — static invariants (the behaviour itself is proven on a throw-away PostgreSQL by
 * supabase/tests/ai-jobs-guard/run-local.sh, which CI runs in the `ai-jobs-guard-sql` job).
 */
const root = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf-8");
const code = (sql: string) =>
  sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

const G1 = "supabase/migrations/20261021120000_prompter_ai_jobs_quota_guard.sql";
const G2 = "supabase/migrations/20261021120100_prompter_ai_jobs_delete_guard.sql";
const D1 = "supabase/rollback/20261021120000_prompter_ai_jobs_quota_guard.down.sql";
const D2 = "supabase/rollback/20261021120100_prompter_ai_jobs_delete_guard.down.sql";

describe("AI jobs quota guard migrations", () => {
  const g1 = code(read(G1));
  const g2 = code(read(G2));

  it("keeps the RPC signature and security model", () => {
    expect(g1).toMatch(/create or replace function public\.fn_create_ai_job_if_entitled\(\s*p_job_type text,\s*p_input_reference jsonb default '\{\}'::jsonb\s*\)/);
    expect(g1).toMatch(/returns table\(job_id uuid, allowed boolean, reason text, used_count integer, allowance integer\)/);
    expect(g1).toMatch(/security definer\s+set search_path = public/);
  });

  it("takes identity from the JWT helpers, never from a parameter", () => {
    expect(g1).toMatch(/v_tenant_id := public\.fn_current_tenant_id\(\)/);
    expect(g1).toMatch(/v_actor_user_id := auth\.uid\(\)/);
    expect(g1).toMatch(/v_role := public\.fn_current_role\(\)/);
    expect(g1).toMatch(/v_role not in \('owner', 'marketing'\)/);
  });

  it("checks NO_TENANT first, then role, then type, then input, and only then locks and counts", () => {
    const order = ["NO_TENANT", "ROLE_NOT_ALLOWED", "INVALID_JOB_TYPE", "INVALID_INPUT", "pg_advisory_xact_lock"].map((k) => g1.indexOf(k));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("keeps the quota maths and PR #31's fail-closed entitlement block", () => {
    expect(g1).toContain("created_at >= v_period_start");
    expect(g1).toContain("v_used >= v_entitlement.ai_usage_allowance");
    expect(g1).toContain("ENTITLEMENT_NOT_CONFIGURED");
    expect(g1).toContain("date_trunc('month', now())");
  });

  it("validates exactly the job types the app routes (lib/ai/task-classes.ts)", () => {
    const ts = read("lib/ai/task-classes.ts");
    const block = ts.slice(ts.indexOf("TASK_CLASS_BY_JOB_TYPE"));
    const appTypes = [...block.matchAll(/^\s{2}([A-Z_]+):\s*"/gm)].map((m) => m[1]).sort();
    expect(appTypes).toHaveLength(6);
    const list = g1.slice(g1.indexOf("p_job_type not in ("), g1.indexOf("INVALID_JOB_TYPE"));
    const sqlTypes = [...list.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();
    expect(sqlTypes).toEqual(appTypes);
  });

  it("caps input_reference at 64 KiB and requires a JSON object", () => {
    expect(g1).toContain("octet_length(v_input::text) > 65536");
    expect(g1).toContain("jsonb_typeof(v_input) <> 'object'");
  });

  it("changes no privilege and no table definition", () => {
    for (const sql of [g1, g2]) {
      expect(sql).not.toMatch(/\balter\s+default\s+privileges\b/i);
      expect(sql).not.toMatch(/\balter\s+table\b/i);
      expect(sql).not.toMatch(/\b(drop|create)\s+table\b/i);
      expect(sql).not.toMatch(/\bgrant\b[^;]*\bon\s+(table\s+)?public\.prompter_/i);
      expect(sql).not.toMatch(/\brevoke\b[^;]*\bon\s+(table\s+)?public\.prompter_/i);
      expect(sql).not.toMatch(/\b(insert|update|delete)\s+(into|from)?\s*public\.(tenants|user_profiles)/i);
    }
    // the RPC's own ACL is not touched (CREATE OR REPLACE keeps it)
    expect(g1).not.toMatch(/grant execute on function public\.fn_create_ai_job_if_entitled/i);
  });

  it("only attaches triggers to prompter_ai_jobs and never touches sibling-product objects", () => {
    for (const sql of [g1, g2]) {
      for (const m of sql.matchAll(/\b(?:create|drop)\s+trigger[^;]*?\bon\s+(public\.[a-z_]+)/gi)) {
        expect(m[1]).toBe("public.prompter_ai_jobs");
      }
      expect(sql).not.toMatch(/ai_assistant_usage_log|fitur_ai_usage_log|umkmpro|publoe|apotek/i);
    }
  });

  it("guard functions are SECURITY INVOKER so current_user is the real caller", () => {
    const fns = g1.match(/create or replace function public\.fn_guard_ai_job_[a-z_]+\(\)[\s\S]*?\$\$;/g) ?? [];
    expect(fns).toHaveLength(2);
    for (const f of fns) expect(f).not.toMatch(/security definer/i);
    expect(g2).not.toMatch(/security definer/i);
  });

  it("immutable columns exclude the bookkeeping the app writes on completion/failure", () => {
    const guard = g1.slice(g1.indexOf("fn_guard_ai_job_immutable()"), g1.indexOf("fn_guard_ai_job_truncate()"));
    for (const col of ["id", "tenant_id", "actor_user_id", "job_type", "input_reference", "created_at"]) expect(guard).toContain(`new.${col}`);
    for (const col of ["status", "provider", "model", "tokens_input", "tokens_output", "output_reference", "completed_at", "error", "error_category", "fallback_provider", "estimated_cost"]) {
      expect(guard).not.toContain(`new.${col} `);
    }
  });

  it("part 2 refuses to apply without PR #31 and without part 1 being live", () => {
    expect(g2).toContain("has_table_privilege('authenticated', 'public.prompter_ai_jobs', 'DELETE')");
    expect(g2).toContain("ROLE_NOT_ALLOWED");
    expect(g2).toMatch(/before delete on public\.prompter_ai_jobs/);
  });
});

describe("AI jobs quota guard rollbacks", () => {
  const fnOf = (sql: string) => {
    const i = sql.indexOf("create or replace function public.fn_create_ai_job_if_entitled(");
    return sql.slice(i, sql.indexOf("$$;", i) + 3);
  };
  it("contain no GRANT (cannot re-open any privilege) and are not in the migrations dir", () => {
    for (const p of [D1, D2]) {
      expect(code(read(p))).not.toMatch(/\bgrant\b/i);
      expect(p).not.toContain("supabase/migrations");
    }
  });
  it("rollback 1 restores the EXACT B10 body that is live (byte-for-byte copy from the B10 migration)", () => {
    const b10 = fnOf(read("supabase/migrations/20260915051359_prompter_b10_payment_billing_core.sql"));
    expect(b10.length).toBeGreaterThan(1500);
    expect(fnOf(read(D1))).toBe(b10);
    const d = code(read(D1));
    expect(d).not.toContain("ROLE_NOT_ALLOWED");
    expect(d).not.toContain("ENTITLEMENT_NOT_CONFIGURED");
    expect(d).toMatch(/drop trigger if exists trg_prompter_ai_jobs_immutable/);
  });
  it("rollback 2 only drops the delete trigger and its function", () => {
    const d = code(read(D2));
    expect(d).toMatch(/drop trigger if exists trg_prompter_ai_jobs_no_delete/);
    expect(d).toMatch(/drop function if exists public\.fn_guard_ai_job_delete\(\)/);
  });
});

describe("compatibility with S1 (already in the tree and on production)", () => {
  const S1 = "supabase/migrations/20261019100000_prompter_p0_ai_jobs_lockdown.sql";
  const g1 = code(read(G1));

  it("S1 does not redefine the RPC, so the guard is the next definition after B10 (no hidden overwrite)", () => {
    const definers = readdirSync(path.join(root, "supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => /create or replace function public\.fn_create_ai_job_if_entitled\(/i.test(code(read(`supabase/migrations/${f}`))))
      .sort();
    expect(definers).toEqual([
      "20260915043800_prompter_b9_entitlement_enforcement.sql",
      "20260915051359_prompter_b10_payment_billing_core.sql",
      "20261021120000_prompter_ai_jobs_quota_guard.sql",
    ]);
  });

  it("the columns the guard freezes are NOT among the 10 columns S1 grants UPDATE on (defence in depth, no overlap)", () => {
    const s1 = code(read(S1));
    const granted = (s1.match(/grant update \(([\s\S]*?)\) on public\.prompter_ai_jobs/i)?.[1] ?? "")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    expect(granted).toHaveLength(10);
    for (const col of ["id", "tenant_id", "actor_user_id", "job_type", "input_reference", "created_at"]) {
      expect(granted).not.toContain(col);
    }
  });

  it("part 2 prerequisite is the S1 DELETE revoke, which S1 performs", () => {
    expect(code(read(S1))).toMatch(/revoke insert, delete, truncate on public\.prompter_ai_jobs from authenticated, anon/);
    expect(code(read(G2))).toContain("has_table_privilege('authenticated', 'public.prompter_ai_jobs', 'DELETE')");
  });

  it("guard keeps the B10 behaviour lines (trial = FREE numbers, PAST_DUE/CANCELED denied, trial expiry)", () => {
    expect(g1).toContain("case when v_sub.status = 'TRIALING' then 'FREE' else coalesce(v_sub.plan, 'FREE') end");
    expect(g1).toContain("v_sub.status in ('PAST_DUE', 'CANCELED')");
    expect(g1).toContain("now() > v_sub.current_period_end");
    expect(g1).toContain("v_period_start := coalesce(v_sub.current_period_start, v_sub.created_at)");
  });
});

describe("app compatibility", () => {
  const svc = read("services/ai-jobs.ts");
  it("services/ai-jobs.ts handles unknown denial reasons with its generic message", () => {
    expect(svc).toMatch(/default:\s*\n\s*return "Akses AI tidak diizinkan/);
  });
  it("services/ai-jobs.ts maps every reason the guard adds to a specific message", () => {
    for (const reason of ["ROLE_NOT_ALLOWED", "INVALID_JOB_TYPE", "INVALID_INPUT", "ENTITLEMENT_NOT_CONFIGURED"]) {
      expect(g1Reasons()).toContain(reason);
      expect(svc).toContain(`case "${reason}"`);
    }
  });
  it("job release for an unconfigured provider uses the service-role client (DELETE guard compatible)", () => {
    const fn = svc.slice(svc.indexOf("async function releaseUnconfiguredJob"), svc.indexOf("describeEntitlementBlock"));
    expect(fn).toContain("createAdminClient()");
    expect(fn).toMatch(/admin\s*\.from\("prompter_ai_jobs"\)\s*\.delete\(\)/);
    // the user-client fallback only writes S1-granted bookkeeping columns
    expect(fn).toMatch(/\.update\(\{\s*status: "FAILED",\s*error:[^}]*error_category: "CONFIG",\s*completed_at:/);
  });
});

function g1Reasons(): string[] {
  const sql = code(read(G1));
  return [...sql.matchAll(/'([A-Z_]+)'::text/g)].map((m) => m[1]);
}
