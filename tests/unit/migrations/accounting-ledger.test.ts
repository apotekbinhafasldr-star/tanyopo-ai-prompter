import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf-8");
const strip = (sql: string) =>
  sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n")
    .replace(/\s+/g, " ");

const up = strip(read("supabase/migrations/20261027120000_linoe_accounting_ledger.sql"));
const down = strip(read("supabase/rollback/20261027120000_linoe_accounting_ledger.down.sql"));

describe("accounting ledger migration — additive, append-only, fail-closed", () => {
  it("creates only new acct_* tables and never alters or drops existing ones", () => {
    for (const m of up.matchAll(/create table if not exists public\.([a-z_]+)/g)) expect(m[1]).toMatch(/^acct_/);
    expect(up).not.toMatch(/alter table public\.(?!acct_|%I)/i);
    expect(up).not.toMatch(/drop table|drop column|rename to|alter column/i);
    expect(up).not.toMatch(/prompter_|cron\.|pg_net|umkmpro|apotek|publoe|karyawan|auth\.users/i);
  });

  it("seeds nothing: no insert, no opening balance, no rate, no identity", () => {
    expect(up).not.toMatch(/insert into public\.acct_/i);
    expect(up).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
    expect(up).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("money is bigint minor units, never float/numeric", () => {
    expect(up).not.toMatch(/\b(numeric|decimal|double precision|real|float|money)\b/i);
    expect(up).toContain("debit_minor bigint");
    expect(up).toContain("credit_minor bigint");
  });

  it("enforces double entry in the database: balanced, two-sided, one positive side per line, reference required", () => {
    expect(up).toContain("create constraint trigger trg_acct_lines_balanced");
    expect(up).toContain("deferrable initially deferred");
    expect(up).toContain("is unbalanced");
    expect(up).toContain("at least one debit and one credit line");
    expect(up).toContain("check ((debit_minor > 0) <> (credit_minor > 0))");
    expect(up).toContain("reference text not null check (btrim(reference) <> '')");
    expect(up).toContain("source_key text not null unique");
    expect(up).toContain("trg_acct_journal_has_lines");
  });

  it("corrections are reversing journals: reversed at most once, never edited", () => {
    expect(up).toContain("reverses_id uuid unique references public.acct_journals");
    expect(up).toContain("check ((journal_type = 'REVERSAL') = (reverses_id is not null))");
    expect(up).toContain("a reversal cannot itself be reversed");
    expect(up).toContain("fn_finance_block_mutation()");
    expect(up).toContain("before update or delete on public.%I");
    expect(up).toContain("before truncate on public.%I");
  });

  it("closed periods reject postings and reopening needs a reason; the period is derived without the generated column", () => {
    expect(up).toContain("accounting period % is closed");
    expect(up).toContain("action = 'CLOSE' or (reason is not null and btrim(reason) <> '')");
    expect(up).not.toMatch(/new\.period_key/);
  });

  it("opening balances need evidence; tax rates need a named verifier; payments need proof; final reconciliation needs zero difference", () => {
    expect(up).toContain("journal_type <> 'OPENING' or (evidence is not null");
    expect(up).toContain("corporate_tax_rate_bps is null or (verified_by is not null and verified_at is not null)");
    expect(up).toContain("evidence_ref text not null check (btrim(evidence_ref) <> '')");
    expect(up).toContain("finalized_by is null or unexplained_minor = 0");
  });

  it("RLS on with no policies, nothing for anon/authenticated, service_role without delete/truncate", () => {
    expect(up).toContain("enable row level security");
    expect(up).not.toMatch(/create policy/i);
    expect(up).toContain("revoke all on public.%I from public, anon, authenticated, service_role");
    expect(up).toContain("grant select, insert on public.%I to service_role");
    expect(up).not.toMatch(/grant [^;]*\b(delete|truncate)\b[^;]* to/i);
    expect(up).not.toMatch(/grant [^;]* to (anon|authenticated|public)/i);
  });

  it("has a lock timeout and audits every insert", () => {
    expect(up).toContain("set local lock_timeout");
    expect(up).toContain("fn_finance_audit()");
  });
});

describe("accounting ledger rollback — fails closed", () => {
  it("refuses while any accounting table holds rows, before dropping anything", () => {
    expect(down).toContain("rollback refused");
    expect(down.indexOf("rollback refused")).toBeLessThan(down.indexOf("drop table"));
    for (const t of ["acct_journals", "acct_journal_lines", "acct_tax_payments", "acct_fiscal_adjustments"]) expect(down).toContain(t);
  });
});
