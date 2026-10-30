import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
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
} from "@/lib/billing/payment-provider";

/**
 * Sandbox hosts are hard-coded ON PURPOSE (Billing B3, Founder mandate: Midtrans SANDBOX ONLY). There is no setting
 * that points this adapter at the production hosts; going live needs a new, separately approved change.
 */
const MIDTRANS_SNAP_URL = "https://app.sandbox.midtrans.com/snap/v1/transactions";
const MIDTRANS_API_BASE = "https://api.sandbox.midtrans.com";
const SANDBOX_SERVER_KEY_PREFIX = "SB-Mid-server-";

/** Hard ceilings so a slow or hostile gateway answer can never hold a request open or exhaust memory. */
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

const ORDER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA512_HEX_PATTERN = /^[0-9a-f]{128}$/i;
const GROSS_AMOUNT_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

/** SHA512(order_id + status_code + gross_amount + ServerKey) — Midtrans' notification / status signature. */
export function computeMidtransSignature(
  orderId: string,
  statusCode: string,
  grossAmount: string,
  serverKey: string,
): string {
  return createHash("sha512").update(`${orderId}${statusCode}${grossAmount}${serverKey}`).digest("hex");
}

/** Constant-time comparison of a hex SHA-512 signature; never throws, never accepts malformed input. */
function signatureMatches(provided: unknown, expectedHex: string): boolean {
  if (typeof provided !== "string" || !SHA512_HEX_PATTERN.test(provided)) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = Buffer.from(provided.toLowerCase(), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Strict amount parser: a plain decimal string or a finite non-negative number, nothing else ("1e5", "", "NaN", "-1"). */
function parseGrossAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string" || !GROSS_AMOUNT_PATTERN.test(value)) return null;
  return Number(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Billing B3 — the ONLY place Midtrans' status words are interpreted. A payment counts as PAID in exactly two
 * situations (Founder rule): `settlement`, or `capture` with fraud_status `accept`; both additionally require
 * status_code 200 and no contradicting fraud_status. Everything else — challenge, deny, cancel, expire, failure,
 * refund, chargeback, and any status or combination this code does not recognise — is NOT paid, and an unrecognised
 * one is UNKNOWN (never PAID, and never used to close an invoice either).
 */
export function mapMidtransStatus(
  transactionStatus: string | undefined,
  fraudStatus: string | undefined,
  statusCode: string | undefined,
): VerifiedPaymentStatus {
  switch (transactionStatus) {
    case "settlement":
      return statusCode === "200" && (fraudStatus === undefined || fraudStatus === "accept") ? "PAID" : "UNKNOWN";
    case "capture":
      if (fraudStatus === "challenge") return "PENDING";
      if (fraudStatus === "deny") return "FAILED";
      return statusCode === "200" && fraudStatus === "accept" ? "PAID" : "UNKNOWN";
    case "pending":
    case "authorize":
      return "PENDING";
    case "deny":
    case "failure":
      return "FAILED";
    case "cancel":
      return "CANCELLED";
    case "expire":
      return "EXPIRED";
    case "refund":
    case "partial_refund":
      return "REFUNDED";
    case "chargeback":
    case "partial_chargeback":
      return "CHARGEBACK";
    default:
      return "UNKNOWN";
  }
}

/**
 * Billing B3 — Midtrans adapter, SANDBOX ONLY by explicit Founder mandate. isConfigured() is the production-payment
 * guard: only a sandbox server key ("SB-Mid-server-…") is accepted; a production-shaped key makes the adapter report
 * itself unconfigured, so checkout, webhook and reconciliation all fail closed. Do not relax this without a separate,
 * explicit Founder approval for production activation.
 *
 * Trust model (why there are two independent checks):
 *   1. verifyWebhookSignature(): SHA512(order_id + status_code + gross_amount + ServerKey), constant-time. This proves
 *      the notification was produced with our server key, but the signature does NOT cover `transaction_status`, so a
 *      genuine signed notification can be replayed or have its status word altered.
 *   2. getVerifiedPayment(): the server asks Midtrans directly (Get Status, authenticated with the server key) and
 *      services/payment-verification.ts activates ONLY from that answer. Webhook/redirect values are never trusted.
 *
 * Secrets: the server key is read only from serverEnv (server-only module) and is never logged, returned or put in a
 * URL. Midtrans has no separate webhook secret — the server key is also the signing key.
 */
export class MidtransPaymentProvider implements PaymentProvider {
  readonly name = "midtrans";

  isConfigured(): boolean {
    const { apiKey } = serverEnv.payment;
    return !!apiKey && apiKey.startsWith(SANDBOX_SERVER_KEY_PREFIX);
  }

  private requireConfig(): { apiKey: string } {
    const { apiKey } = serverEnv.payment;
    if (!this.isConfigured() || !apiKey) {
      throw new PaymentProviderConfigError(this.name, "Midtrans belum dikonfigurasi dengan sandbox server key yang valid.");
    }
    return { apiKey };
  }

  private authHeader(apiKey: string): string {
    // Midtrans authenticates via HTTP Basic Auth: the server key as the username, blank password.
    return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
  }

  /** Reads a JSON body with a hard size ceiling; anything else is a verification failure, never a guess. */
  private async readJson(response: Response): Promise<Record<string, unknown>> {
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new PaymentProviderConfigError(this.name, "Respons Midtrans terlalu besar.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new PaymentProviderConfigError(this.name, "Respons Midtrans bukan JSON yang valid.");
    }
    if (!isRecord(parsed)) {
      throw new PaymentProviderConfigError(this.name, "Respons Midtrans tidak valid.");
    }
    return parsed;
  }

  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    const { apiKey } = this.requireConfig();

    if (!ORDER_ID_PATTERN.test(input.internalTransactionId)) {
      throw new PaymentProviderConfigError(this.name, "ID transaksi internal tidak valid.");
    }
    if (!Number.isInteger(input.amountIDR) || input.amountIDR <= 0) {
      throw new PaymentProviderConfigError(this.name, "Nominal pembayaran tidak valid.");
    }

    let response: Response;
    try {
      response = await fetch(MIDTRANS_SNAP_URL, {
        method: "POST",
        headers: {
          Authorization: this.authHeader(apiKey),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          // order_id == our internal transaction id: the one key that ties webhook, status check and DB row together.
          transaction_details: { order_id: input.internalTransactionId, gross_amount: input.amountIDR },
          item_details: [
            { id: input.plan, price: input.amountIDR, quantity: 1, name: `LINOE paket ${input.plan}`.slice(0, 50) },
          ],
          credit_card: { secure: true },
          callbacks: { finish: input.successUrl },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch {
      throw new PaymentProviderConfigError(this.name, "Tidak dapat menghubungi Midtrans.");
    }

    if (!response.ok) {
      throw new PaymentProviderConfigError(
        this.name,
        `Midtrans menolak permintaan checkout (HTTP ${response.status}).`,
      );
    }

    const data = await this.readJson(response);
    const token = asString(data.token);
    const redirectUrl = asString(data.redirect_url);
    if (!token || !redirectUrl || !redirectUrl.startsWith("https://")) {
      throw new PaymentProviderConfigError(this.name, "Respons checkout Midtrans tidak lengkap.");
    }

    return { checkoutUrl: redirectUrl, externalSessionId: token };
  }

  async getVerifiedPayment(orderId: string): Promise<VerifiedPayment> {
    const { apiKey } = this.requireConfig();

    // order_id ends up inside a URL path: only our own UUID shape is ever allowed there (no path injection).
    if (!ORDER_ID_PATTERN.test(orderId)) {
      throw new PaymentProviderConfigError(this.name, "order_id tidak valid.");
    }

    let response: Response;
    try {
      response = await fetch(`${MIDTRANS_API_BASE}/v2/${encodeURIComponent(orderId)}/status`, {
        headers: { Authorization: this.authHeader(apiKey), Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch {
      throw new PaymentProviderConfigError(this.name, "Tidak dapat menghubungi Midtrans.");
    }

    if (!response.ok) {
      throw new PaymentProviderConfigError(
        this.name,
        `Gagal mengambil status pembayaran dari Midtrans (HTTP ${response.status}).`,
      );
    }

    const data = await this.readJson(response);
    const statusCode = asString(data.status_code);
    const transactionStatus = asString(data.transaction_status);
    const fraudStatus = asString(data.fraud_status);
    const responseOrderId = asString(data.order_id);
    const grossAmountRaw = data.gross_amount;
    const currency = asString(data.currency);

    // Midtrans can answer HTTP 200 with a body status_code of 404 for an unknown order: that is NOT a payment status.
    if (!statusCode || !transactionStatus || !responseOrderId || !currency || grossAmountRaw === undefined) {
      throw new PaymentProviderConfigError(this.name, "Respons status Midtrans tidak lengkap.");
    }
    if (responseOrderId !== orderId) {
      throw new PaymentProviderConfigError(this.name, "Respons status Midtrans untuk order yang berbeda.");
    }

    const amount = parseGrossAmount(grossAmountRaw);
    if (amount === null) {
      throw new PaymentProviderConfigError(this.name, "Nominal pada respons Midtrans tidak valid.");
    }

    // Defence in depth: when the status answer carries a signature, it must verify too.
    if (data.signature_key !== undefined) {
      const expected = computeMidtransSignature(responseOrderId, statusCode, String(grossAmountRaw), apiKey);
      if (!signatureMatches(data.signature_key, expected)) {
        throw new PaymentProviderConfigError(this.name, "Tanda tangan respons Midtrans tidak valid.");
      }
    }

    return {
      orderId: responseOrderId,
      gatewayTransactionId: asString(data.transaction_id) ?? null,
      status: mapMidtransStatus(transactionStatus, fraudStatus, statusCode),
      amount,
      currency,
      rawStatus: `${transactionStatus}${fraudStatus ? `/${fraudStatus}` : ""}/${statusCode}`,
    };
  }

  /**
   * Convenience view for callers that only need the coarse state (no activation ever comes from here). Refund /
   * chargeback / unrecognised states are reported as FAILED because they are definitely not a usable payment.
   */
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
    // Snap one-off payments only: there is no provider-side subscription object. Cancellation is app/DB level.
    throw new PaymentProviderConfigError(
      this.name,
      "Adapter Midtrans berjalan dalam mode pembayaran sekali bayar — tidak ada subscription di sisi provider untuk dibatalkan.",
    );
  }

  verifyWebhookSignature(rawBody: string, _signatureHeader: string | null): boolean {
    if (!this.isConfigured()) return false;
    const { apiKey } = serverEnv.payment;
    if (!apiKey) return false;

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return false;
    }
    if (!isRecord(payload)) return false;

    const { order_id, status_code, gross_amount, signature_key } = payload;
    // gross_amount must be the exact string Midtrans signed ("99000.00"); a re-serialised number cannot verify.
    if (typeof order_id !== "string" || typeof status_code !== "string" || typeof gross_amount !== "string") {
      return false;
    }

    return signatureMatches(signature_key, computeMidtransSignature(order_id, status_code, gross_amount, apiKey));
  }

  /**
   * Normalises a signature-checked notification. EVERYTHING returned here is an UNTRUSTED CLAIM (status, amount and
   * currency included): services/payment-verification.ts re-asks Midtrans and never activates from these values.
   */
  parseWebhookEvent(rawBody: string): ParsedWebhookEvent {
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new PaymentProviderConfigError(this.name, "Payload webhook Midtrans tidak valid (bukan JSON).");
    }
    if (!isRecord(payload)) {
      throw new PaymentProviderConfigError(this.name, "Payload webhook Midtrans tidak valid.");
    }

    const orderId = asString(payload.order_id);
    const transactionId = asString(payload.transaction_id);
    const transactionStatus = asString(payload.transaction_status);
    const statusCode = asString(payload.status_code);
    const fraudStatus = asString(payload.fraud_status);
    const amount = parseGrossAmount(payload.gross_amount);

    if (!orderId || !transactionId || !transactionStatus || !statusCode || amount === null) {
      throw new PaymentProviderConfigError(this.name, "Payload webhook Midtrans tidak lengkap.");
    }

    // Midtrans sends no per-delivery id. One logical event = this payment reaching this state, so a redelivery maps to
    // the same prompter_webhook_events row while a different state (settlement vs expire vs refund) gets its own.
    const externalEventId = [transactionId, transactionStatus, statusCode, fraudStatus ?? "-"].join(":");
    const claimed = mapMidtransStatus(transactionStatus, fraudStatus, statusCode);

    return {
      externalEventId,
      externalPaymentId: transactionId,
      eventType: `midtrans.${transactionStatus}`,
      status: claimed === "REFUNDED" || claimed === "CHARGEBACK" || claimed === "UNKNOWN" ? "FAILED" : claimed,
      amount,
      currency: asString(payload.currency) ?? "IDR",
      internalTransactionId: orderId,
    };
  }
}
