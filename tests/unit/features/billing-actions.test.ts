import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

const { requireSessionContextMock } = vi.hoisted(() => ({
  requireSessionContextMock: vi.fn(async () => ({ tenantId: "t1", userId: "u1", role: "owner" })),
}));
vi.mock("@/services/session", () => ({ requireSessionContext: requireSessionContextMock }));

const { startCheckoutMock } = vi.hoisted(() => ({ startCheckoutMock: vi.fn() }));
vi.mock("@/services/checkout", () => ({ startCheckout: startCheckoutMock }));

vi.mock("@/services/billing", () => ({ changePlan: vi.fn(async () => ({ error: null })) }));

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => currentSupabase) }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentSupabase: any;

import { startCheckoutAction, scheduleCancellationAction } from "@/features/billing/actions";

describe("startCheckoutAction — Batch B10 Bagian G/I", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    startCheckoutMock.mockReset();
    requireSessionContextMock.mockResolvedValue({ tenantId: "t1", userId: "u1", role: "owner" });
    currentSupabase = {};
  });

  it("rejects a non-owner without ever calling startCheckout", async () => {
    requireSessionContextMock.mockResolvedValue({ tenantId: "t1", userId: "u1", role: "marketing" });
    const fd = new FormData();
    fd.set("plan", "GROWTH");

    const result = await startCheckoutAction({ error: null }, fd);

    expect(result.error).toMatch(/owner/i);
    expect(startCheckoutMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid plan string before calling startCheckout", async () => {
    const fd = new FormData();
    fd.set("plan", "NOT_A_PLAN");

    const result = await startCheckoutAction({ error: null }, fd);

    expect(result.error).toMatch(/tidak valid/i);
    expect(startCheckoutMock).not.toHaveBeenCalled();
  });

  it("Bagian G.3 — never reads or forwards a client-supplied amount/price field, even if one is present in the form", async () => {
    startCheckoutMock.mockResolvedValue({ ok: true, checkoutUrl: "https://pay.example.com/x" });
    const fd = new FormData();
    fd.set("plan", "GROWTH");
    fd.set("amount", "1"); // an attacker-supplied price override attempt

    await expect(startCheckoutAction({ error: null }, fd)).rejects.toThrow("REDIRECT:https://pay.example.com/x");

    const callArgs = startCheckoutMock.mock.calls[0][1];
    expect(callArgs).not.toHaveProperty("amount");
    expect(callArgs).not.toHaveProperty("amountIDR");
  });

  it("redirects to the checkout URL on success", async () => {
    startCheckoutMock.mockResolvedValue({ ok: true, checkoutUrl: "https://pay.example.com/session/xyz" });
    const fd = new FormData();
    fd.set("plan", "STARTER");

    await expect(startCheckoutAction({ error: null }, fd)).rejects.toThrow("REDIRECT:https://pay.example.com/session/xyz");
  });

  it("surfaces a fail-closed error instead of redirecting when the provider isn't configured", async () => {
    startCheckoutMock.mockResolvedValue({ ok: false, error: "Pembayaran online sedang dipersiapkan." });
    const fd = new FormData();
    fd.set("plan", "STARTER");

    const result = await startCheckoutAction({ error: null }, fd);

    expect(result.error).toMatch(/dipersiapkan/i);
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

describe("scheduleCancellationAction — Batch B10 Bagian D", () => {
  beforeEach(() => {
    requireSessionContextMock.mockResolvedValue({ tenantId: "t1", userId: "u1", role: "owner" });
  });

  it("rejects a non-owner", async () => {
    requireSessionContextMock.mockResolvedValue({ tenantId: "t1", userId: "u1", role: "marketing" });
    const result = await scheduleCancellationAction(true);
    expect(result.error).toMatch(/owner/i);
  });

  it("calls fn_schedule_cancellation with the requested flag and logs an audit entry on success", async () => {
    const rpc = vi.fn(async () => ({ data: [{ allowed: true, reason: null }], error: null }));
    const auditInsert = vi.fn(async () => ({ error: null }));
    currentSupabase = { rpc, from: vi.fn(() => ({ insert: auditInsert })) };

    const result = await scheduleCancellationAction(true);

    expect(rpc).toHaveBeenCalledWith("fn_schedule_cancellation", { p_cancel: true });
    expect(result.error).toBeNull();
    expect(auditInsert).toHaveBeenCalled();
  });

  it("surfaces an error when the RPC rejects the request", async () => {
    const rpc = vi.fn(async () => ({ data: [{ allowed: false, reason: "NO_SUBSCRIPTION" }], error: null }));
    currentSupabase = { rpc, from: vi.fn(() => ({ insert: vi.fn() })) };

    const result = await scheduleCancellationAction(true);

    expect(result.error).not.toBeNull();
  });
});
