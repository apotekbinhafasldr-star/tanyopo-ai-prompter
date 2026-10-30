/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles intentionally mimic a loosely typed query builder */
import { vi } from "vitest";
import { computeMidtransSignature } from "@/lib/billing/providers/midtrans-payment-provider";

export const SERVER_KEY = "SB-Mid-server-TESTKEY123";
export const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const TXN_A = "11111111-1111-4111-8111-111111111111";
export const TXN_B = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, any>;

export interface FakeDb {
  txns: Row[];
  events: Row[];
  audit: Row[];
  /** B4.1 payment alert queue (one row per transaction + kind, like the database unique constraint). */
  alerts: Row[];
  rpcCalls: Array<{ name: string; args: Row }>;
  /** Number of paid periods granted per tenant (what fn_apply_verified_payment would have added). */
  periods: Record<string, number>;
  failAlarmRecord: boolean;
  rpcError: boolean;
  from: (table: string) => any;
  rpc: (name: string, args: Row) => Promise<{ data: unknown; error: { message: string } | null }>;
}

/**
 * Minimal in-memory stand-in for the Supabase client. Query filters (.eq/.neq) are REALLY applied, so tenant scoping and
 * guarded updates are exercised, not mocked away. fn_apply_verified_payment is a faithful-enough model of B2's contract:
 * idempotent per transaction, non-PENDING / mismatching payments become REVIEW, at most one period per transaction. The
 * real database function (row locks, parallelism) is covered by supabase/tests/b2-double-payment.
 */
