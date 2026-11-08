// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { serverEnvMock } = vi.hoisted(() => ({
  serverEnvMock: {
    payment: {
      providerName: "midtrans" as string | undefined,
      apiKey: undefined as string | undefined,
      webhookSecret: undefined as string | undefined,
    },
  },
}));
vi.mock("@/lib/env", () => ({ serverEnv: serverEnvMock }));

import {
  MidtransPaymentProvider,
  computeMidtransSignature,
  resolveMidtransMode,
} from "@/lib/billing/providers/midtrans-payment-provider";

const SANDBOX_KEY = "SB-Mid-server-TESTKEY123";
const LIVE_KEY = "Mid-server-TESTKEY456";
const ORDER = "11111111-1111-4111-8111-111111111111";

const INPUT = {
  tenantId: "tenant-1",
  plan: "PRO" as const,
  amountIDR: 99000,
  internalTransactionId: ORDER,
  successUrl: "https://app.example/billing?checkout=success&txn=x",
  cancelUrl: "https://app.example/billing?checkout=cancelled&txn=x",
};

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }) {
  return new Response(JSON.stringify(body), init);
}

const fetchMock = vi.fn();
let provider: MidtransPaymentProvider;

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("PAYMENT_LIVE_ENABLED", "");
  vi.stubEnv("PAYMENT_PROVIDER_ENV", "");
  serverEnvMock.payment.apiKey = SANDBOX_KEY;
  provider = new MidtransPaymentProvider();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("resolveMidtransMode — C1 fail-closed mode selection", () => {
  it("defaults to sandbox when no switch is set (unchanged previous behaviour)", () => {
    expect(resolveMidtransMode(undefined, undefined)?.mode).toBe("sandbox");
    expect(resolveMidtransMode("", "")?.mode).toBe("sandbox");
    expect(resolveMidtransMode("", "sandbox")?.mode).toBe("sandbox");
  });
  it("is live only when the flag is exactly 'true' AND the environment is 'production'", () => {
    expect(resolveMidtransMode("true", "production")?.mode).toBe("live");
  });
  it("returns no mode (fail-closed) for every inconsistent or unrecognised combination", () => {
    for (const [flag, env] of [
      ["true", undefined],
      ["true", ""],
      ["true", "sandbox"],
      [undefined, "production"],
      ["", "production"],
      ["false", "production"],
      ["TRUE", "production"],
      ["1", "production"],
      ["yes", "production"],
      ["true", "Production"],
      [undefined, "staging"],
    ] as const) {
      expect(resolveMidtransMode(flag, env), `${flag}/${env}`).toBeNull();
    }
  });
});

describe("MidtransPaymentProvider.isConfigured — C1 key prefix follows the mode", () => {
  it("without the flag a production key is refused (unchanged)", () => {
    serverEnvMock.payment.apiKey = LIVE_KEY;
    expect(provider.isConfigured()).toBe(false);
  });
  it("without the flag a sandbox key is accepted (unchanged)", () => {
    expect(provider.isConfigured()).toBe(true);
  });
  it("production env alone (flag absent) makes even a sandbox key unconfigured", () => {
    vi.stubEnv("PAYMENT_PROVIDER_ENV", "production");
    expect(provider.isConfigured()).toBe(false);
  });
  it("flag alone (no production env) is unconfigured for both key kinds", () => {
    vi.stubEnv("PAYMENT_LIVE_ENABLED", "true");
    expect(provider.isConfigured()).toBe(false);
    serverEnvMock.payment.apiKey = LIVE_KEY;
    expect(provider.isConfigured()).toBe(false);
  });
  it("live mode accepts a production key", () => {
    vi.stubEnv("PAYMENT_LIVE_ENABLED", "true");
    vi.stubEnv("PAYMENT_PROVIDER_ENV", "production");
    serverEnvMock.payment.apiKey = LIVE_KEY;
    expect(provider.isConfigured()).toBe(true);
  });
  it("live mode REJECTS a sandbox key (mismatch)", () => {
    vi.stubEnv("PAYMENT_LIVE_ENABLED", "true");
    vi.stubEnv("PAYMENT_PROVIDER_ENV", "production");
    serverEnvMock.payment.apiKey = SANDBOX_KEY;
    expect(provider.isConfigured()).toBe(false);
  });
  it("a missing key is never configured in any mode", () => {
    serverEnvMock.payment.apiKey = undefined;
    expect(provider.isConfigured()).toBe(false);
    vi.stubEnv("PAYMENT_LIVE_ENABLED", "true");
    vi.stubEnv("PAYMENT_PROVIDER_ENV", "production");
    expect(provider.isConfigured()).toBe(false);
  });
});

