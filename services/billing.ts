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

const UNIQUE_VIOLATION = "23505";

/** Thrown when the tenant's subscription row cannot be read or stored.
 * Message is generic on purpose (no database details). */
export class SubscriptionUnavailableError extends Error {
  constructor() {
    super("Subscription unavailable");
    this.name = "SubscriptionUnavailableError";
  }
}

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
  const { data: existing, error: selectError } = await supabase
    .from("prompter_subscriptions")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (selectError) {
    throw new SubscriptionUnavailableError();
  }

  if (existing) {
    return existing;
  }

  const now = new Date();
  const trialEnd = new Date(now.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);

  const { data: created, error: insertError } = await supabase
    .from("prompter_subscriptions")
    .insert({
      tenant_id: tenantId,
      status: "TRIALING",
      current_period_start: now.toISOString(),
      current_period_end: trialEnd.toISOString(),
    })
    .select("*")
    .single();

  if (!insertError && created) {
    return created;
  }

  // Concurrent first access: another request inserted the row first
  // (primary-key conflict on tenant_id). Return the stored winner row.
  if (insertError?.code === UNIQUE_VIOLATION) {
    const { data: winner, error: rereadError } = await supabase
      .from("prompter_subscriptions")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (!rereadError && winner) {
      return winner;
    }
  }

  // Never hand out a trial that was not stored: its period would come from
  // the app clock and exist nowhere else. Fail closed; callers show a
  // friendly error. Database details are deliberately not exposed.
  throw new SubscriptionUnavailableError();
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
 * duplicate. NOT the payment-receipt path: since P0-2 the invoice of a verified
 * payment is written by the database function fn_apply_verified_payment in the same
 * transaction as the activation (one PAID invoice per transaction_id). Nothing calls
 * this helper; do not use it for payments.
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
 * P0 plan-tampering fix: this no longer writes `prompter_subscriptions`
 * itself. Clients (anon/authenticated) hold NO UPDATE privilege on that
 * table (supabase/migrations/20261029220000_prompter_p0_subscription_plan_
 * tampering_lockdown.sql), so an app-level "is it TRIALING?" check here
 * could never be the security boundary — a direct REST call skips it. The
 * write goes through the SECURITY DEFINER RPC fn_set_trial_plan_preference,
 * which derives the tenant from the signed-in user (not from a parameter),
 * requires the Owner role, requires status TRIALING and an ACTIVE plan, and
 * records a PREFERENCE only: entitlement for TRIALING is always the FREE
 * numbers, so this grants no paid access.
 *
 * A paying tenant's plan can only change through a verified payment
 * (fn_apply_verified_payment, called by the payment webhook with the
 * service role) or fn_schedule_cancellation() (downgrade at period end) —
 * never through this self-service action.
 *
 * Batch B9 P1-1: rejects any plan whose lib/billing/plans.ts availability
 * is not "ACTIVE" (e.g. Agency, still COMING_SOON) before reaching the
 * database — backstopped by the DB-level plan-availability trigger and by
 * the RPC itself, so the rule holds even for a call that bypasses this
 * function entirely.
 */
export async function changePlan(
  supabase: SupabaseClient<Database>,
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

  const { data, error } = await supabase.rpc("fn_set_trial_plan_preference", { p_plan: plan });

  if (error) {
    return { error: "Gagal mengubah paket." };
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.out_ok) {
    return { error: planPreferenceErrorMessage(result?.out_reason ?? null) };
  }

  return { error: null };
}

function planPreferenceErrorMessage(reason: string | null): string {
  switch (reason) {
    case "NOT_TRIALING":
      return "Paket Anda sudah aktif berdasarkan pembayaran. Gunakan Upgrade atau Downgrade untuk mengubah paket.";
    case "NOT_OWNER":
      return "Hanya Owner yang dapat mengubah paket.";
    case "PLAN_NOT_AVAILABLE":
      return "Paket ini belum dapat dipilih (segera hadir).";
    default:
      return "Gagal mengubah paket.";
  }
}
