// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- query-builder test double */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getDokuWebhookHealth, listRecheckCandidates, HEALTH_MAX_ROWS } from "@/services/payment-health";

type Row = Record<string, unknown>;
const NOW = Date.parse("2026-11-11T12:00:00.000Z");
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();

/** Query-builder double that really applies eq / gte / lt / not-is-null / order / limit, and records every call. */
function fakeAdmin(tables: Record<string, Row[]>, failWith?: "error" | "throw") {
  const calls: string[] = [];
  const from = (name: string) => {
    if (failWith === "throw") throw new Error("boom");
    const filters: Array<(r: Row) => boolean> = [];
    const ord: { col?: string; asc: boolean } = { asc: true };
    let lim = Infinity;
    const b: Record<string, unknown> = {};
    const rec = (label: string, fn: (...args: any[]) => void) => (...args: unknown[]) => {
      calls.push(label);
      fn(...args);
      return b;
    };
    b.select = rec("select", () => {});
    b.eq = rec("eq", (c: string, v: unknown) => {
      filters.push((r) => r[c] === v);
    });
    b.gte = rec("gte", (c: string, v: string) => {
      filters.push((r) => String(r[c]) >= v);
    });
    b.lt = rec("lt", (c: string, v: string) => {
      filters.push((r) => String(r[c]) < v);
    });
    b.not = rec("not", (c: string, _op: string, v: unknown) => {
      filters.push((r) => r[c] !== v);
    });
    b.order = rec("order", (col: string, o: { ascending: boolean }) => {
      ord.col = col;
      ord.asc = o.ascending;
    });
    b.limit = rec("limit", (n: number) => {
      lim = n;
    });
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      if (failWith === "error") return Promise.resolve({ data: null, error: { message: "x" } }).then(res, rej);
      let rows = (tables[name] ?? []).filter((r) => filters.every((f) => f(r)));
      const col = ord.col;
      if (col) rows = [...rows].sort((a, c) => (String(a[col]) < String(c[col]) ? -1 : 1) * (ord.asc ? 1 : -1));
      return Promise.resolve({ data: rows.slice(0, lim), error: null }).then(res, rej);
    };
    return b;
  };
  return { admin: { from } as unknown as SupabaseClient<Database>, calls };
}

const ev = (error: string | null, minAgo: number, orderId?: string, source = "doku"): Row => ({
  source_system: source,
  error,
  received_at: iso(minAgo),
  payload: { orderId: orderId ?? null, secret: "must-never-surface" },
});

describe("getDokuWebhookHealth (P0-B1)", () => {
  it("empty -> zeros, no oldest, not truncated", async () => {
    const { admin } = fakeAdmin({ prompter_webhook_events: [] });
    expect(await getDokuWebhookHealth(admin, NOW)).toEqual({
      ok: true, unknown: 0, verificationFailed: 0, notPaid: 0, repeatedTransactions: 0, oldestAt: null, truncated: false,
    });
  });

  it("counts only doku events inside 24h with the three marker families, and reports the oldest", async () => {
    const { admin } = fakeAdmin({
      prompter_webhook_events: [
        ev("UNKNOWN_STATUS:FOO/-/-", 30),
        ev("VERIFIED_STATUS_UNKNOWN", 60),
        ev("GATEWAY_VERIFICATION_FAILED:CURRENCY_MISSING", 120),
        ev("GATEWAY_VERIFICATION_FAILED", 90),
        ev("VERIFIED_STATUS_NOT_PAID", 10),
        ev("NEEDS_REVIEW", 5),
        ev("ALARM_REFUND", 5),
        ev(null, 5),
        ev("UNKNOWN_STATUS:OLD", 25 * 60), // outside the window
        ev("VERIFIED_STATUS_UNKNOWN", 20, undefined, "midtrans"), // other source
      ],
    });
    const h = await getDokuWebhookHealth(admin, NOW);
    expect(h).toMatchObject({ ok: true, unknown: 2, verificationFailed: 2, notPaid: 1, truncated: false });
    expect(h.ok && h.oldestAt).toBe(iso(120));
  });

  it("flags transactions with >= 3 unknown / failed-verification deliveries (NOT_PAID does not count)", async () => {
    const A = "11111111-1111-4111-8111-111111111111";
    const B = "22222222-2222-4222-8222-222222222222";
    const { admin } = fakeAdmin({
      prompter_webhook_events: [
        ev("GATEWAY_VERIFICATION_FAILED", 10, A), ev("UNKNOWN_STATUS:X", 20, A), ev("VERIFIED_STATUS_UNKNOWN", 30, A),
        ev("GATEWAY_VERIFICATION_FAILED", 10, B), ev("VERIFIED_STATUS_NOT_PAID", 20, B), ev("VERIFIED_STATUS_NOT_PAID", 30, B),
      ],
    });
    const h = await getDokuWebhookHealth(admin, NOW);
    expect(h).toMatchObject({ ok: true, repeatedTransactions: 1 });
  });

  it("never exposes payload or any free text", async () => {
    const { admin } = fakeAdmin({ prompter_webhook_events: [ev("UNKNOWN_STATUS:FOO", 5, "11111111-1111-4111-8111-111111111111")] });
    expect(JSON.stringify(await getDokuWebhookHealth(admin, NOW))).not.toMatch(/must-never-surface|FOO|payload/);
  });

  it("marks the result truncated at the row ceiling", async () => {
    const rows = Array.from({ length: HEALTH_MAX_ROWS + 5 }, () => ev("UNKNOWN_STATUS:X", 5));
    const { admin } = fakeAdmin({ prompter_webhook_events: rows });
    expect(await getDokuWebhookHealth(admin, NOW)).toMatchObject({ ok: true, unknown: HEALTH_MAX_ROWS, truncated: true });
  });

  it("a read failure or a throw yields ok:false, never an exception", async () => {
    expect(await getDokuWebhookHealth(fakeAdmin({}, "error").admin, NOW)).toEqual({ ok: false });
    expect(await getDokuWebhookHealth(fakeAdmin({}, "throw").admin, NOW)).toEqual({ ok: false });
  });

  it("is read-only: only select-style builder calls are made", async () => {
    const { admin, calls } = fakeAdmin({ prompter_webhook_events: [ev("UNKNOWN_STATUS:X", 5)] });
    await getDokuWebhookHealth(admin, NOW);
    expect(calls.every((c) => ["select", "eq", "gte", "not", "order", "limit"].includes(c))).toBe(true);
  });
});

describe("listRecheckCandidates", () => {
  const T = (id: string, over: Row = {}): Row => ({ id, tenant_id: "t", provider: "doku", status: "PENDING", amount: 1, currency: "IDR", plan: "PRO", created_at: iso(30), ...over });
  it("returns only doku PENDING rows older than 10 minutes, oldest first", async () => {
    const { admin } = fakeAdmin({
      prompter_payment_transactions: [
        T("old", { created_at: iso(120) }),
        T("mid", { created_at: iso(30) }),
        T("young", { created_at: iso(3) }),
        T("paid", { status: "PAID" }),
        T("midtrans", { provider: "midtrans" }),
      ],
    });
    const rows = await listRecheckCandidates(admin, NOW);
    expect(rows?.map((r) => r.id)).toEqual(["old", "mid"]);
  });
  it("null on failure", async () => {
    expect(await listRecheckCandidates(fakeAdmin({}, "error").admin, NOW)).toBeNull();
    expect(await listRecheckCandidates(fakeAdmin({}, "throw").admin, NOW)).toBeNull();
  });
});
