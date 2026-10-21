import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
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
  it("contain no GRANT (cannot re-open any privilege) and are not in the migrations dir", () => {
    for (const p of [D1, D2]) {
      expect(code(read(p))).not.toMatch(/\bgrant\b/i);
      expect(p).not.toContain("supabase/migrations");
    }
  });
  it("rollback 1 restores a function that keeps the fail-closed entitlement block and has no role guard", () => {
    const d = code(read(D1));
    expect(d).toContain("ENTITLEMENT_NOT_CONFIGURED");
    expect(d).not.toContain("ROLE_NOT_ALLOWED");
    expect(d).toMatch(/drop trigger if exists trg_prompter_ai_jobs_immutable/);
  });
});

describe("app compatibility", () => {
  it("services/ai-jobs.ts handles unknown denial reasons with its generic message", () => {
    const svc = read("services/ai-jobs.ts");
    expect(svc).toMatch(/default:\s*\n\s*return "Akses AI tidak diizinkan/);
  });
});
