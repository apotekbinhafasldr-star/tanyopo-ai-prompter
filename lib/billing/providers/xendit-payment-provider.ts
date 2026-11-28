import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { publicEnv, serverEnv } from "@/lib/env";
import { evaluatePaymentEnvironment } from "@/lib/billing/providers/payment-env-guard";
import type { PaymentEnvStamp } from "@/lib/billing/payment-env-stamp";
import {
  PaymentProviderConfigError,
  type CheckoutSessionInput,
  type CheckoutSessionResult,
  type ParsedWebhookEvent,
  type PaymentProvider,
  type PaymentReasonCode,
  type RemotePaymentStatus,
  type VerifiedPayment,
  type VerifiedPaymentStatus,
} from "@/lib/billing/payment-provider";

const XENDIT_API_BASE = "https://api.xendit.co";

/** Hard ceilings so a slow or hostile gateway answer can never hold a request open or exhaust memory. */
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const ORDER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * D3 — sandbox key prefix + the two-way database guard (Xendit has no live mode in this codebase: a production key is
 * refused). Returns the proven database project ref, or null when the adapter must stay OFF.
 */
function resolveXenditRuntimeRef(): string | null {
  const { apiKey, webhookSecret } = serverEnv.payment;
  if (!apiKey || !apiKey.startsWith("xnd_development_") || !webhookSecret) return null;
  const guard = evaluatePaymentEnvironment({
    mode: "sandbox",
    supabaseUrl: publicEnv.supabaseUrl,
    sandboxRefs: serverEnv.payment.sandboxDbRefs,
    serviceKey: serverEnv.supabaseSecretKey,
  });
  return guard.ok ? guard.ref : null;
}

/**
 * Batch B11 — Xendit adapter, SANDBOX ONLY by explicit founder mandate
 * (PT Tanyopo Technology, company bank account, and a real merchant
 * account do not exist yet). Xendit uses the same API host for sandbox
 * and production; the two are distinguished only by which secret key is
 * used ("xnd_development_..." vs "xnd_production_..."). isConfigured()
 * below is therefore the actual production-payment guard, not just a
 * procedural one: a production-shaped key makes this adapter report
 * itself unconfigured, which makes every caller (services/checkout.ts,
 * services/payment-webhook.ts) fail closed with the same honest
 * "belum dikonfigurasi" behavior as having no key at all. Do not relax
 * this check to "just needs to be non-empty" without a separate,
 * explicit founder approval for production activation.
 *
 * Uses Xendit's Invoice API (a hosted checkout page covering QRIS/VA/
 * e-wallet/card/retail in one product) rather than Xendit's separate
 * Recurring product — this matches the existing one-
 * prompter_payment_transactions-row-per-checkout-attempt model exactly,
 * so no change to services/checkout.ts's shape was needed.
 * prompter_subscriptions.provider_subscription_id (added by B10) stays
 * null under this adapter; a persistent Xendit subscription object is a
 * possible future enhancement, not required to prove the sandbox path.
 *
 * Xendit's webhook verification is a static shared-secret token
 * comparison (the dashboard-configured "Callback Verification Token"
 * sent back as the `x-callback-token` header) — not HMAC — but is still
 * compared in constant time here, same pattern as
 * lib/umkmpro/signature.ts's verifyUmkmproSignature().
 */
export class XenditPaymentProvider implements PaymentProvider {
  readonly name = "xendit";

  isConfigured(): boolean {
    return resolveXenditRuntimeRef() !== null;
  }

  runtimeEnvironment(): PaymentEnvStamp | null {
    const dbRef = resolveXenditRuntimeRef();
    return dbRef ? { env: "sandbox", dbRef } : null;
  }

  private requireConfig(): { apiKey: string } {
    const { apiKey } = serverEnv.payment;
    if (!this.isConfigured() || !apiKey) {
      throw new PaymentProviderConfigError(
        this.name,
        "Xendit belum dikonfigurasi dengan sandbox key yang valid.",
      );
    }
    return { apiKey };
  }

  private authHeader(apiKey: string): string {
    // Xendit authenticates via HTTP Basic Auth: the secret key as the
    // username, blank password.
    return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
  }

  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    const { apiKey } = this.requireConfig();

