import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Privilege hardening Phase 1 — static invariants on the migration text (repository-only; no database
 * access). The behavioural proof (before/after privilege matrix, positive + negative probes, tenant A/B,
 * Owner/Marketing, service_role, cron, webhook, idempotency, rollback, PR #31/#44/#45 integration and
 * order independence) is supabase/tests/privilege-phase1 (CI job `privilege-phase1-sql`, throw-away
 * PostgreSQL, synthetic data). These checks pin the SQL so a scope limit cannot be widened silently.
 */
const root = path.resolve(__dirname, "../../..");
const name = "20261020190000_prompter_privilege_hardening_phase1";
const migrationsDir = path.join(root, "supabase/migrations");
const sql = readFileSync(path.join(migrationsDir, `${name}.sql`), "utf-8");
const code = sql.replace(/--.*$/gm, "");
const down = readFileSync(path.join(root, `supabase/rollback/${name}.down.sql`), "utf-8");

const listed = (marker: string, end: string): string[] => {
  const start = code.indexOf(marker);
  const slice = code.slice(start, code.indexOf(end, start));
  return [...slice.matchAll(/'(prompter_[a-z_]+)'/g)].map((m) => m[1]);
};
const allTables = listed("c_all text[]", "c_select_only");
const selectOnly = listed("c_select_only text[]", "c_privs");

