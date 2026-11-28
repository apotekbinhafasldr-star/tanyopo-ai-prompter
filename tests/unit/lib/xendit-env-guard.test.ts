// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { serverEnvMock, publicEnvMock } = vi.hoisted(() => ({
  serverEnvMock: {
    supabaseSecretKey: undefined as string | undefined,
    payment: {
      providerName: "xendit" as string | undefined,
      apiKey: "xnd_development_abc123" as string | undefined,
      webhookSecret: "sandbox-callback-token" as string | undefined,
      sandboxDbRefs: "abcdefghij0123456789" as string | undefined,
    },
  },
  publicEnvMock: { supabaseUrl: "https://abcdefghij0123456789.supabase.co" },
}));
vi.mock("@/lib/env", () => ({ serverEnv: serverEnvMock, publicEnv: publicEnvMock }));

import { PRODUCTION_SUPABASE_REFS } from "@/lib/billing/providers/doku-sandbox-db-guard";
import { XenditPaymentProvider } from "@/lib/billing/providers/xendit-payment-provider";
import { PaymentProviderConfigError } from "@/lib/billing/payment-provider";

const PROD = PRODUCTION_SUPABASE_REFS[0];
const SANDBOX = "abcdefghij0123456789";
const ORDER = "11111111-1111-4111-8111-111111111111";
const fetchMock = vi.fn();
let provider: XenditPaymentProvider;

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), init);
}

const invoice = (over: Record<string, unknown> = {}) => ({
  id: "inv-abc",
  external_id: ORDER,
  status: "PAID",
  amount: 99000,
  paid_amount: 99000,
  currency: "IDR",
  ...over,
});

