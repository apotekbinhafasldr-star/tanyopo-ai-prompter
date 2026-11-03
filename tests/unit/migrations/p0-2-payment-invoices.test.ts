import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Static invariants for LINOE P0-2 (invoice / payment receipt per verified payment). No live Postgres in this job.
 * The behavioural proof (success, repeated + PARALLEL webhooks, wrong amount, late payment, plan conflict, partial failure,
 * carryover period, tenant isolation, tenant deletion, drift guard, B2 regression, B4 composition, rollback) runs in the CI
 * job billing-p0-2-sql: supabase/tests/p0-2-invoices.
 */
const root = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf-8");
const executable = (sql: string) =>
  sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

const MIG = "supabase/migrations/20261103170000_prompter_p0_2_payment_invoices.sql";
const DOWN = "supabase/rollback/20261103170000_prompter_p0_2_payment_invoices.down.sql";
const B2 = "supabase/migrations/20261030140000_prompter_b2_double_payment_safety.sql";

const FN = /create or replace function public\.fn_apply_verified_payment\([\s\S]*?\n\$\$;/;
const fnOf = (sql: string) => {
  const m = FN.exec(sql);
  if (!m) throw new Error("fn_apply_verified_payment not found");
  return m[0];
};
const bodyOf = (fn: string) => fn.slice(fn.indexOf("as $$") + "as $$".length, fn.lastIndexOf("$$;"));
const normHash = (body: string) => createHash("md5").update(body.replace(/\s+/g, "")).digest("hex");

const mig = read(MIG);
const down = read(DOWN);
const b2 = read(B2);
const v3 = fnOf(mig);
const v2 = fnOf(b2);
const migSql = executable(mig);

describe("P0-2 migration: fn_apply_verified_payment v3 is B2 v2 plus ONLY the invoice", () => {
  it("is exactly B2 v2 once the six documented additions are removed (no accidental drift in the copied body)", () => {
    let back = v3;
    const undo = (added: string, original: string) => {
      expect(back.split(added).length - 1).toBe(1);
      back = back.replace(added, original);
    };
    undo("  v_review text;\n  v_final_end timestamptz;\n  v_paid_from timestamptz;\n  v_invoice_id uuid;\nbegin", "  v_review text;\nbegin");
    undo("    v_end := v_sub.current_period_end + interval '1 month';\n    v_paid_from := v_sub.current_period_end;\n", "    v_end := v_sub.current_period_end + interval '1 month';\n");
    undo("    v_end := v_now + interval '1 month';\n    v_paid_from := v_now;\n  end if;", "    v_end := v_now + interval '1 month';\n  end if;");
    undo("  where tenant_id = v_txn.tenant_id\n  returning current_period_end into v_final_end;\n  get diagnostics", "  where tenant_id = v_txn.tenant_id;\n  get diagnostics");
    const start = back.indexOf("\n  -- P0-2: exactly one PAID invoice");
    const end = back.indexOf("  end if;\n", back.indexOf("select i.id into v_invoice_id")) + "  end if;\n".length;
    expect(start).toBeGreaterThan(0);
    back = back.slice(0, start) + back.slice(end);
    undo("'provider', v_txn.provider,\n                       'invoice_id', v_invoice_id)\n  );", "'provider', v_txn.provider)\n  );");
    expect(back).toBe(v2);
  });

  it("keeps the exact signature, return shape and attributes of B2", () => {
    for (const must of [
      "p_transaction_id uuid,",
      "p_provider_payment_id text,",
      "p_provider_event_id text,",
      "p_verified_amount numeric,",
      "p_verified_currency text",
      "returns table(allowed boolean, reason text)",
      "language plpgsql",
      "security definer",
      "set search_path = public",
    ]) {
      expect(v3).toContain(must);
    }
  });

  it("writes the invoice AFTER the subscription UPDATE guard and BEFORE the audit row, in the same function (same transaction)", () => {
    const upd = v3.indexOf("update public.prompter_subscriptions");
    const guard = v3.indexOf("SUBSCRIPTION_UPDATE_AFFECTED_%");
    const ins = v3.indexOf("insert into public.prompter_invoices");
    const audit = v3.indexOf("'payment.succeeded'");
    expect(upd).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(upd);
    expect(ins).toBeGreaterThan(guard);
    expect(audit).toBeGreaterThan(ins);
  });

  it("inserts exactly one invoice statement, only on the activation path (after PAID is set), never in a REVIEW branch", () => {
    expect(v3.split("insert into public.prompter_invoices").length - 1).toBe(1);
    const paidMark = v3.indexOf("set status = 'PAID'");
    expect(v3.indexOf("insert into public.prompter_invoices")).toBeGreaterThan(paidMark);
    const reviewBranch = v3.slice(v3.indexOf("if v_review is not null then"), v3.indexOf("if v_sub.status = 'ACTIVE' and v_sub.current_period_end is not null and v_sub.current_period_end > v_now then\n    -- Same plan"));
    expect(reviewBranch).not.toContain("prompter_invoices");
  });

  it("reads the period end back from UPDATE ... RETURNING (AFTER the carryover trigger), never from v_end", () => {
    expect(v3).toMatch(/returning current_period_end into v_final_end;/);
    expect(v3).toMatch(/v_paid_from, v_final_end, v_now, v_now\)/);
    expect(v3).not.toMatch(/v_paid_from, v_end,/);
  });

  it("takes tenant, amount and currency from the transaction row and records PAID only", () => {
    expect(v3).toMatch(/v_txn\.tenant_id, v_txn\.id, v_txn\.provider, coalesce\(p_provider_payment_id, v_txn\.id::text\), 'PAID',\s+v_txn\.amount, v_txn\.currency,/);
    expect(v3).not.toMatch(/'DRAFT'|'OPEN'|'VOID'|'UNCOLLECTIBLE'/);
    expect(v3).not.toMatch(/p_verified_amount,\s+p_verified_currency,\s+'/); // the gateway numbers are only compared, never copied
  });

  it("is idempotent per transaction and lets every other failure abort the call (no exception swallowing)", () => {
    expect(v3).toMatch(/on conflict \(transaction_id\) where transaction_id is not null do nothing/);
    expect(v3).not.toMatch(/exception\s+when/i);
    expect(v3).toMatch(/if v_txn\.status = 'PAID' then[\s\S]*?'ALREADY_PROCESSED'/);
    expect(v3).toMatch(/if v_rows <> 1 then[\s\S]*raise exception 'SUBSCRIPTION_UPDATE_AFFECTED_%/);
  });

  it("carries the invoice id into the existing audit row without removing its keys", () => {
    expect(v3).toMatch(/'plan', v_txn\.plan, 'amount', v_txn\.amount, 'currency', v_txn\.currency, 'provider', v_txn\.provider,\s+'invoice_id', v_invoice_id/);
  });

  it("re-issues the same grants: service_role only", () => {
    expect(migSql).toMatch(/revoke all on function public\.fn_apply_verified_payment\(uuid, text, text, numeric, text\) from public, anon, authenticated;/);
    expect(migSql).toMatch(/grant execute on function public\.fn_apply_verified_payment\(uuid, text, text, numeric, text\) to service_role;/);
  });
});

describe("P0-2 migration: schema, privileges, guard", () => {
  it("is additive: a nullable FK column (no cascade/restrict that could block tenant deletion) and a partial unique index", () => {
    expect(migSql).toMatch(/add column if not exists transaction_id uuid references public\.prompter_payment_transactions\(id\);/);
    expect(migSql).not.toMatch(/transaction_id[^;]*on delete (cascade|restrict|set null)/i);
    expect(migSql).toMatch(/create unique index if not exists uq_prompter_invoices_transaction\s+on public\.prompter_invoices \(transaction_id\)\s+where transaction_id is not null;/);
  });

  it("re-creates no table and rewrites no existing row (no create table, no backfill, no update/delete of invoices)", () => {
    expect(migSql).not.toMatch(/create table/i);
    expect(migSql).not.toMatch(/drop table|drop schema|truncate\s+(table\s+)?public/i);
    expect(migSql).not.toMatch(/update public\.prompter_invoices|delete from public\.prompter_invoices/i);
    expect(migSql).not.toMatch(/insert into public\.prompter_invoices\s*\([^)]*\)\s*select/i); // no INSERT ... SELECT backfill
  });

  it("revokes client writes on prompter_invoices and leaves SELECT / RLS alone", () => {
    expect(migSql).toMatch(/revoke insert, update, delete, truncate on public\.prompter_invoices from anon, authenticated;/);
    expect(migSql).not.toMatch(/disable row level security|drop policy|create policy/i);
  });

  it("refuses to overwrite a function that is not the known B2 v2 (or this v3): both hashes are the real normalised md5s", () => {
    const h2 = normHash(bodyOf(v2));
    const h3 = normHash(bodyOf(v3));
    expect(h2).not.toBe(h3);
    expect(migSql).toContain(`'${h2}'`);
    expect(migSql).toContain(`'${h3}'`);
    expect(migSql).toMatch(/DIBATALKAN: badan fn_apply_verified_payment bukan B2 v2/);
    expect(migSql).toMatch(/fn_resolve_review_payment/);
  });

  it("touches no ledger, cron, role or other product, and has no psql meta-commands", () => {
    expect(migSql).not.toMatch(/supabase_migrations|schema_migrations|pg_cron|cron\.|alter (system|role)|create role|umkmpro|publoe|mitapeng/i);
    expect(mig).not.toMatch(/^\s*\\/m);
    expect(down).not.toMatch(/^\s*\\/m);
    expect(migSql).toMatch(/set local lock_timeout = '3s';/);
  });
});

describe("P0-2 rollback", () => {
  const downSql = executable(down);

  it("is fail-closed: refuses while any invoice is linked to a transaction, modifies no invoice row", () => {
    expect(downSql).toMatch(/rollback refused: invoices linked to payment transactions exist/);
    expect(downSql).not.toMatch(/update public\.prompter_invoices|delete from public\.prompter_invoices/i);
  });

  it("restores the exact B2 v2 function and removes only the P0-2 index and column", () => {
    expect(fnOf(down)).toBe(v2);
    expect(downSql).toMatch(/drop index if exists public\.uq_prompter_invoices_transaction;/);
    expect(downSql).toMatch(/alter table public\.prompter_invoices drop column if exists transaction_id;/);
    expect(downSql).toMatch(/revoke all on function public\.fn_apply_verified_payment\(uuid, text, text, numeric, text\) from public, anon, authenticated;/);
  });
});

describe("P0-2 wiring", () => {
  it("TypeScript types carry the new column on Row and Insert", () => {
    const types = read("types/database.ts");
    const invoices = types.slice(types.indexOf("prompter_invoices: {"), types.indexOf("prompter_payment_transactions: {"));
    expect(invoices).toMatch(/transaction_id: string \| null;/);
    expect(invoices).toMatch(/transaction_id\?: string \| null;/);
  });

  it("recordInvoiceFromProvider is documented as NOT the payment path", () => {
    const billing = read("services/billing.ts");
    expect(billing).toMatch(/NOT the payment-receipt path/);
  });

  it("CI runs the P0-2 SQL suite on PostgreSQL 17", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("billing-p0-2-sql:");
    expect(ci).toContain("bash supabase/tests/p0-2-invoices/run-local.sh");
  });
});
