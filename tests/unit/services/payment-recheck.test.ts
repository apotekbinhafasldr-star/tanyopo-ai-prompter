// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { PaymentProviderConfigError, type PaymentProvider, type VerifiedPayment } from "@/lib/billing/payment-provider";
import { recheckPendingPayment } from "@/services/payment-recheck";
import { TENANT_A, TENANT_B, TXN_A, TXN_B, addTxn, createFakeDb, type FakeDb } from "../support/payment-fakes";

const OP = "99999999-9999-4999-8999-999999999999";
const NOW = Date.parse("2026-11-11T12:00:00.000Z");
const OLD = new Date(NOW - 30 * 60_000).toISOString();
const YOUNG = new Date(NOW - 3 * 60_000).toISOString();

let db: FakeDb;
const admin = () => db as unknown as SupabaseClient<Database>;
const dokuTxn = (over: Record<string, unknown> = {}) => addTxn(db, { provider: "doku", created_at: OLD, ...over });

function paid(over: Partial<VerifiedPayment> = {}, id = TXN_A): VerifiedPayment {
  return { orderId: id, gatewayTransactionId: "orig-req-1", status: "PAID", amount: 99000, currency: "IDR", rawStatus: "SUCCESS/-/-", ...over };
}
function fakeProvider(answer: (id: string) => VerifiedPayment | Error, over: { name?: string; configured?: boolean; verifies?: boolean } = {}) {
  const get = vi.fn(async (id: string) => {
    const a = answer(id);
    if (a instanceof Error) throw a;
    return a;
  });
  const p: Record<string, unknown> = { name: over.name ?? "doku", isConfigured: () => over.configured ?? true };
  if (over.verifies !== false) p.getVerifiedPayment = get;
  return { provider: p as unknown as PaymentProvider, get };
}

beforeEach(() => {
  db = createFakeDb();
});