export function createFakeDb(): FakeDb {
  const db: FakeDb = {
    txns: [],
    events: [],
    audit: [],
    alerts: [],
    rpcCalls: [],
    periods: {},
    failAlarmRecord: false,
    rpcError: false,
    from: () => undefined,
    rpc: async () => ({ data: null, error: null }),
  };

  const tables: Record<string, Row[]> = {
    prompter_payment_transactions: db.txns,
    prompter_webhook_events: db.events,
    prompter_audit_logs: db.audit,
  };
  let seq = 0;

  db.from = (name: string) => {
    const rows = tables[name];
    if (!rows) throw new Error(`unexpected table ${name}`);
    const q = { op: "select" as "select" | "insert" | "update", payload: undefined as Row | undefined, filters: [] as Array<(r: Row) => boolean>, limitN: undefined as number | undefined };

    const exec = (mode: "single" | "maybe" | null) => {
      if (q.op === "insert") {
        const payload = q.payload as Row;
        if (name === "prompter_webhook_events") {
          const dup = rows.some(
            (r) => r.source_system === payload.source_system && r.external_event_id === payload.external_event_id,
          );
          if (dup) return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        const row = { id: `${name}-${++seq}`, ...payload };
        rows.push(row);
        return { data: { id: row.id }, error: null };
      }
      const matches = rows.filter((r) => q.filters.every((f) => f(r)));
      if (q.op === "update") {
        for (const r of matches) Object.assign(r, q.payload);
        return { data: null, error: null };
      }
      const limited = q.limitN === undefined ? matches : matches.slice(0, q.limitN);
      if (mode) return { data: limited[0] ?? null, error: null };
      return { data: limited, error: null };
    };

    const b: any = {
      select: () => b,
      insert: (p: Row) => ((q.op = "insert"), (q.payload = p), b),
      update: (p: Row) => ((q.op = "update"), (q.payload = p), b),
      eq: (c: string, v: unknown) => (q.filters.push((r) => r[c] === v), b),
      neq: (c: string, v: unknown) => (q.filters.push((r) => r[c] !== v), b),
      limit: (n: number) => ((q.limitN = n), b),
      single: () => Promise.resolve(exec("single")),
      maybeSingle: () => Promise.resolve(exec("maybe")),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(exec(null)).then(res, rej),
    };
    return b;
  };

  db.rpc = async (name: string, args: Row) => {
    db.rpcCalls.push({ name, args });
    if (db.rpcError) return { data: null, error: { message: "boom" } };
    if (name === "fn_record_payment_alarm") {
      if (db.failAlarmRecord) return { data: null, error: { message: "alarm insert failed" } };
      const txn = db.txns.find((r) => r.id === args.p_transaction_id);
      if (!txn) return { data: "TRANSACTION_NOT_FOUND", error: null };
      if (db.alerts.some((a) => a.transaction_id === txn.id && a.kind === args.p_kind)) return { data: "EXISTING", error: null };
      db.alerts.push({ transaction_id: txn.id, tenant_id: txn.tenant_id, kind: args.p_kind, evidence: args.p_evidence });
      return { data: "CREATED", error: null };
    }
    const t = db.txns.find((r) => r.id === args.p_transaction_id);
    if (!t) return { data: [{ allowed: false, reason: "TRANSACTION_NOT_FOUND" }], error: null };
    if (t.status === "PAID") return { data: [{ allowed: true, reason: "ALREADY_PROCESSED" }], error: null };
    if (t.status === "REVIEW") return { data: [{ allowed: false, reason: "NEEDS_REVIEW" }], error: null };
    if (t.status !== "PENDING" || t.amount !== args.p_verified_amount || t.currency !== args.p_verified_currency) {
      t.failure_reason = t.status === "PENDING" ? "AMOUNT_OR_CURRENCY_MISMATCH" : `LATE_PAYMENT_${t.status}`;
      t.status = "REVIEW";
      return { data: [{ allowed: false, reason: "NEEDS_REVIEW" }], error: null };
    }
    t.status = "PAID";
    t.provider_payment_id = args.p_provider_payment_id;
    db.periods[t.tenant_id] = (db.periods[t.tenant_id] ?? 0) + 1;
    return { data: [{ allowed: true, reason: null }], error: null };
  };

  return db;
}

export function addTxn(db: FakeDb, over: Row = {}): Row {
  const row: Row = {
    id: TXN_A,
    tenant_id: TENANT_A,
    provider: "midtrans",
    status: "PENDING",
    amount: 99000,
    currency: "IDR",
    plan: "PRO",
    provider_payment_id: null,
    ...over,
  };
  db.txns.push(row);
  return row;
}

/** A Midtrans notification, correctly signed with the sandbox key (or `signKey`). */
export function signedNotification(over: Row = {}, signKey = SERVER_KEY): string {
  const body: Row = {
    order_id: TXN_A,
    status_code: "200",
    gross_amount: "99000.00",
    transaction_id: "mid-tx-1",
    transaction_status: "settlement",
    currency: "IDR",
    ...over,
  };
  const sig = computeMidtransSignature(String(body.order_id), String(body.status_code), String(body.gross_amount), signKey);
  body.signature_key = over.signature_key !== undefined ? over.signature_key : sig;
  return JSON.stringify(body);
}

export type GatewayAnswer = Row | "TIMEOUT" | "HTTP_500" | "GARBAGE" | "NOT_FOUND_BODY";

/** Fakes Midtrans' Get Status endpoint: answers per order id, records every call. */
export function installGateway() {
  const answers = new Map<string, GatewayAnswer>();
  const fetchMock = vi.fn(async (url: string) => {
    const match = /\/v2\/([^/]+)\/status$/.exec(String(url));
    const orderId = match ? decodeURIComponent(match[1]) : "";
    const answer = answers.get(orderId);
    if (answer === "TIMEOUT") throw new DOMException("timed out", "TimeoutError");
    if (answer === "HTTP_500") return new Response("{}", { status: 500 });
    if (answer === "GARBAGE") return new Response("<html>nope</html>", { status: 200 });
    if (answer === undefined || answer === "NOT_FOUND_BODY") {
      return new Response(JSON.stringify({ status_code: "404", status_message: "Transaction doesn't exist." }), { status: 200 });
    }
    const body: Row = {
      status_code: "200",
      transaction_id: "mid-tx-1",
      order_id: orderId,
      gross_amount: "99000.00",
      currency: "IDR",
      transaction_status: "settlement",
      ...answer,
    };
    for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
    body.signature_key = computeMidtransSignature(String(body.order_id), String(body.status_code), String(body.gross_amount), SERVER_KEY);
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    answer(orderId: string, answer: GatewayAnswer) {
      answers.set(orderId, answer);
    },
  };
}
