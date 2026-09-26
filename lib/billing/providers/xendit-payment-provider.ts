import "server-only";

import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";
import {
  PaymentProviderConfigError,
  type CheckoutSessionInput,
  type CheckoutSessionResult,
  type ParsedWebhookEvent,
  type PaymentProvider,
  type RemotePaymentStatus,
} from "@/lib/billing/payment-provider";

const XENDIT_API_BASE = "https://api.xendit.co";

/**
 * Batch B11 — Xendit adapter. Xendit uses the same API host for sandbox
 * and production; the two are distinguished only by which secret key is
 * used ("xnd_development_..." vs "xnd_production_..."). Uses Xendit's
 * Invoice API (a hosted checkout page covering QRIS/VA/e-wallet/card/
 * retail in one product) rather than Xendit's separate Recurring
 * product — this matches the existing one-
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
 *
 * Payment Remediation (post-B11 audit) — isConfigured() recognizes
 * EITHER a sandbox ("xnd_development_...") or a production
 * ("xnd_production_...") shaped key, plus a webhook secret, as valid
 * configuration. This does not by itself enable real charges: no
 * production credential is set anywhere in this codebase/environment,
 * and going live still requires the Founder to actually provision and
 * configure real Xendit production credentials — a separate, explicit
 * business/infrastructure decision, not something this code change
 * makes. What changes here is only that the code no longer actively
 * *refuses* a correctly-shaped production key merely for being
 * production-shaped; it still refuses anything that isn't a recognized
 * Xendit key shape at all (empty, malformed, or missing webhook secret).
 */
const XENDIT_KEY_PREFIXES = ["xnd_development_", "xnd_production_"] as const;

export class XenditPaymentProvider implements PaymentProvider {
  readonly name = "xendit";

  isConfigured(): boolean {
    const { apiKey, webhookSecret } = serverEnv.payment;
    return !!apiKey && XENDIT_KEY_PREFIXES.some((prefix) => apiKey.startsWith(prefix)) && !!webhookSecret;
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