describe("recheckPendingPayment (P0-C)", () => {
  it("PAID from the gateway activates exactly one period and writes request + result audit rows", async () => {
    dokuTxn();
    const { provider, get } = fakeProvider(() => paid());
    expect(await recheckPendingPayment(admin(), provider, TXN_A, OP, NOW)).toEqual({ ok: true, code: "applied" });
    expect(db.txns[0].status).toBe("PAID");
    expect(db.periods).toEqual({ [TENANT_A]: 1 });
    expect(get).toHaveBeenCalledTimes(1);
    expect(db.rpcCalls).toHaveLength(1);
    expect(db.rpcCalls[0].args).toMatchObject({ p_transaction_id: TXN_A, p_verified_amount: 99000, p_verified_currency: "IDR", p_provider_event_id: "status-api:orig-req-1" });
    expect(db.audit.map((a) => a.action)).toEqual(["payment.operator_recheck_requested", "payment.operator_recheck_result"]);
    expect(db.audit[0]).toMatchObject({ tenant_id: TENANT_A, actor_user_id: OP, resource_id: TXN_A });
    expect(db.audit[1].context).toEqual({ result: "applied" });
  });

  it("is idempotent: a second click finds the transaction no longer PENDING, asks nobody and adds no period", async () => {
    dokuTxn();
    const { provider, get } = fakeProvider(() => paid());
    await recheckPendingPayment(admin(), provider, TXN_A, OP, NOW);
    expect(await recheckPendingPayment(admin(), provider, TXN_A, OP, NOW)).toEqual({ ok: false, code: "not_eligible" });
    expect(get).toHaveBeenCalledTimes(1);
    expect(db.periods).toEqual({ [TENANT_A]: 1 });
    expect(db.rpcCalls).toHaveLength(1);
  });

  it("tenant isolation: re-verifying one tenant's transaction never touches another tenant's PENDING transaction or period", async () => {
    dokuTxn();
    dokuTxn({ id: TXN_B, tenant_id: TENANT_B });
    const { provider, get } = fakeProvider((id) => paid({}, id));
    await recheckPendingPayment(admin(), provider, TXN_A, OP, NOW);
    expect(get).toHaveBeenCalledWith(TXN_A);
    expect(get).not.toHaveBeenCalledWith(TXN_B);
    expect(db.txns.find((t) => t.id === TXN_B)?.status).toBe("PENDING");
    expect(db.periods).toEqual({ [TENANT_A]: 1 });
    expect(db.audit.every((a) => a.tenant_id === TENANT_A)).toBe(true);
  });

  it.each([
    ["too young (<10 min)", { created_at: YOUNG }],
    ["not PENDING (PAID)", { status: "PAID" }],
    ["not PENDING (REVIEW)", { status: "REVIEW" }],
    ["not PENDING (EXPIRED)", { status: "EXPIRED" }],
    ["another provider", { provider: "midtrans" }],
    ["no created_at", { created_at: undefined }],
  ])("not eligible: %s -> the gateway is never asked and nothing changes", async (_label, over) => {
    dokuTxn(over);
    const before = JSON.stringify(db.txns);
    const { provider, get } = fakeProvider(() => paid());
    expect(await recheckPendingPayment(admin(), provider, TXN_A, OP, NOW)).toEqual({ ok: false, code: "not_eligible" });
    expect(get).not.toHaveBeenCalled();
    expect(db.rpcCalls).toEqual([]);
    expect(db.audit).toEqual([]);
    expect(JSON.stringify(db.txns)).toBe(before);
  });

  it("an unknown transaction id is not eligible", async () => {
    const { provider, get } = fakeProvider(() => paid());
    expect(await recheckPendingPayment(admin(), provider, TXN_B, OP, NOW)).toEqual({ ok: false, code: "not_eligible" });
    expect(get).not.toHaveBeenCalled();
  });

  it("rejects malformed ids before any database access", async () => {
    const { provider, get } = fakeProvider(() => paid());
    const from = vi.spyOn(db, "from");
    for (const bad of ["", "x", "1; drop table", null, undefined, 5, {}]) {
      expect(await recheckPendingPayment(admin(), provider, bad, OP, NOW)).toEqual({ ok: false, code: "invalid" });
    }
    expect(await recheckPendingPayment(admin(), provider, TXN_A, "not-a-uuid", NOW)).toEqual({ ok: false, code: "invalid" });
    expect(from).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it.each([
    ["midtrans provider", { name: "midtrans" }],
    ["unconfigured doku (fail-closed)", { configured: false }],
    ["provider that cannot verify server-side", { verifies: false }],
  ])("%s -> not_configured, database untouched", async (_label, over) => {
    dokuTxn();
    const { provider } = fakeProvider(() => paid(), over);
    const from = vi.spyOn(db, "from");
    expect(await recheckPendingPayment(admin(), provider, TXN_A, OP, NOW)).toEqual({ ok: false, code: "not_configured" });
    expect(from).not.toHaveBeenCalled();
    expect(db.txns[0].status).toBe("PENDING");
  });

  it("gateway PENDING -> still_pending, nothing activated or closed", async () => {
    dokuTxn();
    const { provider } = fakeProvider(() => paid({ status: "PENDING", rawStatus: "PENDING/-/-" }));
    expect(await recheckPendingPayment(admin(), provider, TXN_A, OP, NOW)).toEqual({ ok: true, code: "still_pending" });
    expect(db.txns[0].status).toBe("PENDING");
    expect(db.rpcCalls).toEqual([]);
  });

  it("gateway UNKNOWN -> unknown, nothing activated or closed", async () => {
    dokuTxn();
    const { provider } = fakeProvider(() => paid({ status: "UNKNOWN", rawStatus: "SOMETHING_NEW/-/-" }));
    expect(await recheckPendingPayment(admin(), provider, TXN_A, OP, NOW)).toEqual({ ok: true, code: "unknown" });
    expect(db.txns[0].status).toBe("PENDING");
    expect(db.periods).toEqual({});
  });

  it("gateway EXPIRED -> closed (only the PENDING invoice, no activation)", async () => {
    dokuTxn();
    const { provider } = fakeProvider(() => paid({ status: "EXPIRED", rawStatus: "EXPIRED/-/-" }));
    expect(await recheckPendingPayment(admin(), provider, TXN_A, OP, NOW)).toEqual({ ok: true, code: "closed" });
    expect(db.txns[0].status).toBe("EXPIRED");
    expect(db.periods).toEqual({});
  });

  it("a wrong amount from the gateway goes to REVIEW, never activates", async () => {
    dokuTxn();
    const { provider } = fakeProvider(() => paid({ amount: 1 }));
    expect(await recheckPendingPayment(admin(), provider, TXN_A, OP, NOW)).toEqual({ ok: true, code: "review" });
    expect(db.txns[0].status).toBe("REVIEW");
    expect(db.periods).toEqual({});
  });

  it("a gateway that cannot be verified (e.g. currency missing) fails closed -> unverifiable, nothing changes", async () => {
    dokuTxn();
    const { provider } = fakeProvider(() => new PaymentProviderConfigError("doku", "x", "CURRENCY_MISSING"));
    expect(await recheckPendingPayment(admin(), provider, TXN_A, OP, NOW)).toEqual({ ok: false, code: "unverifiable" });
    expect(db.txns[0].status).toBe("PENDING");
    expect(db.periods).toEqual({});
    expect(db.audit.at(-1)?.context).toEqual({ result: "unverifiable" });
  });

  it("the gateway answering about a different order is rejected (no activation)", async () => {
    dokuTxn();
    const { provider } = fakeProvider(() => paid({}, TXN_B));
    expect(await recheckPendingPayment(admin(), provider, TXN_A, OP, NOW)).toEqual({ ok: false, code: "unverifiable" });
    expect(db.periods).toEqual({});
  });

  it("an audit write failure never blocks or changes the settlement result", async () => {
    dokuTxn();
    const realFrom = db.from;
    db.from = (name: string) => {
      if (name === "prompter_audit_logs") throw new Error("audit down");
      return realFrom(name);
    };
    const { provider } = fakeProvider(() => paid());
    expect(await recheckPendingPayment(admin(), provider, TXN_A, OP, NOW)).toEqual({ ok: true, code: "applied" });
    expect(db.periods).toEqual({ [TENANT_A]: 1 });
  });

  it("the function signature takes no amount/status from the caller: only ids", () => {
    expect(recheckPendingPayment.length).toBeLessThanOrEqual(5);
  });
});
