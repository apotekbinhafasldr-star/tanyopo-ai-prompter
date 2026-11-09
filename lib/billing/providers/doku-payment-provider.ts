import "server-only";

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";
import {
  PaymentProviderConfigError,
  type CheckoutSessionInput,
  type CheckoutSessionResult,
  type ParsedWebhookEvent,
  type PaymentProvider,
  type RemotePaymentStatus,
  type VerifiedPayment,
  type VerifiedPaymentStatus,
  type WebhookRequestContext,
} from "@/lib/billing/payment-provider";

/**
 * DOKU adapter — SANDBOX ONLY (explicit Founder mandate; DOKU KYB is not finished, so NO merchant is assumed active).
 *
 * Fail-closed configuration (resolveDokuConfig): the adapter reports itself configured only when ALL hold —
 *   - PAYMENT_LIVE_ENABLED is empty (a live flag of any value switches it off, there is no live mode in this file),
 *   - PAYMENT_PROVIDER_ENV is exactly "sandbox" (DOKU key strings carry no sandbox/production prefix we could check,
 *     so the environment must be stated explicitly instead of being guessed),
 *   - a Client-Id (PAYMENT_PROVIDER_CLIENT_ID) and a Secret Key (PAYMENT_PROVIDER_API_KEY) are present and well-formed.
 * Only the sandbox host is written in this file; no production host exists in the code, so a production request cannot
 * be produced by any configuration. Going live is a separate, separately approved change.
 *
 * Trust model (same as Midtrans / B3): the webhook signature proves the notification was produced with our Secret Key,
 * but its status/amount are only a CLAIM. services/payment-verification.ts activates ONLY from getVerifiedPayment()
 * (DOKU Check Status, called server-to-server). Everything ambiguous throws (=> safe retry) or maps to a status that
 * can never activate a subscription. Unverified API assumptions are listed in docs/BILLING_DOKU_SANDBOX_ADAPTER.md.
 *
 * Secrets: the Secret Key is read only from serverEnv, never logged, returned or placed in a URL.
 */
const SANDBOX_API_BASE = "https://api-sandbox.doku.com";
const CHECKOUT_PATH = "/checkout/v1/payment";
const STATUS_PATH_PREFIX = "/orders/v1/status/";

/** Hard ceilings so a slow or hostile gateway answer can never hold a request open or exhaust memory. */
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

/** Checkout page lifetime in minutes (DOKU default is 60). Conservative like Midtrans: never payable for more than a day. */
const PAYMENT_DUE_MINUTES = 24 * 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{3,64}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
/** base64 of a 32-byte HMAC: 43 chars + one "=". */
const SIGNATURE_HEADER_PATTERN = /^HMACSHA256=[A-Za-z0-9+/]{43}=$/;
const AMOUNT_PATTERN = /^\d{1,12}(\.0{1,2})?$/;

// ---------------------------------------------------------------------------------------------------------------------
// Invoice number: our transaction UUID <-> DOKU `order.invoice_number`
// ---------------------------------------------------------------------------------------------------------------------

/**
 * DOKU limits order.invoice_number to 64 characters, and to 30 when Credit Card is activated; for some methods symbols
 * are not allowed. A UUID has 36 characters, so the invoice number is a reversible, fixed-length, alphanumeric code:
 *   "LN" + the 128-bit UUID as 25 base-36 digits (upper-case, zero-padded)  =  27 characters (<= 30).
 * 36^25 > 2^128, so every UUID fits; the encoding is deterministic (one UUID => one code), unique (injective) and
 * canonical (decode(encode(x)) === x, and decode rejects anything that is not exactly a canonical code).
 */
const INVOICE_PREFIX = "LN";
const INVOICE_DIGITS = 25;
const INVOICE_PATTERN = /^LN[0-9A-Z]{25}$/;
export const DOKU_INVOICE_NUMBER_LENGTH = INVOICE_PREFIX.length + INVOICE_DIGITS;

export function encodeDokuInvoiceNumber(transactionId: string): string {
  if (!UUID_PATTERN.test(transactionId)) {
    throw new PaymentProviderConfigError("doku", "ID transaksi internal tidak valid.");
  }
  const value = BigInt(`0x${transactionId.replace(/-/g, "")}`);
  return `${INVOICE_PREFIX}${value.toString(36).toUpperCase().padStart(INVOICE_DIGITS, "0")}`;
}

