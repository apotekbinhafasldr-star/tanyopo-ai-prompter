import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, InvoiceStatus, SubscriptionPlan } from "@/types/database";

type Subscription = Database["public"]["Tables"]["prompter_subscriptions"]["Row"];
type Invoice = Database["public"]["Tables"]["prompter_invoices"]["Row"];

const DEFAULT_SUBSCRIPTION: Omit<Subscription, "tenant_id"> = {
  plan: "FREE",
  status: "ACTIVE",
  billing_provider: null,
  success_fee_rate_bps: null,
  current_period_start: null,
  current_period_end: null,
  billing_country: null,
  invoice_currency: null,
  payment_provider_customer_reference: null,
  tax_metadata: {},
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
};

/**
 * Loads the tenant's subscription, creating a FREE-plan row on first
 * access if none exists — same lazy-create pattern as
 * services/budget-guard.ts#getOrCreateBudgetPolicy() and
 * services/automation-settings.ts#getOrCreateAutomationSettings(). A
 * missing row never falls back to a paid plan; it falls back to the
 * safest state (Free, no processor, no fee).
 */
export async function getOrCreateSubscription(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<Subscription> {
  const { data: existing } = await supabase
    .from("prompter_subscriptions")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (existing) {
    return existing;
  }

  const { data: created } = await supabase
    .from("prompter_subscriptions")
    .insert({ tenant_id: tenantId })
    .select("*")
    .single();

  return created ?? { tenant_id: tenantId, ...DEFAULT_SUBSCRIPTION };
}

/**
 * Real AI usage this calendar month, from prompter_ai_jobs (already
 * written by every AI generation via services/ai-jobs.ts#runAiJob()) —
 * never a fabricated or estimated count.
 */
export async function getMonthlyAiJobCount(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  referenceDate: Date = new Date(),
): Promise<number> {
  const monthStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1)
    .toISOString()
    .slice(0, 10);

  const { count } = await supabase
    .from("prompter_ai_jobs")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .gte("created_at", monthStart);

  return count ?? 0;
}

/**
 * Sum of prompter_attributions.attributed_value where
 * attribution_model = 'UMKMPRO_VERIFIED' for the tenant this calendar
 * month — the only conversions the product spec allows a success fee to
 * be calculated from. Manual self-reported conversions and total
 * business revenue are never included.
 */
export async function getVerifiedAttributedValueThisMonth(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  referenceDate: Date = new Date(),
): Promise<number> {
  const monthStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1).toISOString();

  const { data, error } = await supabase
    .from("prompter_attributions")
    .select("attributed_value")
    .eq("tenant_id", tenantId)
    .eq("attribution_model", "UMKMPRO_VERIFIED")
    .gte("created_at", monthStart);

  if (error || !data) return 0;
  return data.reduce((sum, row) => sum + Number(row.attributed_value ?? 0), 0);
}

/** Real invoice rows for the tenant — empty until a real payment provider
 * actually issues one. Never a fabricated row. */
export async function listInvoices(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  limit = 20,
): Promise<Invoice[]> {
  const { data } = await supabase
    .from("prompter_invoices")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return data ?? [];
}

/**
 * Idempotent upsert for a real payment provider's invoice payload,
 * keyed on (provider, external_invoice_id) — a webhook redelivery
 * updates the same row (e.g. DRAFT -> PAID) rather than creating a
 * duplicate. Not called by anything yet (no provider is integrated),
 * ready for the payment webhook route a real adapter will add.
 */
export async function recordInvoiceFromProvider(
  admin: SupabaseClient<Database>,
  tenantId: string,
  input: {
    provider: string;
    externalInvoiceId: string;
    status: InvoiceStatus;
    amount: number | null;
    currency: string;
    description?: string | null;
    periodStart?: string | null;
    periodEnd?: string | null;
    issuedAt?: string | null;
    paidAt?: string | null;
  },
): Promise<{ invoiceId: string }> {
  const { data, error } = await admin
    .from("prompter_invoices")
    .upsert(
      {
        tenant_id: tenantId,
        provider: input.provider,
        external_invoice_id: input.externalInvoiceId,
        status: input.status,
        amount: input.amount,
        currency: input.currency,
        description: input.description ?? null,
        period_start: input.periodStart ?? null,
        period_end: input.periodEnd ?? null,
        issued_at: input.issuedAt ?? null,
        paid_at: input.paidAt ?? null,
      },
      { onConflict: "provider,external_invoice_id" },
    )
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Gagal menyimpan invoice.");
  }

  return { invoiceId: data.id };
}

/**
 * Owner-only plan change. Only ever changes the *stored* plan tier —
 * there is no payment provider configured to actually charge a proration
 * or new price, so this is a governance/usage-gating change today, not a
 * billing event. A real checkout (lib/billing/payment-provider.ts) will
 * drive this via a webhook once a provider exists, same as everywhere
 * else in this app: the write path already exists, only the trigger
 * changes later.
 */
export async function changePlan(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  plan: SubscriptionPlan,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("prompter_subscriptions")
    .upsert({ tenant_id: tenantId, plan });

  if (error) {
    return { error: "Gagal mengubah paket." };
  }

  return { error: null };
}
