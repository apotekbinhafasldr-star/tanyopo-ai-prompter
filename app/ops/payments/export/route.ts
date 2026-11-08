import type { NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  MAX_EXPORT_ROWS,
  buildReconciliationCsv,
  parseExportRange,
  type ReconciliationInvoice,
  type ReconciliationTxn,
} from "@/lib/billing/reconciliation-csv";
import { getPaymentOperator } from "@/services/payment-operator";

/**
 * C5 — read-only daily reconciliation export: PAID payment transactions in a WIB date range plus the invoice each one
 * produced. Same gate as the rest of /ops/payments (getPaymentOperator): anyone who is not an active payment operator
 * gets a bare 404, so the route's existence is not revealed. GET only; it reads and never writes.
 *   /ops/payments/export?from=2026-11-01&to=2026-11-07
 */
export const dynamic = "force-dynamic";

const NOT_FOUND = () => new Response("Not Found", { status: 404 });

function badRequest(code: string) {
  return new Response(code, { status: 400, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const operator = await getPaymentOperator();
  if (!operator) return NOT_FOUND();

  if (!checkRateLimit(`ops-export:${operator.userId}`, 10, 60_000).allowed) {
    return new Response("RATE_LIMITED", { status: 429, headers: { "Cache-Control": "no-store" } });
  }

  const params = request.nextUrl.searchParams;
  const range = parseExportRange(params.get("from") ?? undefined, params.get("to") ?? undefined);
  if (!range.ok) return badRequest(`INVALID_RANGE_${range.reason}`);

  const { data: txns, error } = await operator.admin
    .from("prompter_payment_transactions")
    .select("id, tenant_id, provider, provider_payment_id, plan, amount, currency, paid_at")
    .eq("status", "PAID")
    .gte("paid_at", range.fromIso)
    .lt("paid_at", range.toExclusiveIso)
    .order("paid_at", { ascending: true })
    .limit(MAX_EXPORT_ROWS + 1);
  if (error || !txns) return new Response("EXPORT_FAILED", { status: 500, headers: { "Cache-Control": "no-store" } });
  if (txns.length > MAX_EXPORT_ROWS) return badRequest("TOO_MANY_ROWS_NARROW_THE_RANGE");

  const rows: ReconciliationTxn[] = txns;
  const invoices: ReconciliationInvoice[] = [];
  const ids = rows.map((t) => t.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error: invError } = await operator.admin
      .from("prompter_invoices")
      .select("id, transaction_id, status, amount, currency, period_start, period_end")
      .in("transaction_id", ids.slice(i, i + 200));
    if (invError || !data) return new Response("EXPORT_FAILED", { status: 500, headers: { "Cache-Control": "no-store" } });
    invoices.push(...data);
  }

  const fromDay = params.get("from") ?? "";
  const toDay = params.get("to") ?? "";
  return new Response(buildReconciliationCsv(rows, invoices), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="rekonsiliasi-${fromDay}_${toDay}.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
