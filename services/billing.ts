import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, InvoiceStatus, SubscriptionPlan } from "@/types/database";

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

export interface EntitlementCheckResult {
  allowed: boolean;
  reason: string | null;
}

/**
 * The one server-side gate a trial needs to actually mean something:
 * called from services/ai-jobs.ts#runAiJob() before every AI generation, so
 * an expired trial can't keep generating AI output regardless of what the
 * client sends. A tenant that was ever moved to a real plan/status (via
 * changePlan(), or a pre-existing ACTIVE row from before this trial system
 * existed) is never blocked here — this only ever stops a TRIALING tenant
 * whose period has actually elapsed.
 */
export function checkAiUsageEntitlement(subscription: Subscription, referenceDate: Date = new Date()): EntitlementCheckResult {
  const trial = getTrialState(subscription, referenceDate);

  if (trial.isTrialing && trial.expired) {
    return {
      allowed: false,
      // Never tells the user to "pilih paket" to continue — changePlan()
      // never touches status/entitlement (see its own docstring), so that
      // would be a false instruction. Honest until a real payment
      // processor exists: the feature is simply paused.
      reason: `Masa trial ${TRIAL_DURATION_DAYS} hari Anda telah berakhir. Pembayaran online belum tersedia, jadi fitur AI dijeda sementara.`,
    };
  }

  return { allowed: true, reason: null };
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
 * Real AI usage today (server UTC day boundary — same convention as
 * getMonthlyAiJobCount()'s UTC month boundary), from prompter_ai_jobs.
 * Never a fabricated or estimated count.
 */
export async function getDailyAiJobCount(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  referenceDate: Date = new Date(),
): Promise<number> {
  const dayStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate())
    .toISOString()
    .slice(0, 10);

  const { count } = await supabase
    .from("prompter_ai_jobs")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .gte("created_at", dayStart);

  return count ?? 0;
}

/** A TRIALING tenant's server-side AI cost ceiling — bounds real
 * OpenAI/Anthropic spend even within an otherwise-valid 14-day trial.
 * Never applied once a subscription has moved off TRIALING (see
 * checkTrialAiUsageCap()) — this is a trial-safety limit, not a
 * plan-tier feature limit. */
export const TRIAL_DAILY_AI_JOB_LIMIT = 20;
export const TRIAL_MONTHLY_AI_JOB_LIMIT = 100;

/**
 * The second server-side AI-cost gate, alongside checkAiUsageEntitlement():
 * that function stops AI use once a trial's 14 days have elapsed;
 * this one bounds AI use *during* an otherwise-valid trial, so a single
 * tenant can't run unlimited real AI calls in one day or one month while
 * still inside their trial window. Only ever evaluated for `TRIALING` —
 * an ACTIVE subscription (a legitimate pre-existing row, or once a real
 * payment provider exists, a genuinely paid one) is never capped here;
 * that would be a separate, future, plan-based limit, not this one.
 */
export async function checkTrialAiUsageCap(
  supabase: SupabaseClient<Database>,
  subscription: Subscription,
  referenceDate: Date = new Date(),
): Promise<EntitlementCheckResult> {
  if (subscription.status !== "TRIALING") {
    return { allowed: true, reason: null };
  }

  const dailyCount = await getDailyAiJobCount(supabase, subscription.tenant_id, referenceDate);
  if (dailyCount >= TRIAL_DAILY_AI_JOB_LIMIT) {
    return {
      allowed: false,
      // Same honesty rule as checkAiUsageEntitlement() above — selecting a
      // plan does not lift this limit, so never imply it does.
      reason: `Anda telah mencapai batas ${TRIAL_DAILY_AI_JOB_LIMIT} permintaan AI hari ini selama masa trial. Coba lagi besok.`,
    };
  }

  const monthlyCount = await getMonthlyAiJobCount(supabase, subscription.tenant_id, referenceDate);
  if (monthlyCount >= TRIAL_MONTHLY_AI_JOB_LIMIT) {
    return {
      allowed: false,
      reason: `Anda telah mencapai batas ${TRIAL_MONTHLY_AI_JOB_LIMIT} permintaan AI bulan ini selama masa trial. Batas ini akan direset di awal bulan berikutnya.`,
    };
  }

  return { allowed: true, reason: null };
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
 * or new price, so this is a governance/preference change today, not a
 * billing event.
 *
 * Deliberately never writes `status`. This used to unconditionally set
 * `status: "ACTIVE"`, which — because checkAiUsageEntitlement() only
 * blocks a TRIALING tenant whose period has elapsed — let anyone
 * self-activate for free with no payment, permanently bypassing the
 * 14-day trial cutoff simply by saving a plan on this page. Moving a
 * subscription to ACTIVE is a real billing event and belongs to a real
 * payment provider's webhook (lib/billing/payment-provider.ts) once one
 * is integrated — not to this self-service action. Until then, a tenant's
 * existing status (TRIALING, or a legitimate pre-existing ACTIVE row) is
 * left exactly as it was.
 */
export async function changePlan(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  plan: SubscriptionPlan,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("prompter_subscriptions").upsert({ tenant_id: tenantId, plan });

  if (error) {
    return { error: "Gagal mengubah paket." };
  }

  return { error: null };
}
