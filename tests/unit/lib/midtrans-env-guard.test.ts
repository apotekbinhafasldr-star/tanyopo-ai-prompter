// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { serverEnvMock, publicEnvMock } = vi.hoisted(() => ({
  serverEnvMock: {
    supabaseSecretKey: undefined as string | undefined,
    payment: {
      providerName: "midtrans" as string | undefined,
      apiKey: undefined as string | undefined,
      webhookSecret: undefined as string | undefined,
      sandboxDbRefs: undefined as string | undefined,
    },
  },
  publicEnvMock: { supabaseUrl: "" as string },
}));
vi.mock("@/lib/env", () => ({ serverEnv: serverEnvMock, publicEnv: publicEnvMock }));

import { PRODUCTION_SUPABASE_REFS } from "@/lib/billing/providers/doku-sandbox-db-guard";
import { MidtransPaymentProvider, computeMidtransSignature, resolveMidtransMode } from "@/lib/billing/providers/midtrans-payment-provider";

const PROD = PRODUCTION_SUPABASE_REFS[0];
const SANDBOX = "abcdefghij0123456789";
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

const fetchMock = vi.fn();
let provider: MidtransPaymentProvider;
const sandboxDb = () => {
  publicEnvMock.supabaseUrl = `https://${SANDBOX}.supabase.co`;
  serverEnvMock.payment.sandboxDbRefs = SANDBOX;
};
const productionDb = () => {
  publicEnvMock.supabaseUrl = `https://${PROD}.supabase.co`;
  serverEnvMock.payment.sandboxDbRefs = SANDBOX;
};
const liveSwitches = () => {
  vi.stubEnv("PAYMENT_LIVE_ENABLED", "true");
  vi.stubEnv("PAYMENT_PROVIDER_ENV", "production");
};

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("PAYMENT_LIVE_ENABLED", "");
  vi.stubEnv("PAYMENT_PROVIDER_ENV", "");
  serverEnvMock.payment.apiKey = SANDBOX_KEY;
  serverEnvMock.supabaseSecretKey = undefined;
  sandboxDb();
  provider = new MidtransPaymentProvider();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("D3 — Midtrans adapter runs only against a database that matches its mode", () => {
  it("B1: a sandbox key on the PRODUCTION database (default flags) is unconfigured and never reaches the network", async () => {
    productionDb();
    expect(provider.isConfigured()).toBe(false);
    expect(provider.runtimeEnvironment()).toBeNull();
    await expect(provider.createCheckoutSession(INPUT)).rejects.toThrow();
    await expect(provider.getVerifiedPayment(ORDER)).rejects.toThrow();
    const body = JSON.stringify({
      order_id: ORDER,
      status_code: "200",
      gross_amount: "99000.00",
      signature_key: computeMidtransSignature(ORDER, "200", "99000.00", SANDBOX_KEY),
    });
    expect(provider.verifyWebhookSignature(body, null)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("B1b: no allow-list at all keeps the sandbox adapter OFF (the previous implicit 'works anywhere' is gone)", () => {
    serverEnvMock.payment.sandboxDbRefs = undefined;
    expect(provider.isConfigured()).toBe(false);
    serverEnvMock.payment.sandboxDbRefs = "";
    expect(provider.isConfigured()).toBe(false);
  });

  it("B2: a sandbox key on an allow-listed sandbox database is configured and reports its environment", () => {
    expect(provider.isConfigured()).toBe(true);
    expect(provider.runtimeEnvironment()).toEqual({ env: "sandbox", dbRef: SANDBOX });
  });

  it("B2b: a mis-wired service key (JWT of another project) switches the adapter OFF", () => {
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    serverEnvMock.supabaseSecretKey = `${enc({ alg: "HS256" })}.${enc({ role: "service_role", ref: PROD })}.sig`;
    expect(provider.isConfigured()).toBe(false);
  });

  it("B3: live switches + live key on a SANDBOX database are refused", () => {
    liveSwitches();
    serverEnvMock.payment.apiKey = LIVE_KEY;
    sandboxDb();
    expect(provider.isConfigured()).toBe(false);
    expect(provider.runtimeEnvironment()).toBeNull();
  });

  it("B4: live switches + live key + production database is configured (logic proof only; the flag stays OFF in every real deploy)", () => {
    liveSwitches();
    serverEnvMock.payment.apiKey = LIVE_KEY;
    productionDb();
    expect(provider.isConfigured()).toBe(true);
    expect(provider.runtimeEnvironment()).toEqual({ env: "live", dbRef: PROD });
  });

  it("B4b: live on a production database whose ref is also in the sandbox list is refused", () => {
    liveSwitches();
    serverEnvMock.payment.apiKey = LIVE_KEY;
    publicEnvMock.supabaseUrl = `https://${PROD}.supabase.co`;
    serverEnvMock.payment.sandboxDbRefs = `${SANDBOX},${PROD}`;
    expect(provider.isConfigured()).toBe(false);
  });

  it("B5: a live key in sandbox mode and a sandbox key in live mode stay refused whatever the database is", () => {
    serverEnvMock.payment.apiKey = LIVE_KEY;
    expect(provider.isConfigured()).toBe(false);
    liveSwitches();
    serverEnvMock.payment.apiKey = SANDBOX_KEY;
    productionDb();
    expect(provider.isConfigured()).toBe(false);
  });

  it("B6: the mode resolution itself is untouched (sandbox default, live only with BOTH switches)", () => {
    expect(resolveMidtransMode(undefined, undefined)?.mode).toBe("sandbox");
    expect(resolveMidtransMode("true", "production")?.mode).toBe("live");
    expect(resolveMidtransMode("true", "sandbox")).toBeNull();
  });
});
