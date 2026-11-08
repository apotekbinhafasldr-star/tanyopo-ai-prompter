// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

const { settleMock } = vi.hoisted(() => ({ settleMock: vi.fn() }));
vi.mock("@/services/payment-verification", async () => {
  const actual = await vi.importActual<typeof import("@/services/payment-verification")>("@/services/payment-verification");
  return { ...actual, verifyAndSettle: settleMock };
});

import { SWEEP_MAX_PER_RUN, SWEEP_MIN_AGE_MS, SWEEP_TIME_BUDGET_MS, sweepPendingPayments } from "@/services/payment-sweeper";
import type { PaymentProvider } from "@/lib/billing/payment-provider";

const NOW = Date.parse("2026-11-07T10:00:00.000Z");
const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const ID3 = "33333333-3333-4333-8333-333333333333";

function fakeAdmin(rows: Array<{ id: string }> | null, error: unknown = null) {
  const calls: Array<[string, ...unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "lt", "order", "limit"]) {
    chain[m] = (...args: unknown[]) => {
      calls.push([m, ...args]);
      return m === "limit" ? Promise.resolve({ data: rows, error }) : chain;
    };
  }
  const from = vi.fn((table: string) => {
    calls.push(["from", table]);
    return chain;
  });
  return { admin: { from } as never, calls, from };
}

function provider(over: Partial<{ configured: boolean; verifies: boolean }> = {}): PaymentProvider {
  const { configured = true, verifies = true } = over;
  const p = {
    name: "midtrans",
    isConfigured: () => configured,
  } as unknown as Record<string, unknown>;
  if (verifies) p.getVerifiedPayment = vi.fn();
  return p as unknown as PaymentProvider;
}

beforeEach(() => settleMock.mockReset());

describe("sweepPendingPayments — C2", () => {
  it("fails closed without touching the database when the provider is not configured", async () => {
    const { admin, from } = fakeAdmin([{ id: ID1 }]);
    expect(await sweepPendingPayments(admin, provider({ configured: false }))).toEqual({ status: "not_configured" });
    expect(from).not.toHaveBeenCalled();
    expect(settleMock).not.toHaveBeenCalled();
  });

  it("fails closed for a provider that cannot be verified server-side", async () => {
    const { admin, from } = fakeAdmin([{ id: ID1 }]);
    expect(await sweepPendingPayments(admin, provider({ verifies: false }))).toEqual({ status: "not_configured" });
    expect(from).not.toHaveBeenCalled();
  });

  it("selects only this provider's PENDING rows older than 10 minutes, oldest first, bounded, and never writes", async () => {
    const { admin, calls } = fakeAdmin([]);
    await sweepPendingPayments(admin, provider(), { now: () => NOW });
    expect(calls).toContainEqual(["from", "prompter_payment_transactions"]);
    expect(calls).toContainEqual(["eq", "provider", "midtrans"]);
    expect(calls).toContainEqual(["eq", "status", "PENDING"]);
    expect(calls).toContainEqual(["lt", "created_at", new Date(NOW - SWEEP_MIN_AGE_MS).toISOString()]);
    expect(calls).toContainEqual(["order", "created_at", { ascending: true }]);
    expect(calls).toContainEqual(["limit", SWEEP_MAX_PER_RUN]);
    const writes = new Set(["insert", "update", "upsert", "delete", "rpc"]);
    expect(calls.filter((c) => writes.has(c[0]))).toEqual([]);
  });

  it("cannot be configured to look at younger rows or to exceed the per-run ceiling", async () => {
    const { admin, calls } = fakeAdmin([]);
    await sweepPendingPayments(admin, provider(), { now: () => NOW, minAgeMs: 1000, limit: 5000 });
    expect(calls).toContainEqual(["lt", "created_at", new Date(NOW - SWEEP_MIN_AGE_MS).toISOString()]);
    expect(calls).toContainEqual(["limit", SWEEP_MAX_PER_RUN]);
  });

  it("settles each candidate through verifyAndSettle with no webhook event id and tallies the outcomes", async () => {
    const { admin } = fakeAdmin([{ id: ID1 }, { id: ID2 }, { id: ID3 }]);
    const p = provider();
    settleMock
      .mockResolvedValueOnce({ kind: "APPLIED", reason: "APPLIED" })
      .mockResolvedValueOnce({ kind: "NOT_PAID", status: "EXPIRED", closed: true })
      .mockResolvedValueOnce({ kind: "NEEDS_REVIEW" });
    const result = await sweepPendingPayments(admin, p, { now: () => NOW });
    expect(settleMock.mock.calls.map((c) => [c[2], c[3]])).toEqual([
      [ID1, { eventId: null }],
      [ID2, { eventId: null }],
      [ID3, { eventId: null }],
    ]);
    expect(settleMock.mock.calls[0][1]).toBe(p);
    expect(result).toEqual({
      status: "ok",
      examined: 3,
      applied: 1,
      closed: 1,
      still_pending: 0,
      needs_attention: 1,
      stopped_early: false,
    });
  });

  it("counts a still-pending or unverifiable answer as still pending (nothing is closed on a gateway failure)", async () => {
    const { admin } = fakeAdmin([{ id: ID1 }, { id: ID2 }]);
    settleMock
      .mockResolvedValueOnce({ kind: "NOT_PAID", status: "PENDING", closed: false })
      .mockResolvedValueOnce({ kind: "UNVERIFIABLE", message: "GATEWAY_VERIFICATION_FAILED" });
    const result = await sweepPendingPayments(admin, provider(), { now: () => NOW });
    expect(result).toMatchObject({ status: "ok", examined: 2, still_pending: 2, applied: 0, closed: 0 });
  });

  it("stops starting new gateway calls once the time budget is spent", async () => {
    const { admin } = fakeAdmin([{ id: ID1 }, { id: ID2 }]);
    let t = NOW;
    settleMock.mockImplementation(async () => {
      t += SWEEP_TIME_BUDGET_MS; // the first call consumes the whole budget
      return { kind: "NOT_PAID", status: "PENDING", closed: false };
    });
    const result = await sweepPendingPayments(admin, provider(), { now: () => t });
    expect(settleMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "ok", examined: 1, stopped_early: true });
  });

  it("reports a failed listing as an error without settling anything", async () => {
    const { admin } = fakeAdmin(null, { message: "boom" });
    expect(await sweepPendingPayments(admin, provider(), { now: () => NOW })).toEqual({ status: "error", code: "LIST_FAILED" });
    expect(settleMock).not.toHaveBeenCalled();
  });
});