beforeEach(() => {
  serverEnvMock.payment.apiKey = "xnd_development_abc123";
  serverEnvMock.payment.webhookSecret = "sandbox-callback-token";
  serverEnvMock.payment.sandboxDbRefs = SANDBOX;
  serverEnvMock.supabaseSecretKey = undefined;
  publicEnvMock.supabaseUrl = `https://${SANDBOX}.supabase.co`;
  provider = new XenditPaymentProvider();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("D3 phase A — Xendit sandbox adapter runs only against an allow-listed sandbox database", () => {
  it("C1: sandbox key on the production database is OFF and never reaches the network; allow-listed sandbox database is ON", async () => {
    publicEnvMock.supabaseUrl = `https://${PROD}.supabase.co`;
    expect(provider.isConfigured()).toBe(false);
    expect(provider.runtimeEnvironment()).toBeNull();
    expect(provider.verifyWebhookSignature("{}", "sandbox-callback-token")).toBe(false);
    await expect(provider.getVerifiedPayment(ORDER)).rejects.toBeInstanceOf(PaymentProviderConfigError);
    expect(fetchMock).not.toHaveBeenCalled();

    publicEnvMock.supabaseUrl = `https://${SANDBOX}.supabase.co`;
    expect(provider.isConfigured()).toBe(true);
    expect(provider.runtimeEnvironment()).toEqual({ env: "sandbox", dbRef: SANDBOX });
  });

  it("C1b: no allow-list keeps it OFF", () => {
    serverEnvMock.payment.sandboxDbRefs = undefined;
    expect(provider.isConfigured()).toBe(false);
  });

  it("C2: a production key is refused on any database, including the production one", () => {
    serverEnvMock.payment.apiKey = "xnd_production_realkey";
    for (const ref of [SANDBOX, PROD]) {
      publicEnvMock.supabaseUrl = `https://${ref}.supabase.co`;
      expect(provider.isConfigured()).toBe(false);
    }
  });
});

describe("D3 phase C — Xendit getVerifiedPayment (server-to-server, fail-closed)", () => {
  it("asks Xendit for the invoice by OUR transaction id with Basic auth and a timeout, and returns the verified PAID state", async () => {
    fetchMock.mockResolvedValue(jsonResponse([invoice()]));
    const verified = await provider.getVerifiedPayment(ORDER);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://api.xendit.co/v2/invoices?external_id=${ORDER}`);
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("xnd_development_abc123:").toString("base64")}`);
    expect(init.signal).toBeDefined();
    expect(verified).toMatchObject({ orderId: ORDER, gatewayTransactionId: "inv-abc", status: "PAID", amount: 99000, currency: "IDR", rawStatus: "PAID" });
    expect(verified.eventRef).toMatch(/^gw:[0-9a-f]{40}$/);
  });

  it("SETTLED counts as PAID; EXPIRED and PENDING keep their meaning; anything else is UNKNOWN (never PAID, never FAILED)", async () => {
    const cases: Array<[string, string]> = [["SETTLED", "PAID"], ["EXPIRED", "EXPIRED"], ["PENDING", "PENDING"], ["WEIRD", "UNKNOWN"], ["REFUNDED", "UNKNOWN"], ["paid", "UNKNOWN"]];
    for (const [raw, expected] of cases) {
      fetchMock.mockResolvedValue(jsonResponse([invoice({ status: raw })]));
      expect((await provider.getVerifiedPayment(ORDER)).status, raw).toBe(expected);
    }
  });

  it("C3: the amount comes from the gateway's paid_amount, not from a claim; a PAID answer without paid amount, IDR currency or invoice id is refused", async () => {
    fetchMock.mockResolvedValue(jsonResponse([invoice({ paid_amount: 1, amount: 99000 })]));
    expect((await provider.getVerifiedPayment(ORDER)).amount).toBe(1);

    const refusals: Array<[Record<string, unknown>, string]> = [
      [{ paid_amount: undefined }, "AMOUNT_MISSING"],
      [{ paid_amount: "99000" }, "AMOUNT_MISSING"],
      [{ paid_amount: -1 }, "AMOUNT_MISSING"],
      [{ currency: undefined }, "CURRENCY_MISSING"],
      [{ currency: "USD" }, "CURRENCY_NOT_IDR"],
      [{ id: undefined }, "REFERENCE_MISSING"],
      [{ status: undefined }, "STATUS_INCOMPLETE"],
    ];
    for (const [over, code] of refusals) {
      fetchMock.mockResolvedValue(jsonResponse([invoice(over)]));
      await expect(provider.getVerifiedPayment(ORDER), code).rejects.toMatchObject({ reasonCode: code });
    }
  });

  it("C3b: zero, several or foreign invoices are refused (ORDER_MISMATCH)", async () => {
    for (const body of [[], [invoice(), invoice({ id: "inv-2" })], [invoice({ external_id: "22222222-2222-4222-8222-222222222222" })], {}, "null"]) {
      fetchMock.mockResolvedValue(jsonResponse(body));
      await expect(provider.getVerifiedPayment(ORDER)).rejects.toMatchObject({ reasonCode: "ORDER_MISMATCH" });
    }
  });

  it("refuses timeouts, non-2xx, non-JSON, oversized answers and malformed order ids without activating anything", async () => {
    fetchMock.mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    await expect(provider.getVerifiedPayment(ORDER)).rejects.toMatchObject({ reasonCode: "GATEWAY_TIMEOUT" });
    fetchMock.mockRejectedValue(new Error("down"));
    await expect(provider.getVerifiedPayment(ORDER)).rejects.toMatchObject({ reasonCode: "GATEWAY_UNREACHABLE" });
    fetchMock.mockResolvedValue(jsonResponse("{}", { status: 500 }));
    await expect(provider.getVerifiedPayment(ORDER)).rejects.toMatchObject({ reasonCode: "GATEWAY_REJECTED" });
    fetchMock.mockResolvedValue(jsonResponse("<html>nope</html>"));
    await expect(provider.getVerifiedPayment(ORDER)).rejects.toMatchObject({ reasonCode: "RESPONSE_NOT_JSON" });
    fetchMock.mockResolvedValue(jsonResponse(`[${"1,".repeat(40_000)}1]`));
    await expect(provider.getVerifiedPayment(ORDER)).rejects.toMatchObject({ reasonCode: "RESPONSE_NOT_JSON" });
    fetchMock.mockClear();
    await expect(provider.getVerifiedPayment("../../x?y=1")).rejects.toMatchObject({ reasonCode: "ORDER_MISMATCH" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