    let response: Response;
    try {
      response = await fetch(`${XENDIT_API_BASE}/v2/invoices`, {
        method: "POST",
        headers: {
          Authorization: this.authHeader(apiKey),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          external_id: input.internalTransactionId,
          amount: input.amountIDR,
          currency: "IDR",
          description: `LINOE — paket ${input.plan}`,
          success_redirect_url: input.successUrl,
          failure_redirect_url: input.cancelUrl,
        }),
      });
    } catch {
      throw new PaymentProviderConfigError(this.name, "Tidak dapat menghubungi Xendit.");
    }

    if (!response.ok) {
      throw new PaymentProviderConfigError(
        this.name,
        `Xendit menolak permintaan checkout (HTTP ${response.status}).`,
      );
    }

    const data = (await response.json()) as { id?: string; invoice_url?: string };
    if (!data.id || !data.invoice_url) {
      throw new PaymentProviderConfigError(this.name, "Respons checkout Xendit tidak lengkap.");
    }

    return { checkoutUrl: data.invoice_url, externalSessionId: data.id };
  }

  async getPaymentStatus(externalPaymentId: string): Promise<RemotePaymentStatus> {
    const { apiKey } = this.requireConfig();

    let response: Response;
    try {
      response = await fetch(`${XENDIT_API_BASE}/v2/invoices/${encodeURIComponent(externalPaymentId)}`, {
        headers: { Authorization: this.authHeader(apiKey) },
      });
    } catch {
      throw new PaymentProviderConfigError(this.name, "Tidak dapat menghubungi Xendit.");
    }

    if (!response.ok) {
      throw new PaymentProviderConfigError(
        this.name,
        `Gagal mengambil status pembayaran dari Xendit (HTTP ${response.status}).`,
      );
    }

    const data = (await response.json()) as { status?: string };
    return mapXenditStatus(data.status);
  }

  /**
   * D3 phase C — asks Xendit server-to-server for the authoritative state of the invoice created for one of OUR
   * transactions (found by external_id = our transaction id), so activation never depends on a webhook body. Fails closed:
   * any timeout, non-2xx, oversized / non-JSON answer, zero or several matching invoices, or a PAID answer without the
   * invoice id, a paid amount or IDR currency THROWS. Unrecognised statuses are UNKNOWN (never PAID, never used to close).
   * Field names (`paid_amount`, `SETTLED`) are NOT yet proven against the Xendit sandbox (see docs).
   */
  async getVerifiedPayment(orderId: string): Promise<VerifiedPayment> {
    const { apiKey } = this.requireConfig();
    const fail = (message: string, code: PaymentReasonCode): never => {
      throw new PaymentProviderConfigError(this.name, message, code);
    };

    // order_id ends up in a query string: only our own UUID shape is ever allowed there.
    if (!ORDER_ID_PATTERN.test(orderId)) return fail("order_id tidak valid.", "ORDER_MISMATCH");

    let response: Response;
    try {
      response = await fetch(`${XENDIT_API_BASE}/v2/invoices?external_id=${encodeURIComponent(orderId)}`, {
        headers: { Authorization: this.authHeader(apiKey), Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === "TimeoutError";
      return fail("Tidak dapat menghubungi Xendit.", timedOut ? "GATEWAY_TIMEOUT" : "GATEWAY_UNREACHABLE");
    }
    if (!response.ok) return fail(`Gagal mengambil status pembayaran dari Xendit (HTTP ${response.status}).`, "GATEWAY_REJECTED");

    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) return fail("Respons Xendit terlalu besar.", "RESPONSE_NOT_JSON");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return fail("Respons Xendit bukan JSON yang valid.", "RESPONSE_NOT_JSON");
    }

    // The list endpoint answers an array. Exactly ONE invoice for this external_id is acceptable; zero or several is ambiguous.
    const matching = (Array.isArray(parsed) ? parsed : [parsed]).filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null && !Array.isArray(item) && (item as Record<string, unknown>).external_id === orderId,
    );
    if (matching.length !== 1) return fail("Invoice Xendit untuk order ini tidak ditemukan atau ganda.", "ORDER_MISMATCH");
    const invoice = matching[0];

    const invoiceId = typeof invoice.id === "string" && invoice.id.length > 0 ? invoice.id : null;
    const rawStatus = typeof invoice.status === "string" && invoice.status.length > 0 ? invoice.status : null;
    if (!invoiceId) return fail("Respons Xendit tanpa id invoice.", "REFERENCE_MISSING");
    if (!rawStatus) return fail("Respons status Xendit tidak lengkap.", "STATUS_INCOMPLETE");

    const status = mapXenditVerifiedStatus(rawStatus);
    const currency = typeof invoice.currency === "string" && invoice.currency.length > 0 ? invoice.currency : null;
    const paidAmount = invoice.paid_amount;
    const invoiceAmount = invoice.amount;
    let amount = 0;
    if (status === "PAID") {
      if (currency === null) return fail("Respons Xendit tanpa mata uang.", "CURRENCY_MISSING");
      if (currency !== "IDR") return fail("Mata uang Xendit bukan IDR.", "CURRENCY_NOT_IDR");
      if (typeof paidAmount !== "number" || !Number.isFinite(paidAmount) || paidAmount < 0) {
        return fail("Respons Xendit tanpa nominal terbayar.", "AMOUNT_MISSING");
      }
      amount = paidAmount;
    } else if (typeof invoiceAmount === "number" && Number.isFinite(invoiceAmount) && invoiceAmount >= 0) {
      amount = invoiceAmount;
    }

    return {
      orderId,
      eventRef: `gw:${createHash("sha256").update(`${invoiceId}|${rawStatus}`).digest("hex").slice(0, 40)}`,
      eventRefBasis: "status_only",
      gatewayTransactionId: invoiceId,
      status,
      amount,
      currency: currency ?? "IDR",
      rawStatus,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept named/typed so callers get real arity checking against the PaymentProvider interface, same convention as NullPaymentProvider.
  async cancelSubscription(externalSubscriptionId: string): Promise<void> {
    // Invoice-only mode (B11 sandbox scope): there is no persistent
    // Xendit subscription object to cancel. Cancellation is handled
    // entirely at the app/DB level — fn_schedule_cancellation() /
    // fn_apply_scheduled_cancellations() (Batch B10) — which never call
    // out to the provider. This method exists only to satisfy the
    // PaymentProvider contract and is not on any code path B11 exercises.
    throw new PaymentProviderConfigError(
      this.name,
      "Xendit adapter berjalan dalam mode Invoice — tidak ada subscription object di sisi provider untuk dibatalkan.",
    );
  }

  verifyWebhookSignature(_rawBody: string, signatureHeader: string | null): boolean {
    if (!this.isConfigured() || !signatureHeader) return false;

    const { webhookSecret } = serverEnv.payment;
    if (!webhookSecret) return false;

    const expected = Buffer.from(webhookSecret);
    const actual = Buffer.from(signatureHeader);

    // timingSafeEqual throws on length mismatch rather than returning
    // false — guard that first so a wrong-length header never becomes an
    // error path an attacker could distinguish from a genuine mismatch.
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  parseWebhookEvent(rawBody: string): ParsedWebhookEvent {
    let payload: XenditInvoiceCallbackPayload;
    try {
      payload = JSON.parse(rawBody) as XenditInvoiceCallbackPayload;
    } catch {
      throw new PaymentProviderConfigError(this.name, "Payload webhook Xendit tidak valid (bukan JSON).");
    }

    if (!payload.id || !payload.status) {
      throw new PaymentProviderConfigError(this.name, "Payload webhook Xendit tidak lengkap.");
    }

    // Xendit's Invoice callback carries one `id` per invoice, not a
    // separate per-delivery event id — a redelivery of the same invoice
    // event repeats the same `id`, which is exactly what the
    // (source_system, external_event_id) unique constraint on
    // prompter_webhook_events needs to dedupe correctly.
    return {
      externalEventId: payload.id,
      externalPaymentId: payload.id,
      eventType: `invoice.${payload.status.toLowerCase()}`,
      status: mapXenditStatus(payload.status),
      amount: payload.paid_amount ?? payload.amount ?? 0,
      currency: payload.currency ?? "IDR",
      internalTransactionId: payload.external_id ?? null,
    };
  }
}

/** Shape of the fields this adapter reads from a Xendit Invoice callback
 * body — deliberately minimal (only what parseWebhookEvent() uses), not a
 * full mirror of Xendit's actual payload. */
interface XenditInvoiceCallbackPayload {
  id: string;
  external_id?: string;
  status: string;
  amount?: number;
  paid_amount?: number;
  currency?: string;
}

/** D3: stricter mapping for the server-verified answer — anything not explicitly recognised is UNKNOWN, never FAILED or PAID. */
function mapXenditVerifiedStatus(status: string): VerifiedPaymentStatus {
  switch (status) {
    case "PAID":
    case "SETTLED":
      return "PAID";
    case "EXPIRED":
      return "EXPIRED";
    case "PENDING":
      return "PENDING";
    default:
      return "UNKNOWN";
  }
}

function mapXenditStatus(status: string | undefined): RemotePaymentStatus {
  switch (status) {
    case "PAID":
    case "SETTLED":
      return "PAID";
    case "EXPIRED":
      return "EXPIRED";
    case "PENDING":
      return "PENDING";
    default:
      // Unrecognized/unknown status is treated as FAILED, never as PAID —
      // failing closed on an unexpected Xendit status is safer than
      // guessing it means success.
      return "FAILED";
  }
}
