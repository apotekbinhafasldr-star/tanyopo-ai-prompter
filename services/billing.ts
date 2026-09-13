import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, InvoiceStatus, SubscriptionPlan } from "@/types/database";
import { findPlanTier } from "@/lib/billing/plans";

type Subscription = Database["public"]["Tables"]["prompter_subscriptions"]["Row"];
type Invoice = Database["public"]["Tables"]["prompter_invoices"]["Row"];

/** A new tenant's one and only trial window — server/DB-driven (not
 * client/localStorage), started exactly once at subscription-row creation
 * and never renewable by refreshing or clearing browser state. */
export const TRIAL_DURATION_DAYS = 14;

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
  cancel_at_period_end: false,
  provider_subscription_id: null,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
};

/**
 * Loads the tenant's subscription, starting a real 14-day trial on first
 * access if no row exists yet — same lazy-create pattern as
 * services/budget-guard.ts#getOrCreateBudgetPolicy() and
 * services/automation-settings.ts#getOrCreateAutomationSettings(). Once
 * created, `current_period_start/end` and `status: 'TRIALING'` are fixed for
 * that tenant — there is no code path that resets or extends them, so this
 * is a one-time, per-workspace trial, not a per-session or per-browser one.
 * A row that already existed before this change (status ACTIVE, no period
 * set) is left untouched — see getTrialState()'s handling of that case.
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

  const now = new Date();
  const trialEnd = new Date(now.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);

  const { data: created } = await supabase
    .from("prompter_subscriptions")
    .insert({
      tenant_id: tenantId,
      status: "TRIALING",
      current_period_start: now.toISOString(),
      current_period_end: trialEnd.toISOString(),
    })
    .select("*")
    .single();

  return (
    created ?? {
      tenant_id: tenantId,
      ...DEFAULT_SUBSCRIPTION,
      status: "TRIALING",
      current_period_start: now.toISOString(),
      current_period_end: trialEnd.toISOString(),
    }
  );
}

export interface TrialState {
  isTrialing: boolean;
  /** null when not trialing, or for a legacy pre-trial row with no period set. */
  daysRemaining: number | null;
  expired: boolean;
}

/** Pure, no I/O — derives trial status/remaining days from a subscription
 * row already loaded via getOrCreateSubscription(). */
export function getTrialState(subscription: Subscription, referenceDate: Date = new Date()): TrialState {
  if (subscription.status !== "TRIALING" || !subscription.current_period_end) {
    return { isTrialing: false, daysRemaining: null, expired: false };
  }

  const end = new Date(subscription.current_period_end);
  const msRemaining = end.getTime() - referenceDate.getTime();
  const daysRemaining = Math.max(0, Math.ceil(msRemaining / (24 * 60 * 60 * 1000)));

  return { isTrialing: true, daysRemaining, expired: msRemaining <= 0 };
}

/**
 * Real AI usage this calendar month, from prompter_ai_jobs (already
 * written by every AI generation via services/ai-jobs.ts#runAiJob()) —
 * never a fabricated or estimated count. Display-only (Billing page's
 * "Penggunaan AI Bulan Ini" card) — actual enforcement of both the trial
 * allowance and every paid plan's aiUsageAllowance now happens atomically
 * in the database via fn_create_ai_job_if_entitled() (Batch B9), which
 * services/ai-jobs.ts#runAiJob() calls directly instead of doing a
 * separate check-then-insert here.
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
 * Owner-only plan PREFERENCE change — only for a tenant that has never
 * had a real, paid subscription (still TRIALING). Only ever changes the
 * stored `plan` column, never `status`.
 *
 * Deliberately never writes `status`. This used to unconditionally set
 * `status: "ACTIVE"`, which let anyone self-activate for free with no
 * payment, permanently bypassing the 14-day trial cutoff simply by saving
 * a plan on this page. Moving a subscription to ACTIVE is a real billing
 * event and belongs exclusively to fn_apply_verified_payment() (Batch
 * B10, supabase/migrations/20260913090000_prompter_b10_payment_billing_core.sql),
 * called only from the payment webhook route after a verified payment —
 * never to this self-service action.
 *
 * Batch B9 P1-1: rejects any plan whose lib/billing/plans.ts availability
 * is not "ACTIVE" (e.g. Agency, still COMING_SOON) before ever reaching
 * the database — backstopped by the DB-level
 * fn_guard_subscription_plan_availability trigger on
 * prompter_subscriptions, so the rule holds even for a write that bypasses
 * this function entirely.
 *
 * Batch B10 A.2: rejects the change entirely once the tenant has a real
 * paid subscription (status ACTIVE or PAST_DUE). Without this, a tenant
 * already paying for Starter could call this to set `plan: "BUSINESS"`
 * and instantly receive Business's entitlement (per B9's
 * prompter_plan_entitlements lookup) with no new payment ever verified —
 * this function only ever changes a *preference* while nothing has been
 * paid for yet (TRIALING); a paying tenant's plan can only change via a
 * verified checkout (upgrade) or fn_schedule_cancellation() (downgrade at
 * period end).
 */
export async function changePlan(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  plan: SubscriptionPlan,
): Promise<{ error: string | null }> {
  // findPlanTier() deliberately excludes UMKMPRO_BUNDLE (a separate
  // cross-sell bundle belonging to the sibling UMKMpro AI product, out of
  // B8/B9's pricing scope) — `undefined` here means "not one of the six
  // public tiers," not "unknown/invalid," so only reject a plan this
  // config actually tracks as not yet ready (Agency).
  const tier = findPlanTier(plan);
  if (tier && tier.availability !== "ACTIVE") {
    return { error: "Paket ini belum dapat dipilih (segera hadir)." };
  }

  const { data: existing } = await supabase
    .from("prompter_subscriptions")
    .select("status")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (existing && existing.status !== "TRIALING") {
    return {
      error: "Paket Anda sudah aktif berdasarkan pembayaran. Gunakan Upgrade atau Downgrade untuk mengubah paket.",
    };
  }

  const { error } = await supabase.from("prompter_subscriptions").update({ plan }).eq("tenant_id", tenantId);

  if (error) {
    return { error: "Gagal mengubah paket." };
  }

  return { error: null };
}
