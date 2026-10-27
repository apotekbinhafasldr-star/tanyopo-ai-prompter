import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Static safety-invariant checks on the LINOE finance migration. The behavioural proof (immutability,
 * grants, rollback refusal) was run against a throwaway local PostgreSQL 16 and is described in the PR.
 */
const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf-8");
const strip = (sql: string) =>
  sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n")
    .replace(/\s+/g, " ");

const up = strip(read("supabase/migrations/20261027100000_linoe_finance_foundation.sql"));
const down = strip(read("supabase/rollback/20261027100000_linoe_finance_foundation.down.sql"));

const TABLES = [
  "finance_audit_logs",
  "finance_platform_admins",
  "finance_ledger_entries",
  "finance_refunds",
  "finance_settlements",
  "finance_operating_expenses",
  "finance_tax_settings",
];

describe("finance foundation migration — additive and locked down", () => {
  it("creates exactly the seven finance tables and nothing else", () => {
    const created = [...up.matchAll(/create table (?:if not exists )?public\.([a-z_]+)/g)].map((m) => m[1]).sort();
    expect(created).toEqual([...TABLES].sort());
  });

  it("never alters, drops or truncates a pre-existing object", () => {
    expect(up).not.toMatch(/drop table|drop column|drop function|truncate table|rename to|alter column|alter table (?!public\.finance_)/i);
    for (const m of up.matchAll(/drop trigger if exists [a-z_]+ on public\.([a-z_]+)/g)) {
      expect(TABLES).toContain(m[1]);
    }
  });

  it("does not touch billing, tenants, cron or other products", () => {
    expect(up).not.toMatch(/prompter_|cron\.|pg_net|umkmpro|apotek|publoe|karyawan/i);
  });

  it("stores money as bigint minor units only", () => {
    expect(up).not.toMatch(/\b(real|double precision|float\d?|numeric|decimal|money)\b(?! \()/i);
    expect(up).not.toMatch(/ (numeric|decimal)\(/i);
    expect(up).toMatch(/amount_minor bigint/);
  });

  it("enables RLS on every table and defines no policy", () => {
    for (const t of TABLES) expect(up).toContain(`alter table public.${t} enable row level security`);
    expect(up).not.toMatch(/create policy/i);
  });

  it("revokes every privilege from public, anon, authenticated AND service_role (Supabase default privileges hand new objects to service_role), and grants no DELETE or TRUNCATE to anyone", () => {
    for (const t of TABLES) expect(up).toContain(`revoke all on public.${t} from public, anon, authenticated, service_role;`);
    expect(up).not.toMatch(/grant [^;]*(delete|truncate|all)[^;]* to/i);
    expect(up).not.toMatch(/grant [^;]* to (anon|authenticated|public)/i);
  });

  it("makes ledger and audit rows immutable (including TRUNCATE) and expenses void-only", () => {
    expect(up).toContain("trg_finance_audit_logs_immutable");
    expect(up).toContain("trg_finance_audit_logs_no_truncate");
    expect(up).toContain("trg_finance_ledger_immutable");
    expect(up).toContain("trg_finance_ledger_no_truncate");
    expect(up).toContain("trg_finance_tax_settings_immutable");
    expect(up).toContain("trg_finance_expenses_guard");
  });

  it("enforces idempotency and verified tax config in the database", () => {
    expect(up).toMatch(/idempotency_key text not null unique/);
    expect(up).toMatch(/unique \(provider, provider_refund_id\)/);
    expect(up).toMatch(/unique \(provider, provider_settlement_id\)/);
    expect(up).toMatch(/verified_by is not null and verified_at is not null/);
  });

  it("sets no default tax rate", () => {
    expect(up).not.toMatch(/ppn_rate_bps integer[^,]*default/i);
    expect(up).not.toMatch(/final_tax_rate_bps integer[^,]*default/i);
  });

  it("has a lock timeout", () => {
    expect(up).toContain("set local lock_timeout");
  });
});

describe("finance rollback — fails closed", () => {
  it("refuses to drop when any table holds rows, before dropping anything", () => {
    expect(down).toContain("rollback refused");
    expect(down.indexOf("rollback refused")).toBeLessThan(down.indexOf("drop table"));
    for (const t of TABLES) expect(down).toContain(`'${t}'`);
  });

  it("only drops finance objects", () => {
    for (const m of down.matchAll(/drop table if exists public\.([a-z_]+)/g)) expect(TABLES).toContain(m[1]);
    for (const m of down.matchAll(/drop function if exists public\.([a-z_]+)/g)) expect(m[1]).toMatch(/^fn_finance_/);
  });
});