/** Returns the lower-case UUID, or null for anything that is not exactly a canonical invoice code. */
export function decodeDokuInvoiceNumber(invoiceNumber: unknown): string | null {
  if (typeof invoiceNumber !== "string" || !INVOICE_PATTERN.test(invoiceNumber)) return null;
  const base = BigInt(36);
  let value = BigInt(0);
  for (const ch of invoiceNumber.slice(INVOICE_PREFIX.length)) {
    value = value * base + BigInt(parseInt(ch, 36));
  }
  if (value >= BigInt(1) << BigInt(128)) return null;
  const hex = value.toString(16).padStart(32, "0");
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return encodeDokuInvoiceNumber(uuid) === invoiceNumber ? uuid : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Signature
// ---------------------------------------------------------------------------------------------------------------------

export interface DokuSignatureInput {
  clientId: string;
  requestId: string;
  timestamp: string;
  /** Path of the endpoint being called (our API calls) or of OUR notification URL (webhooks). */
  requestTarget: string;
  /** Raw JSON body for POST / webhook; undefined for GET (DOKU: no Digest for GET). */
  rawBody?: string;
  secretKey: string;
}

/** base64(SHA-256(body)) — DOKU's Digest component. */
export function computeDokuDigest(rawBody: string): string {
  return createHash("sha256").update(rawBody, "utf8").digest("base64");
}

/**
 * "HMACSHA256=" + base64(HMAC-SHA256(secretKey, components)). Components are `Name:value` lines joined by a real
 * newline with no trailing newline: Client-Id, Request-Id, Request-Timestamp, Request-Target and, only when there is a
 * body, Digest. (The newline reading of DOKU's "\n" is an assumption to confirm in sandbox — see the doc.)
 */
export function computeDokuSignature(input: DokuSignatureInput): string {
  const lines = [
    `Client-Id:${input.clientId}`,
    `Request-Id:${input.requestId}`,
    `Request-Timestamp:${input.timestamp}`,
    `Request-Target:${input.requestTarget}`,
  ];
  if (input.rawBody !== undefined) lines.push(`Digest:${computeDokuDigest(input.rawBody)}`);
  return `HMACSHA256=${createHmac("sha256", input.secretKey).update(lines.join("\n"), "utf8").digest("base64")}`;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

// ---------------------------------------------------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------------------------------------------------

export interface DokuConfig {
  clientId: string;
  secretKey: string;
  apiBase: string;
}

/** Exported for tests. Returns null (=> adapter unconfigured, everything fails closed) unless sandbox is stated explicitly. */
export function resolveDokuConfig(
  liveFlag: string | undefined = process.env.PAYMENT_LIVE_ENABLED,
  providerEnv: string | undefined = process.env.PAYMENT_PROVIDER_ENV,
): DokuConfig | null {
  if ((liveFlag ?? "").trim() !== "") return null; // any live switch, even a typo, disables DOKU rather than guessing
  if ((providerEnv ?? "").trim() !== "sandbox") return null;
  const { apiKey, clientId } = serverEnv.payment;
  if (!apiKey || apiKey.length < 8 || !clientId || !CLIENT_ID_PATTERN.test(clientId)) return null;
  return { clientId, secretKey: apiKey, apiBase: SANDBOX_API_BASE };
}

// ---------------------------------------------------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/** Strict IDR amount: a non-negative integer as number or as a plain numeric string ("99000" / "99000.00"). */
function parseIdrAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 && value <= 999_999_999_999 ? value : null;
  if (typeof value !== "string" || !AMOUNT_PATTERN.test(value)) return null;
  return Number(value.split(".")[0]);
}

/** DOKU answers either bare or wrapped in `response`; both shapes are tolerated (assumption A3 in the doc). */
function unwrap(data: Record<string, unknown>): Record<string, unknown> {
  return isRecord(data.response) ? data.response : data;
}

const REFUND_TRANSACTION_TYPES = new Set(["REFUND", "FULL_REFUND", "PARTIAL_REFUND", "VOID"]);

/**
 * The ONLY place DOKU's status words are interpreted. PAID means exactly `SUCCESS`, and nothing that looks like money
 * moving back or an inconsistent order ever counts as paid:
 *   SUCCESS (and order not expired)        -> PAID
 *   refund / void type, REFUNDED,
 *   PARTIAL_REFUNDED, VOIDED               -> REFUNDED   (alarm only; the subscription is never changed by it)
 *   EXPIRED                                -> EXPIRED    (closes a still-PENDING invoice)
 *   PENDING, TIMEOUT, REDIRECT             -> PENDING
 *   FAILED                                 -> PENDING    (DOKU Checkout: a customer may retry with another method, so
 *                                                         FAILED is not final and must not close the invoice)
 *   SUCCESS but order.status ORDER_EXPIRED,
 *   anything unrecognised                  -> UNKNOWN    (never paid, never closes; the caller retries safely)
 */
export function mapDokuStatus(
  transactionStatus: string | undefined,
  transactionType?: string,
  orderStatus?: string,
): VerifiedPaymentStatus {
  if (transactionType && REFUND_TRANSACTION_TYPES.has(transactionType.toUpperCase())) return "REFUNDED";
  switch (transactionStatus?.toUpperCase()) {
    case "SUCCESS":
      return orderStatus?.toUpperCase() === "ORDER_EXPIRED" ? "UNKNOWN" : "PAID";
    case "REFUNDED":
    case "PARTIAL_REFUNDED":
    case "VOIDED":
      return "REFUNDED";
    case "EXPIRED":
      return "EXPIRED";
    case "PENDING":
    case "TIMEOUT":
    case "REDIRECT":
    case "FAILED":
      return "PENDING";
    default:
      return "UNKNOWN";
  }
}

/** Coarse claim carried by a notification (an UNTRUSTED claim: the webhook core re-asks DOKU). */
function claimFromNotification(transactionStatus: string | undefined, transactionType?: string): RemotePaymentStatus {
  if (transactionType && REFUND_TRANSACTION_TYPES.has(transactionType.toUpperCase())) return "FAILED";
  switch (transactionStatus?.toUpperCase()) {
    case "SUCCESS":
      return "PAID";
    case "EXPIRED":
      return "EXPIRED";
    case "PENDING":
    case "TIMEOUT":
    case "REDIRECT":
      return "PENDING";
    default:
      // FAILED, REFUNDED, VOIDED, PARTIAL_REFUNDED and anything unknown: never PAID.
      return "FAILED";
  }
}

/** Identity of the verified gateway STATE (status words + refund specifics), so a new refund differs from a replay. */
function buildDokuEventRef(
  transaction: Record<string, unknown>,
  order: Record<string, unknown>,
  root: Record<string, unknown>,
): { ref: string; basis: "detailed" | "status_only" } {
  const scalar = (v: unknown) => (typeof v === "string" ? v.slice(0, 80) : typeof v === "number" && Number.isFinite(v) ? String(v) : "-");
  const refund = asRecord(root.refund);
  const refundAmount = asRecord(refund.amount);
  const parts = [
    `status=${scalar(transaction.status)}`,
    `type=${scalar(transaction.type)}`,
    `order=${scalar(order.status)}`,
    `tx_amount=${scalar(transaction.amount)}`,
    `tx_date=${scalar(transaction.date)}`,
    `refund_amount=${scalar(refund.amount ?? refundAmount.value)}`,
  ];
  const detailed =
    (typeof transaction.type === "string" && REFUND_TRANSACTION_TYPES.has(transaction.type.toUpperCase())) ||
    Object.keys(refund).length > 0;
  return { ref: `gw:${createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 40)}`, basis: detailed ? "detailed" : "status_only" };
}

// ---------------------------------------------------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------------------------------------------------

export class DokuPaymentProvider implements PaymentProvider {
  readonly name = "doku";

  isConfigured(): boolean {
    return resolveDokuConfig() !== null;
  }

  private requireConfig(): DokuConfig {
    const config = resolveDokuConfig();
    if (!config) {
      throw new PaymentProviderConfigError(this.name, "DOKU belum dikonfigurasi (hanya mode sandbox yang didukung).");
    }
    return config;
  }

  /** Reads a JSON body with a hard size ceiling, counted while streaming; anything else is a verification failure. */
  private async readJson(response: Response): Promise<Record<string, unknown>> {
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
      throw new PaymentProviderConfigError(this.name, "Respons DOKU terlalu besar.");
    }
    let text = "";
    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new PaymentProviderConfigError(this.name, "Respons DOKU terlalu besar.");
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new PaymentProviderConfigError(this.name, "Respons DOKU bukan JSON yang valid.");
    }
    if (!isRecord(parsed)) throw new PaymentProviderConfigError(this.name, "Respons DOKU tidak valid.");
    return parsed;
  }

  /** One signed call. Fresh Request-Id and timestamp every time; redirects are refused (a signed request is never replayed elsewhere). */
  private async call(
    config: DokuConfig,
    method: "GET" | "POST",
    target: string,
    jsonBody?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const requestId = randomUUID();
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const rawBody = jsonBody === undefined ? undefined : JSON.stringify(jsonBody);
    const signature = computeDokuSignature({
      clientId: config.clientId,
      requestId,
      timestamp,
      requestTarget: target,
      rawBody,
      secretKey: config.secretKey,
    });

    let response: Response;
    try {
      response = await fetch(`${config.apiBase}${target}`, {
        method,
        headers: {
          "Client-Id": config.clientId,
          "Request-Id": requestId,
          "Request-Timestamp": timestamp,
          Signature: signature,
          Accept: "application/json",
          ...(rawBody !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: rawBody,
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch {
      throw new PaymentProviderConfigError(this.name, "Tidak dapat menghubungi DOKU.");
    }
    if (!response.ok) {
      throw new PaymentProviderConfigError(this.name, `DOKU menolak permintaan (HTTP ${response.status}).`);
    }
    return this.readJson(response);
  }

  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    const config = this.requireConfig();
    if (!Number.isInteger(input.amountIDR) || input.amountIDR <= 0 || input.amountIDR > 999_999_999_999) {
      throw new PaymentProviderConfigError(this.name, "Nominal pembayaran tidak valid.");
    }
    const invoiceNumber = encodeDokuInvoiceNumber(input.internalTransactionId);

    // payment_method_types is deliberately omitted: DOKU then offers every method ACTIVATED for this merchant in the
    // Back Office (VA, QRIS, e-wallet, card ...). This app asserts no method as available; DOKU decides.
    const data = await this.call(config, "POST", CHECKOUT_PATH, {
      order: {
        amount: input.amountIDR,
        invoice_number: invoiceNumber,
        callback_url: input.successUrl,
      },
      payment: { payment_due_date: PAYMENT_DUE_MINUTES },
    });

    const root = unwrap(data);
    const payment = asRecord(root.payment);
    const url = asString(payment.url);
    const tokenId = asString(payment.token_id);
    if (!url || !tokenId || !isSafeCheckoutUrl(url)) {
      throw new PaymentProviderConfigError(this.name, "Respons checkout DOKU tidak lengkap atau tidak aman.");
    }
    return { checkoutUrl: url, externalSessionId: tokenId };
  }

  async getVerifiedPayment(orderId: string): Promise<VerifiedPayment> {
    const config = this.requireConfig();
    // The id ends up in a URL path: only our own UUID shape (encoded to the invoice code) is ever allowed there.
    if (!UUID_PATTERN.test(orderId)) {
      throw new PaymentProviderConfigError(this.name, "order_id tidak valid.");
    }
    const invoiceNumber = encodeDokuInvoiceNumber(orderId);
    const data = await this.call(config, "GET", `${STATUS_PATH_PREFIX}${invoiceNumber}`);

    const root = unwrap(data);
    const order = asRecord(root.order);
    const transaction = asRecord(root.transaction);

    const answeredInvoice = asString(order.invoice_number);
    const transactionStatus = asString(transaction.status);
    if (!answeredInvoice || !transactionStatus) {
      throw new PaymentProviderConfigError(this.name, "Respons status DOKU tidak lengkap.");
    }
    // The gateway must be talking about the very order we asked about.
    if (answeredInvoice !== invoiceNumber || decodeDokuInvoiceNumber(answeredInvoice)?.toLowerCase() !== orderId.toLowerCase()) {
      throw new PaymentProviderConfigError(this.name, "Respons status DOKU untuk order yang berbeda.");
    }

    const currency = asString(order.currency);
    if (currency !== undefined && currency.toUpperCase() !== "IDR") {
      throw new PaymentProviderConfigError(this.name, "Mata uang respons DOKU bukan IDR.");
    }

    const status = mapDokuStatus(transactionStatus, asString(transaction.type), asString(order.status));
    const amount = parseIdrAmount(order.amount);
    const reference = asString(transaction.original_request_id);

    if (status === "PAID") {
      // A "paid" answer is only usable with everything needed to reconcile it later. Missing => throw => safe retry,
      // never an activation (and never a guess such as "assume the amount is right").
      if (amount === null || amount <= 0) {
        throw new PaymentProviderConfigError(this.name, "Nominal pada respons DOKU tidak ada atau tidak valid.");
      }
      if (!reference || !REQUEST_ID_PATTERN.test(reference)) {
        throw new PaymentProviderConfigError(this.name, "Referensi pembayaran pada respons DOKU tidak ada.");
      }
    }

    const eventRef = buildDokuEventRef(transaction, order, root);
    return {
      orderId,
      eventRef: eventRef.ref,
      eventRefBasis: eventRef.basis,
      gatewayTransactionId: reference && REQUEST_ID_PATTERN.test(reference) ? reference : null,
      status,
      amount: amount ?? 0,
      currency: "IDR",
      rawStatus: `${transactionStatus}/${asString(transaction.type) ?? "-"}/${asString(order.status) ?? "-"}`.slice(0, 120),
    };
  }

  /** Coarse view for callers that only need a display state (activation never comes from here). */
  async getPaymentStatus(externalPaymentId: string): Promise<RemotePaymentStatus> {
    const verified = await this.getVerifiedPayment(externalPaymentId);
    switch (verified.status) {
      case "PAID":
      case "PENDING":
      case "FAILED":
      case "EXPIRED":
      case "CANCELLED":
        return verified.status;
      default:
        return "FAILED";
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept named/typed so callers get real arity checking against the PaymentProvider interface.
  async cancelSubscription(externalSubscriptionId: string): Promise<void> {
    throw new PaymentProviderConfigError(
      this.name,
      "Adapter DOKU berjalan dalam mode pembayaran sekali bayar — tidak ada subscription di sisi provider untuk dibatalkan.",
    );
  }

  /** DOKU signs over headers + path, so a body-only check can never authenticate it: always false (fail closed). */
  verifyWebhookSignature(_rawBody: string, _signatureHeader: string | null): boolean {
    return false;
  }

  verifyWebhookRequest(rawBody: string, request: WebhookRequestContext): boolean {
    const config = resolveDokuConfig();
    if (!config) return false;

    const clientId = request.headers.get("client-id");
    const requestId = request.headers.get("request-id");
    const timestamp = request.headers.get("request-timestamp");
    const signature = request.headers.get("signature");
    if (!clientId || !requestId || !timestamp || !signature) return false;
    if (!REQUEST_ID_PATTERN.test(requestId) || !TIMESTAMP_PATTERN.test(timestamp)) return false;
    if (!SIGNATURE_HEADER_PATTERN.test(signature)) return false;
    if (typeof request.path !== "string" || !request.path.startsWith("/") || request.path.length > 200) return false;
    // Must be OUR merchant's notification. (Freshness of Request-Timestamp is deliberately not enforced: DOKU's retry /
    // "Resend Notification" behaviour is undocumented, and a replay cannot activate anything — see class comment.)
    if (!safeEqual(clientId, config.clientId)) return false;

    const expected = computeDokuSignature({
      clientId,
      requestId,
      timestamp,
      requestTarget: request.path,
      rawBody,
      secretKey: config.secretKey,
    });
    return safeEqual(signature, expected);
  }

  /**
   * Normalises a signature-checked notification. EVERYTHING returned is an UNTRUSTED CLAIM (status and amount
   * included): the webhook core re-asks DOKU Check Status. The event id is DOKU's own per-notification Request-Id.
   */
  parseWebhookEvent(rawBody: string, request?: WebhookRequestContext): ParsedWebhookEvent {
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new PaymentProviderConfigError(this.name, "Payload webhook DOKU tidak valid (bukan JSON).");
    }
    if (!isRecord(payload)) throw new PaymentProviderConfigError(this.name, "Payload webhook DOKU tidak valid.");

    const requestId = request?.headers.get("request-id") ?? null;
    if (!requestId || !REQUEST_ID_PATTERN.test(requestId)) {
      throw new PaymentProviderConfigError(this.name, "Request-Id webhook DOKU tidak ada.");
    }
    const root = unwrap(payload);
    const order = asRecord(root.order);
    const transaction = asRecord(root.transaction);
    const invoiceNumber = asString(order.invoice_number);
    const transactionStatus = asString(transaction.status);
    if (!invoiceNumber || !transactionStatus) {
      throw new PaymentProviderConfigError(this.name, "Payload webhook DOKU tidak lengkap.");
    }

    return {
      externalEventId: requestId,
      externalPaymentId: invoiceNumber.slice(0, 64),
      eventType: `doku.${transactionStatus.toLowerCase()}`.slice(0, 60),
      status: claimFromNotification(transactionStatus, asString(transaction.type)),
      amount: parseIdrAmount(order.amount) ?? 0,
      currency: "IDR",
      // null when the invoice is not one of ours => the webhook core answers 400, nothing is touched.
      internalTransactionId: decodeDokuInvoiceNumber(invoiceNumber),
    };
  }
}

/** The payment page must be https on a DOKU domain: a tampered response cannot turn checkout into an open redirect. */
function isSafeCheckoutUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return url.protocol === "https:" && !url.username && !url.password && (url.hostname === "doku.com" || url.hostname.endsWith(".doku.com"));
}