describe("MidtransPaymentProvider — C1 hosts, C4 expiry, unchanged signature", () => {
  it("sandbox mode calls only sandbox hosts and sends an explicit 24-hour Snap expiry", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ token: "snap-token", redirect_url: "https://app.sandbox.midtrans.com/snap/v4/redirection/abc" }),
    );
    await provider.createCheckoutSession(INPUT);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://app.sandbox.midtrans.com/snap/v1/transactions");
    expect(JSON.parse(init.body).expiry).toEqual({ unit: "hours", duration: 24 });
  });

  it("live mode calls only the production hosts", async () => {
    vi.stubEnv("PAYMENT_LIVE_ENABLED", "true");
    vi.stubEnv("PAYMENT_PROVIDER_ENV", "production");
    serverEnvMock.payment.apiKey = LIVE_KEY;
    fetchMock.mockResolvedValue(
      jsonResponse({ token: "snap-token", redirect_url: "https://app.midtrans.com/snap/v4/redirection/abc" }),
    );
    await provider.createCheckoutSession(INPUT);
    expect(fetchMock.mock.calls[0][0]).toBe("https://app.midtrans.com/snap/v1/transactions");

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      jsonResponse({
        status_code: "201",
        transaction_status: "pending",
        order_id: ORDER,
        gross_amount: "99000.00",
        currency: "IDR",
        transaction_id: "mid-tx-1",
      }),
    );
    await provider.getVerifiedPayment(ORDER);
    expect(fetchMock.mock.calls[0][0]).toBe(`https://api.midtrans.com/v2/${ORDER}/status`);
  });

  it("an inconsistent configuration never reaches the network", async () => {
    vi.stubEnv("PAYMENT_LIVE_ENABLED", "true"); // no production env
    serverEnvMock.payment.apiKey = LIVE_KEY;
    await expect(
      provider.createCheckoutSession(INPUT),
    ).rejects.toThrow();
    await expect(provider.getVerifiedPayment(ORDER)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("webhook signature verification is identical in both modes (SHA512 of order_id+status_code+gross_amount+key)", () => {
    const build = (key: string) => {
      const base: Record<string, unknown> = {
        order_id: ORDER,
        status_code: "200",
        gross_amount: "99000.00",
        transaction_id: "mid-tx-1",
        transaction_status: "settlement",
      };
      base.signature_key = computeMidtransSignature(ORDER, "200", "99000.00", key);
      return JSON.stringify(base);
    };
    expect(provider.verifyWebhookSignature(build(SANDBOX_KEY), null)).toBe(true);
    expect(provider.verifyWebhookSignature(build(LIVE_KEY), null)).toBe(false);

    vi.stubEnv("PAYMENT_LIVE_ENABLED", "true");
    vi.stubEnv("PAYMENT_PROVIDER_ENV", "production");
    serverEnvMock.payment.apiKey = LIVE_KEY;
    expect(provider.verifyWebhookSignature(build(LIVE_KEY), null)).toBe(true);
    expect(provider.verifyWebhookSignature(build(SANDBOX_KEY), null)).toBe(false);
  });
});
