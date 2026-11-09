// @vitest-environment node
import { createHash, createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { serverEnvMock } = vi.hoisted(() => ({
  serverEnvMock: {
    payment: {
      providerName: "doku" as string | undefined,
      apiKey: "dokusecretkey-123456" as string | undefined,
      clientId: "MCH-0001-1234567890" as string | undefined,
      webhookSecret: undefined as string | undefined,
    },
  },
}));
vi.mock("@/lib/env", () => ({ serverEnv: serverEnvMock }));

import {
  DOKU_INVOICE_NUMBER_LENGTH,
  DokuPaymentProvider,
  computeDokuDigest,
  computeDokuSignature,
  decodeDokuInvoiceNumber,
  encodeDokuInvoiceNumber,
  mapDokuStatus,
  resolveDokuConfig,
} from "@/lib/billing/providers/doku-payment-provider";
import { PaymentProviderConfigError } from "@/lib/billing/payment-provider";

const SECRET = "dokusecretkey-123456";
const CLIENT = "MCH-0001-1234567890";
const TXN = "11111111-1111-4111-8111-111111111111";
const INVOICE = encodeDokuInvoiceNumber(TXN);

/** Independent re-implementation of DOKU's documented algorithm — so the adapter is not graded against itself. */
function referenceSignature(lines: string[], secret = SECRET): string {
  return `HMACSHA256=${createHmac("sha256", secret).update(lines.join("\n")).digest("base64")}`;
}

const fetchMock = vi.fn();
let provider: DokuPaymentProvider;

beforeEach(() => {
  serverEnvMock.payment.apiKey = SECRET;
  serverEnvMock.payment.clientId = CLIENT;
  vi.stubEnv("PAYMENT_PROVIDER_ENV", "sandbox");
  vi.stubEnv("PAYMENT_LIVE_ENABLED", "");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  provider = new DokuPaymentProvider();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("DOKU adapter — fail-closed configuration (sandbox only)", () => {
  it("is configured only with an explicit sandbox env, a client id and a secret key", () => {
    expect(provider.isConfigured()).toBe(true);
    expect(provider.name).toBe("doku");
  });
  it.each([
    ["no env stated", { env: "", flag: "" }],
    ["production env", { env: "production", flag: "" }],
    ["unknown env", { env: "staging", flag: "" }],
    ["live flag set with sandbox env", { env: "sandbox", flag: "true" }],
    ["live flag set with production env", { env: "production", flag: "true" }],
    ["a typo in the live flag", { env: "sandbox", flag: "TRUE" }],
  ])("is NOT configured: %s", (_name, { env, flag }) => {
    vi.stubEnv("PAYMENT_PROVIDER_ENV", env);
    vi.stubEnv("PAYMENT_LIVE_ENABLED", flag);
    expect(provider.isConfigured()).toBe(false);
    expect(resolveDokuConfig()).toBeNull();
  });
  it("is NOT configured without credentials or with a malformed client id", () => {
    serverEnvMock.payment.apiKey = undefined;
    expect(provider.isConfigured()).toBe(false);
    serverEnvMock.payment.apiKey = "short";
    expect(provider.isConfigured()).toBe(false);
    serverEnvMock.payment.apiKey = SECRET;
    serverEnvMock.payment.clientId = undefined;
    expect(provider.isConfigured()).toBe(false);
    serverEnvMock.payment.clientId = "bad id\nwith newline";
    expect(provider.isConfigured()).toBe(false);
  });
  it("every call throws when unconfigured and never reaches the network", async () => {
    vi.stubEnv("PAYMENT_PROVIDER_ENV", "production");
    await expect(
      provider.createCheckoutSession({ tenantId: "t", plan: "PRO", amountIDR: 99000, internalTransactionId: TXN, successUrl: "https://a.test/s", cancelUrl: "https://a.test/c" }),
    ).rejects.toBeInstanceOf(PaymentProviderConfigError);
    await expect(provider.getVerifiedPayment(TXN)).rejects.toBeInstanceOf(PaymentProviderConfigError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("DOKU invoice number (UUID <-> <= 30 characters)", () => {
  it("is deterministic, 27 chars, alphanumeric, and reversible for many random UUIDs", () => {
    expect(DOKU_INVOICE_NUMBER_LENGTH).toBe(27);
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const id = randomUUID();
      const code = encodeDokuInvoiceNumber(id);
      expect(code).toHaveLength(27);
      expect(code.length).toBeLessThanOrEqual(30);
      expect(code).toMatch(/^LN[0-9A-Z]{25}$/);
      expect(encodeDokuInvoiceNumber(id)).toBe(code);
      expect(decodeDokuInvoiceNumber(code)).toBe(id);
      seen.add(code);
    }
    expect(seen.size).toBe(2000); // unique
  });
  it("handles the smallest and largest UUID and is case-insensitive on input", () => {
    for (const id of ["00000000-0000-0000-0000-000000000000", "ffffffff-ffff-ffff-ffff-ffffffffffff"]) {
      expect(decodeDokuInvoiceNumber(encodeDokuInvoiceNumber(id))).toBe(id);
    }
    expect(encodeDokuInvoiceNumber(TXN.toUpperCase())).toBe(INVOICE);
  });
  it("different UUIDs never share a code", () => {
    expect(encodeDokuInvoiceNumber("11111111-1111-4111-8111-111111111111")).not.toBe(encodeDokuInvoiceNumber("11111111-1111-4111-8111-111111111112"));
  });
  it("decode rejects everything that is not exactly a canonical code", () => {
    const bad: unknown[] = [
      undefined, null, 42, "", "LN", INVOICE.toLowerCase(), INVOICE.slice(1), `${INVOICE}0`, `X${INVOICE.slice(1)}`,
      `LN${"Z".repeat(25)}`, // > 2^128
      `${INVOICE} `, `${INVOICE}\n`, TXN, "INV-123123-12313",
    ];
    for (const v of bad) expect(decodeDokuInvoiceNumber(v), String(v)).toBeNull();
  });
  it("encode rejects a non-UUID", () => {
    for (const v of ["", "abc", "11111111-1111-4111-8111-11111111111", "../../etc/passwd", `${TXN}x`]) {
      expect(() => encodeDokuInvoiceNumber(v)).toThrow(PaymentProviderConfigError);
    }
  });
});

describe("DOKU signature", () => {
  const base = { clientId: CLIENT, requestId: "req-1", timestamp: "2026-11-09T10:00:00Z", requestTarget: "/checkout/v1/payment", secretKey: SECRET };
  it("POST: signs Client-Id, Request-Id, Request-Timestamp, Request-Target and Digest (documented algorithm)", () => {
    const body = JSON.stringify({ order: { amount: 99000, invoice_number: INVOICE } });
    const digest = computeDokuDigest(body);
    expect(digest).toBe(createHash("sha256").update(body).digest("base64"));
    expect(computeDokuSignature({ ...base, rawBody: body })).toBe(
      referenceSignature([`Client-Id:${CLIENT}`, "Request-Id:req-1", "Request-Timestamp:2026-11-09T10:00:00Z", "Request-Target:/checkout/v1/payment", `Digest:${digest}`]),
    );
  });
  it("GET: no Digest line and no trailing newline", () => {
    expect(computeDokuSignature({ ...base, requestTarget: `/orders/v1/status/${INVOICE}` })).toBe(
      referenceSignature([`Client-Id:${CLIENT}`, "Request-Id:req-1", "Request-Timestamp:2026-11-09T10:00:00Z", `Request-Target:/orders/v1/status/${INVOICE}`]),
    );
  });
  it("changes with any component or the secret", () => {
    const body = "{}";
    const ref = computeDokuSignature({ ...base, rawBody: body });
    expect(computeDokuSignature({ ...base, rawBody: "{ }" })).not.toBe(ref);
    expect(computeDokuSignature({ ...base, rawBody: body, requestId: "req-2" })).not.toBe(ref);
    expect(computeDokuSignature({ ...base, rawBody: body, timestamp: "2026-11-09T10:00:01Z" })).not.toBe(ref);
    expect(computeDokuSignature({ ...base, rawBody: body, requestTarget: "/other" })).not.toBe(ref);
    expect(computeDokuSignature({ ...base, rawBody: body, secretKey: "another-secret-key" })).not.toBe(ref);
    expect(ref).toMatch(/^HMACSHA256=[A-Za-z0-9+/]{43}=$/);
  });
});

describe("DOKU status mapping", () => {
  it("only SUCCESS is PAID", () => {
    expect(mapDokuStatus("SUCCESS")).toBe("PAID");
    for (const s of ["PENDING", "TIMEOUT", "REDIRECT"]) expect(mapDokuStatus(s)).toBe("PENDING");
    for (const s of ["", undefined, "success-ish", "PAID", "SETTLEMENT", "AUTHORIZED"]) expect(mapDokuStatus(s as string | undefined)).toBe("UNKNOWN");
  });
  it("FAILED is not final for Checkout: it must never close an invoice", () => {
    expect(mapDokuStatus("FAILED")).toBe("PENDING");
  });
  it("EXPIRED closes; refund / void / partial refund are REFUNDED, never PAID — even if the status word says SUCCESS", () => {
    expect(mapDokuStatus("EXPIRED")).toBe("EXPIRED");
    for (const s of ["REFUNDED", "PARTIAL_REFUNDED", "VOIDED"]) expect(mapDokuStatus(s)).toBe("REFUNDED");
    for (const t of ["REFUND", "FULL_REFUND", "PARTIAL_REFUND", "VOID", "partial_refund"]) expect(mapDokuStatus("SUCCESS", t)).toBe("REFUNDED");
    expect(mapDokuStatus("SUCCESS", "SALE")).toBe("PAID");
  });
  it("SUCCESS on an expired order is ambiguous (UNKNOWN), not PAID", () => {
    expect(mapDokuStatus("SUCCESS", "SALE", "ORDER_EXPIRED")).toBe("UNKNOWN");
    expect(mapDokuStatus("SUCCESS", "SALE", "ORDER_GENERATED")).toBe("PAID");
  });
});

describe("DOKU createCheckoutSession", () => {
  const input = { tenantId: "t1", plan: "PRO" as const, amountIDR: 99000, internalTransactionId: TXN, successUrl: "https://app.test/billing?x=1&txn=abc", cancelUrl: "https://app.test/billing" };
  const ok = { message: ["SUCCESS"], response: { payment: { url: "https://sandbox.doku.com/checkout/link/abc", token_id: "tok-1", expired_date: "20261110100000" } } };

  it("posts a signed request to the SANDBOX host only, with the server-side amount and the encoded invoice", async () => {
    fetchMock.mockResolvedValueOnce(json(ok));
    const result = await provider.createCheckoutSession(input);
    expect(result).toEqual({ checkoutUrl: "https://sandbox.doku.com/checkout/link/abc", externalSessionId: "tok-1" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api-sandbox.doku.com/checkout/v1/payment");
    expect(url).not.toMatch(/\/\/api\.doku\.com/);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeDefined();
    const headers = init.headers as Record<string, string>;
    const rawBody = init.body as string;
    const body = JSON.parse(rawBody);
    expect(body.order.amount).toBe(99000);
    expect(body.order.invoice_number).toBe(INVOICE);
    expect(body.order.invoice_number.length).toBeLessThanOrEqual(30);
    expect(body.order.callback_url).toBe(input.successUrl);
    expect(body.payment.payment_due_date).toBe(1440);
    expect(body.payment.payment_method_types).toBeUndefined(); // this app asserts no method; DOKU shows what the merchant activated
    expect(rawBody).not.toContain(SECRET);
    expect(JSON.stringify(headers)).not.toContain(SECRET);
    // the signature on the wire verifies against the exact body + headers that were sent
    expect(headers["Client-Id"]).toBe(CLIENT);
    expect(headers["Request-Id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers["Request-Timestamp"]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(headers.Signature).toBe(
      referenceSignature([
        `Client-Id:${CLIENT}`, `Request-Id:${headers["Request-Id"]}`, `Request-Timestamp:${headers["Request-Timestamp"]}`,
        "Request-Target:/checkout/v1/payment", `Digest:${computeDokuDigest(rawBody)}`,
      ]),
    );
  });
  it("uses a fresh Request-Id on every call", async () => {
    fetchMock.mockResolvedValue(json(ok));
    await provider.createCheckoutSession(input);
    await provider.createCheckoutSession(input);
    const ids = fetchMock.mock.calls.map((c) => ((c[1] as RequestInit).headers as Record<string, string>)["Request-Id"]);
    expect(new Set(ids).size).toBe(2);
  });
  it("accepts the unwrapped response shape too", async () => {
    fetchMock.mockResolvedValueOnce(json({ payment: ok.response.payment }));
    await expect(provider.createCheckoutSession(input)).resolves.toMatchObject({ externalSessionId: "tok-1" });
  });
  it("rejects bad amounts and a non-UUID transaction id before any network call", async () => {
    for (const amountIDR of [0, -1, 99000.5, Number.NaN, 1e13]) {
      await expect(provider.createCheckoutSession({ ...input, amountIDR })).rejects.toBeInstanceOf(PaymentProviderConfigError);
    }
    await expect(provider.createCheckoutSession({ ...input, internalTransactionId: "not-a-uuid" })).rejects.toBeInstanceOf(PaymentProviderConfigError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("fails closed on HTTP errors, network errors/timeouts, bad JSON and incomplete answers", async () => {
    fetchMock.mockResolvedValueOnce(json({ error_messages: ["x"] }, 400));
    await expect(provider.createCheckoutSession(input)).rejects.toThrow(/HTTP 400/);
    fetchMock.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
    await expect(provider.createCheckoutSession(input)).rejects.toBeInstanceOf(PaymentProviderConfigError);
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 200 }));
    await expect(provider.createCheckoutSession(input)).rejects.toBeInstanceOf(PaymentProviderConfigError);
    fetchMock.mockResolvedValueOnce(json({ response: { payment: { token_id: "t" } } }));
    await expect(provider.createCheckoutSession(input)).rejects.toThrow(/tidak lengkap/);
    fetchMock.mockResolvedValueOnce(json({ response: { payment: { url: "https://sandbox.doku.com/x" } } }));
    await expect(provider.createCheckoutSession(input)).rejects.toThrow(/tidak lengkap/);
  });
  it("refuses a checkout URL that is not https on a DOKU domain (no open redirect)", async () => {
    for (const url of ["http://sandbox.doku.com/x", "https://evil.example.com/x", "https://doku.com.evil.com/x", "https://user:pw@sandbox.doku.com/x", "javascript:alert(1)", "not a url"]) {
      fetchMock.mockResolvedValueOnce(json({ response: { payment: { url, token_id: "t" } } }));
      await expect(provider.createCheckoutSession(input), url).rejects.toBeInstanceOf(PaymentProviderConfigError);
    }
  });
  it("refuses an oversized response", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ pad: "x".repeat(70_000) }), { status: 200 }));
    await expect(provider.createCheckoutSession(input)).rejects.toThrow(/terlalu besar/);
  });
});

describe("DOKU getVerifiedPayment (Check Status)", () => {
  const answer = (over: { order?: Record<string, unknown>; transaction?: Record<string, unknown>; extra?: Record<string, unknown> } = {}) => ({
    order: { invoice_number: INVOICE, amount: 99000, ...over.order },
    transaction: { status: "SUCCESS", date: "2026-11-09T10:01:00Z", original_request_id: "orig-req-1", ...over.transaction },
    ...over.extra,
  });
  const clean = <T extends Record<string, unknown>>(o: T) => JSON.parse(JSON.stringify(o)) as T; // drops undefined

  it("signs a GET without Digest to the sandbox status path and maps SUCCESS to PAID with amount and reference", async () => {
    fetchMock.mockResolvedValueOnce(json(answer()));
    const v = await provider.getVerifiedPayment(TXN);
    expect(v).toMatchObject({ orderId: TXN, status: "PAID", amount: 99000, currency: "IDR", gatewayTransactionId: "orig-req-1" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api-sandbox.doku.com/orders/v1/status/${INVOICE}`);
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    const h = init.headers as Record<string, string>;
    expect(h.Signature).toBe(
      referenceSignature([`Client-Id:${CLIENT}`, `Request-Id:${h["Request-Id"]}`, `Request-Timestamp:${h["Request-Timestamp"]}`, `Request-Target:/orders/v1/status/${INVOICE}`]),
    );
  });
  it("accepts string amounts like 99000.00 and the wrapped response shape", async () => {
    fetchMock.mockResolvedValueOnce(json({ response: answer({ order: { amount: "99000.00" } }) }));
    await expect(provider.getVerifiedPayment(TXN)).resolves.toMatchObject({ status: "PAID", amount: 99000 });
  });
  it("PENDING / FAILED(non-final) / TIMEOUT never become PAID and need no reference", async () => {
    for (const status of ["PENDING", "FAILED", "TIMEOUT", "REDIRECT"]) {
      fetchMock.mockResolvedValueOnce(json(answer({ transaction: { status, original_request_id: undefined } })));
      const v = await provider.getVerifiedPayment(TXN);
      expect(v.status, status).toBe("PENDING");
    }
  });
  it("EXPIRED, refund and void answers map to closing / alarm statuses", async () => {
    fetchMock.mockResolvedValueOnce(json(answer({ transaction: { status: "EXPIRED" } })));
    expect((await provider.getVerifiedPayment(TXN)).status).toBe("EXPIRED");
    fetchMock.mockResolvedValueOnce(json(answer({ transaction: { status: "REFUNDED", type: "FULL_REFUND" } })));
    const refunded = await provider.getVerifiedPayment(TXN);
    expect(refunded.status).toBe("REFUNDED");
    expect(refunded.eventRefBasis).toBe("detailed");
    fetchMock.mockResolvedValueOnce(json(answer({ transaction: { status: "SUCCESS", type: "PARTIAL_REFUND", amount: 10000 } })));
    expect((await provider.getVerifiedPayment(TXN)).status).toBe("REFUNDED");
  });
  it("a new refund state produces a different event ref than the previous state", async () => {
    fetchMock.mockResolvedValueOnce(json(answer({ transaction: { status: "PARTIAL_REFUNDED", type: "PARTIAL_REFUND", amount: 10000 } })));
    const a = await provider.getVerifiedPayment(TXN);
    fetchMock.mockResolvedValueOnce(json(answer({ transaction: { status: "PARTIAL_REFUNDED", type: "PARTIAL_REFUND", amount: 20000 } })));
    const b = await provider.getVerifiedPayment(TXN);
    fetchMock.mockResolvedValueOnce(json(answer({ transaction: { status: "PARTIAL_REFUNDED", type: "PARTIAL_REFUND", amount: 20000 } })));
    const c = await provider.getVerifiedPayment(TXN);
    expect(a.eventRef).not.toBe(b.eventRef);
    expect(b.eventRef).toBe(c.eventRef);
  });
  it("SUCCESS without the data needed to verify is NEVER usable: it throws (safe retry), it is not guessed", async () => {
    const missing: Array<[string, unknown]> = [
      ["no amount", answer({ order: { amount: undefined } })],
      ["zero amount", answer({ order: { amount: 0 } })],
      ["fractional amount", answer({ order: { amount: 99000.5 } })],
      ["string garbage amount", answer({ order: { amount: "1e5" } })],
      ["negative amount", answer({ order: { amount: -5 } })],
      ["no gateway reference", answer({ transaction: { original_request_id: undefined } })],
      ["empty gateway reference", answer({ transaction: { original_request_id: "" } })],
      ["malformed gateway reference", answer({ transaction: { original_request_id: "has space\n" } })],
      ["no transaction status", answer({ transaction: { status: undefined } })],
      ["no invoice number", answer({ order: { invoice_number: undefined } })],
      ["foreign currency", answer({ order: { currency: "USD" } })],
      ["empty object", {}],
      ["array", []],
    ];
    for (const [name, body] of missing) {
      fetchMock.mockResolvedValueOnce(json(Array.isArray(body) ? body : clean(body as Record<string, unknown>)));
      await expect(provider.getVerifiedPayment(TXN), name).rejects.toBeInstanceOf(PaymentProviderConfigError);
    }
  });
  it("an answer about a different order is rejected", async () => {
    const other = encodeDokuInvoiceNumber("22222222-2222-4222-8222-222222222222");
    fetchMock.mockResolvedValueOnce(json(answer({ order: { invoice_number: other } })));
    await expect(provider.getVerifiedPayment(TXN)).rejects.toThrow(/order yang berbeda/);
    fetchMock.mockResolvedValueOnce(json(answer({ order: { invoice_number: "INV-123" } })));
    await expect(provider.getVerifiedPayment(TXN)).rejects.toThrow(/order yang berbeda/);
  });
  it("SUCCESS on an expired order and unknown status words are UNKNOWN (never paid)", async () => {
    fetchMock.mockResolvedValueOnce(json(answer({ order: { status: "ORDER_EXPIRED" } })));
    expect((await provider.getVerifiedPayment(TXN)).status).toBe("UNKNOWN");
    fetchMock.mockResolvedValueOnce(json(answer({ transaction: { status: "SOMETHING_NEW" } })));
    expect((await provider.getVerifiedPayment(TXN)).status).toBe("UNKNOWN");
  });
  it("HTTP errors, timeouts, bad JSON and oversized answers throw; a non-UUID order id never builds a URL", async () => {
    fetchMock.mockResolvedValueOnce(json({}, 404));
    await expect(provider.getVerifiedPayment(TXN)).rejects.toThrow(/HTTP 404/);
    fetchMock.mockResolvedValueOnce(json({}, 500));
    await expect(provider.getVerifiedPayment(TXN)).rejects.toThrow(/HTTP 500/);
    fetchMock.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
    await expect(provider.getVerifiedPayment(TXN)).rejects.toBeInstanceOf(PaymentProviderConfigError);
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 200 }));
    await expect(provider.getVerifiedPayment(TXN)).rejects.toBeInstanceOf(PaymentProviderConfigError);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ pad: "x".repeat(70_000) }), { status: 200 }));
    await expect(provider.getVerifiedPayment(TXN)).rejects.toThrow(/terlalu besar/);
    const calls = fetchMock.mock.calls.length;
    await expect(provider.getVerifiedPayment("../../x")).rejects.toBeInstanceOf(PaymentProviderConfigError);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });
  it("getPaymentStatus is a coarse display view only", async () => {
    fetchMock.mockResolvedValueOnce(json(answer()));
    await expect(provider.getPaymentStatus(TXN)).resolves.toBe("PAID");
    fetchMock.mockResolvedValueOnce(json(answer({ transaction: { status: "REFUNDED" } })));
    await expect(provider.getPaymentStatus(TXN)).resolves.toBe("FAILED");
  });
});

describe("DOKU webhook authentication and parsing", () => {
  const PATH = "/api/webhooks/payment";
  const body = JSON.stringify({ order: { invoice_number: INVOICE, amount: 99000 }, transaction: { status: "SUCCESS", original_request_id: "orig-1" }, acquirer: { id: "BCA" } });
  function request(over: { headers?: Record<string, string | undefined>; path?: string; rawBody?: string; secret?: string } = {}) {
    const rawBody = over.rawBody ?? body;
    const base: Record<string, string> = { "client-id": CLIENT, "request-id": "notif-1", "request-timestamp": "2026-11-09T10:00:00Z" };
    base.signature = referenceSignature(
      [`Client-Id:${CLIENT}`, "Request-Id:notif-1", "Request-Timestamp:2026-11-09T10:00:00Z", `Request-Target:${PATH}`, `Digest:${computeDokuDigest(body)}`],
      over.secret ?? SECRET,
    );
    const merged: Record<string, string | undefined> = { ...base, ...over.headers };
    return { rawBody, ctx: { headers: { get: (n: string) => merged[n.toLowerCase()] ?? null }, path: over.path ?? PATH } };
  }

  it("accepts a correctly signed notification (header names are case-insensitive)", () => {
    const r = request();
    expect(provider.verifyWebhookRequest(r.rawBody, r.ctx)).toBe(true);
  });
  it("the legacy body-only check can never authenticate DOKU", () => {
    expect(provider.verifyWebhookSignature(body, "HMACSHA256=whatever")).toBe(false);
    expect(provider.verifyWebhookSignature(body, null)).toBe(false);
  });
  it.each([
    ["wrong secret", { secret: "attacker-secret-key" }],
    ["body modified after signing", { rawBody: body.replace("99000", "1") }],
    ["body with an extra space", { rawBody: `${body} ` }],
    ["different request path", { path: "/api/webhooks/other" }],
    ["different Request-Id", { headers: { "request-id": "notif-2" } }],
    ["different Request-Timestamp", { headers: { "request-timestamp": "2026-11-09T10:00:01Z" } }],
    ["foreign Client-Id", { headers: { "client-id": "MCH-9999-0000000000" } }],
    ["missing Signature", { headers: { signature: undefined } }],
    ["missing Client-Id", { headers: { "client-id": undefined } }],
    ["missing Request-Id", { headers: { "request-id": undefined } }],
    ["missing Request-Timestamp", { headers: { "request-timestamp": undefined } }],
    ["signature without the HMACSHA256= prefix", { headers: { signature: "abc" } }],
    ["signature of the wrong length", { headers: { signature: "HMACSHA256=AAAA" } }],
    ["malformed timestamp", { headers: { "request-timestamp": "yesterday" } }],
    ["Request-Id with control characters", { headers: { "request-id": "a\nb" } }],
    ["empty path", { path: "" }],
  ])("rejects: %s", (_name, over) => {
    const r = request(over as Parameters<typeof request>[0]);
    expect(provider.verifyWebhookRequest(r.rawBody, r.ctx)).toBe(false);
  });
  it("rejects everything when not configured (sandbox switch off)", () => {
    vi.stubEnv("PAYMENT_PROVIDER_ENV", "production");
    const r = request();
    expect(provider.verifyWebhookRequest(r.rawBody, r.ctx)).toBe(false);
  });

  it("parses a notification into the normalized event; the event id is DOKU's Request-Id", () => {
    const r = request();
    expect(provider.parseWebhookEvent(r.rawBody, r.ctx)).toEqual({
      externalEventId: "notif-1",
      externalPaymentId: INVOICE,
      eventType: "doku.success",
      status: "PAID",
      amount: 99000,
      currency: "IDR",
      internalTransactionId: TXN,
    });
  });
  it("claims: FAILED / refunds / unknown are never PAID; an invoice that is not ours has no internal id", () => {
    const parse = (transaction: Record<string, unknown>, invoice = INVOICE) =>
      provider.parseWebhookEvent(JSON.stringify({ order: { invoice_number: invoice, amount: 1 }, transaction }), request().ctx);
    expect(parse({ status: "FAILED" }).status).toBe("FAILED");
    expect(parse({ status: "REFUNDED" }).status).toBe("FAILED");
    expect(parse({ status: "SUCCESS", type: "PARTIAL_REFUND" }).status).toBe("FAILED");
    expect(parse({ status: "WEIRD" }).status).toBe("FAILED");
    expect(parse({ status: "EXPIRED" }).status).toBe("EXPIRED");
    expect(parse({ status: "SUCCESS" }, "INV-123123-12313").internalTransactionId).toBeNull();
  });
  it("throws on unusable payloads, a missing Request-Id, or no request context", () => {
    const ctx = request().ctx;
    for (const raw of ["not json", "[]", "{}", JSON.stringify({ order: { invoice_number: INVOICE } }), JSON.stringify({ transaction: { status: "SUCCESS" } })]) {
      expect(() => provider.parseWebhookEvent(raw, ctx), raw).toThrow(PaymentProviderConfigError);
    }
    expect(() => provider.parseWebhookEvent(body)).toThrow(PaymentProviderConfigError);
    expect(() => provider.parseWebhookEvent(body, request({ headers: { "request-id": undefined } }).ctx)).toThrow(PaymentProviderConfigError);
  });
  it("cancelSubscription is unsupported (one-off payments only)", async () => {
    await expect(provider.cancelSubscription("x")).rejects.toBeInstanceOf(PaymentProviderConfigError);
  });
});
