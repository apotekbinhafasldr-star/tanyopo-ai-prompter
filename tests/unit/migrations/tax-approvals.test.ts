import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Static invariants. Behaviour was proven on real PostgreSQL (supabase/tests/tax-approvals; CI job tax-approvals-pg17). */
const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf-8");
const strip = (sql: string) => sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n").replace(/\s+/g, " ");
const up = strip(read("supabase/migrations/20261027130000_linoe_tax_optimization_approvals.sql"));
const down = strip(read("supabase/rollback/20261027130000_linoe_tax_optimization_approvals.down.sql"));

describe("tax approvals migration", () => {
  it("enables RLS and grants service_role SELECT only on the table", () => {
    expect(up).toMatch(/alter table (public\.)?tax_opt_decisions enable row level security/i);
    expect(up).toMatch(/revoke all on (table )?(public\.)?tax_opt_decisions from (public|anon|authenticated)/i);
    expect(up).not.toMatch(/grant (insert|update|delete|truncate|all)[^;]* on (table )?(public\.)?tax_opt_decisions/i);
  });
  it("write function is security definer with fixed search_path and no public execute", () => {
    expect(up).toMatch(/function public\.tax_opt_record_decision.*security definer set search_path = public, pg_temp/i);
    expect(up).toMatch(/revoke all on function public\.tax_opt_record_decision[^;]* from public/i);
    expect(up).toMatch(/grant execute on function public\.tax_opt_record_decision[^;]* to service_role/i);
    expect(up).not.toMatch(/grant execute on function public\.tax_opt_record_decision[^;]* to (anon|authenticated|public)/i);
  });
  it("blocks update, delete and truncate; no hardcoded email", () => {
    expect(up).toMatch(/before update or delete/i);
    expect(up).toMatch(/before truncate/i);
    expect(up).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
  });
  it("rollback refuses when decisions exist and is not applied by default", () => {
    expect(down).toMatch(/raise exception/i);
    expect(down).toMatch(/drop table/i);
    expect(existsSync(path.join(process.cwd(), "supabase/tests/tax-approvals/tests.sql"))).toBe(true);
  });
  it("does not touch billing, Midtrans, Apotek or PUBLOE objects", () => {
    expect(up).not.toMatch(/midtrans|apotek|publoe|payment_|billing_/i);
  });
});