describe("privilege hardening Phase 1 migration", () => {
  it("is REVOKE-only: no DDL/DML, no GRANT, no policy/RLS/function/ownership/default-privilege change", () => {
    expect(code).not.toMatch(/\balter\s+default\s+privileges\b/i);
    expect(code).not.toMatch(/\b(create|drop|alter)\s+(table|policy|function|trigger|schema|role|index|type|extension)\b/i);
    expect(code).not.toMatch(/\b(insert\s+into|delete\s+from|update\s+public\.|truncate\s+table)\b/i);
    expect(code).not.toMatch(/(^|\s)grant\s/i);
    expect(code).not.toMatch(/\bowner\s+to\b/i);
  });

  it("revokes TRUNCATE/REFERENCES/TRIGGER from PUBLIC, anon and authenticated, and everything from anon, on every listed table", () => {
    expect(code).toMatch(/revoke truncate on public\.%I from public, anon, authenticated/);
    expect(code).toMatch(/revoke references, trigger on public\.%I from public, anon, authenticated/);
    expect(code).toMatch(/revoke all on public\.%I from anon/);
  });

  it("covers every prompter_* table that exists in the repo's migrations (or that table revokes anon itself)", () => {
    const created = new Set<string>();
    const selfLocked = new Set<string>();
    for (const f of readdirSync(migrationsDir).filter((x) => x.endsWith(".sql"))) {
      if (f === `${name}.sql`) continue;
      const text = readFileSync(path.join(migrationsDir, f), "utf-8").replace(/--.*$/gm, "");
      for (const m of text.matchAll(/create table (?:if not exists )?(?:public\.)?(prompter_[a-z_]+)/gi)) created.add(m[1]);
      for (const m of text.matchAll(/revoke all on (?:table )?public\.(prompter_[a-z_]+) from [^;]*\banon\b/gi)) selfLocked.add(m[1]);
    }
    const uncovered = [...created].filter((t) => !allTables.includes(t) && !selfLocked.has(t));
    // A new prompter_* table must either be added to c_all here or revoke anon/authenticated defaults itself.
    expect(uncovered).toEqual([]);
    for (const t of allTables) expect(created.has(t) || t === "prompter_manual_ad_metrics", t).toBe(true);
  });

  it("MAINTAIN is revoked only through version-gated dynamic SQL (a static REVOKE MAINTAIN fails to parse on PostgreSQL < 17)", () => {
    expect(code).toMatch(/server_version_num'\)::int >= 170000/);
    expect(code).toMatch(/execute format\('revoke maintain on public\.%I from public, anon, authenticated', t\)/);
    expect(code.replace(/execute format\('[^']*'/g, "")).not.toMatch(/\bmaintain\b\s+on\b/i);
  });

  it("never touches service_role and never mass-revokes authenticated (REVOKE ALL only for the oauth vault)", () => {
    expect(code).not.toMatch(/\b(revoke|grant)\b[^;]*\bservice_role\b/i);
    const mass = [...code.matchAll(/revoke all on [^;]*from authenticated/gi)].map((m) => m[0]);
    expect(mass).toEqual(["revoke all on public.prompter_oauth_credentials from authenticated"]);
    expect(code).toMatch(/service_role privilege % on % changed/);
    expect(code).toMatch(/PUBLIC holds a privilege/);
  });

  it("only SELECT-only tables lose INSERT/UPDATE/DELETE; they are exactly the policy-SELECT-only tables", () => {
    expect([...selectOnly].sort()).toEqual([
      "prompter_invoices",
      "prompter_jobs",
      "prompter_plan_entitlements",
      "prompter_platform_capabilities",
      "prompter_product_snapshots",
      "prompter_webhook_events",
    ]);
    expect(code).toMatch(/revoke insert, update, delete on public\.%I from authenticated/);
  });

  it("protects audit + financial evidence from client UPDATE/DELETE without touching INSERT", () => {
    expect(code).toMatch(/revoke update, delete on public\.prompter_audit_logs from authenticated/);
    expect(code).toMatch(/revoke update, delete on public\.prompter_payment_transactions from authenticated/);
    expect(code).toMatch(/revoke delete on public\.prompter_subscriptions from authenticated/);
  });

  it("does NOT touch what Phase 1 must leave alone (checkout INSERT, UPDATE(plan), ai_jobs, audit INSERT)", () => {
    // table-level UPDATE revoke on subscriptions would also drop the column-level UPDATE(plan) grant
    expect(code).not.toMatch(/revoke\s+[^;]*\bupdate\b[^;]*on public\.prompter_subscriptions/i);
    expect(code).not.toMatch(/revoke\s+[^;]*\binsert\b[^;]*on public\.prompter_(payment_transactions|subscriptions|audit_logs)\b/i);
    expect(code).not.toMatch(/prompter_ai_jobs'?\s*(from|to)/i);
    expect(selectOnly).not.toContain("prompter_ai_jobs");
    expect(selectOnly).not.toContain("prompter_payment_transactions");
    expect(selectOnly).not.toContain("prompter_subscriptions");
    expect(selectOnly).not.toContain("prompter_audit_logs");
  });

  it("only touches prompter_* objects, never shared/sibling-product tables", () => {
    const refs = [...code.matchAll(/public\.([a-z_]+)/g)].map((m) => m[1]).filter((n) => n !== "%I");
    for (const r of refs) expect(r, r).toMatch(/^prompter_/);
    expect(code).not.toMatch(/\b(tenants|user_profiles|auth\.users)\b/);
  });

  it("is idempotent and skips tables that do not exist yet; fails closed on any unexpected privilege change", () => {
    expect(code).toMatch(/to_regclass\('public\.' \|\| t\) is null/);
    expect(code).toMatch(/post-check failed: % still granted to authenticated on %/);
    expect(code).toMatch(/post-check failed: anon still has/);
    expect(code).toMatch(/post-check failed: unexpected loss of/);
    expect(code).toMatch(/lock_timeout/);
  });

  it("the rollback is outside supabase/migrations and is a fail-closed targeted forward-fix, never a mass restore", () => {
    expect(existsSync(path.join(migrationsDir, `${name}.down.sql`))).toBe(false);
    const dcode = down.replace(/--.*$/gm, "");
    // never restores anon / TRUNCATE / REFERENCES / TRIGGER
    expect(dcode).not.toMatch(/\bto\s+anon\b/i);
    expect(dcode).not.toMatch(/grant\s+[^;]*\btruncate\b/i);
    expect(dcode).toMatch(/grant %s on public\.%I to authenticated/);
    // requires the exact pairs and refuses everything else
    expect(dcode).toMatch(/refused: name the exact table:PRIVILEGE pairs/);
    expect(dcode).toMatch(/not \(\(v_t \|\| ':' \|\| v_p\) = any \(c_allowed\)\)/);
    // the allowlist holds ONLY the 3 low-risk tables x INSERT/UPDATE/DELETE
    const allowed = [...dcode.slice(dcode.indexOf("c_allowed"), dcode.indexOf("v_pairs text[]")).matchAll(/'(prompter_[a-z_]+):([A-Z]+)'/g)].map((m) => `${m[1]}:${m[2]}`);
    expect(allowed).toHaveLength(9);
    for (const a of allowed) {
      expect(a).toMatch(/^prompter_(jobs|platform_capabilities|product_snapshots):(INSERT|UPDATE|DELETE)$/);
    }
    for (const forbidden of ["ai_jobs", "payment_transactions", "invoices", "webhook_events", "plan_entitlements", "audit_logs", "subscriptions", "oauth_credentials"]) {
      expect(allowed.join(" ")).not.toContain(forbidden);
    }
    // all-or-nothing post-check
    expect(dcode).toMatch(/rollback post-check failed: unexpected privilege change/);
    expect(down).toMatch(/240 privilege cells/);
    // plain SQL: no psql meta-commands / variables; unedited placeholder refuses
    expect(down.split("\n").filter((l) => /^\s*\\/.test(l))).toEqual([]);
    expect(dcode).not.toMatch(/:\{\?|:'pairs'|\\gset/);
    expect(dcode).toMatch(/v_raw text := 'REPLACE_WITH_PAIRS'/);
    expect(dcode).toMatch(/v_raw = 'REPLACE_WITH_PAIRS'/);
    // RLS-inert guard + never service_role / PUBLIC / MAINTAIN grants
    expect(dcode).toMatch(/relrowsecurity/);
    expect(dcode).toMatch(/polcmd in \(v_cmd, '\*'\)/);
    expect(dcode).not.toMatch(/\bto\s+(service_role|public|anon)\b/i);
    expect(dcode).not.toMatch(/grant\s+maintain/i);
  });
});
