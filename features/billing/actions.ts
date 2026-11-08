"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { requireSessionContext } from "@/services/session";
import { changePlan } from "@/services/billing";
import { startCheckout } from "@/services/checkout";
import { publicEnv } from "@/lib/env";
import { resolveCheckoutOriginFromHeader } from "@/lib/billing/checkout-origin";
import type { SubscriptionPlan } from "@/types/database";

export interface BillingActionState {
  error: string | null;
}

const PLANS: SubscriptionPlan[] = ["FREE", "STARTER", "PRO", "BUSINESS", "GROWTH", "AGENCY", "UMKMPRO_BUNDLE"];

/**
 * Owner-only plan change (financial governance, same level as Budget
 * Guard settings). Only ever changes the stored plan tier — see
 * services/billing.ts#changePlan() for why this isn't a billing event
 * without a configured payment provider.
 *
 * `PLANS` below only checks that the submitted string is a real
 * SubscriptionPlan identifier at all. Batch B9 P1-1: whether that plan is
 * currently *sellable* (e.g. Agency is still COMING_SOON) is
 * changePlan()'s own job, backstopped by a DB trigger on
 * prompter_subscriptions — this action never re-implements that check
 * itself, to avoid a second, driftable copy of the same rule.
 */
export async function changePlanAction(
  _prevState: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  const session = await requireSessionContext();

  if (session.role !== "owner") {
    return { error: "Hanya Owner yang dapat mengubah paket." };
  }

  const plan = formData.get("plan");
  if (typeof plan !== "string" || !PLANS.includes(plan as SubscriptionPlan)) {
    return { error: "Paket tidak valid." };
  }

  const supabase = await createClient();
  const result = await changePlan(supabase, plan as SubscriptionPlan);

  if (result.error) {
    return result;
  }

  await supabase.from("prompter_audit_logs").insert({
    tenant_id: session.tenantId,
    actor_user_id: session.userId,
    action: "subscription.plan_changed",
    resource_type: "prompter_subscriptions",
    resource_id: null,
    context: { plan },
  });

  revalidatePath("/billing");
  return { error: null };
}

/**
 * Batch B11 hotfix + C3 — the checkout redirect origin must match the deployment that actually started the checkout
 * (Deploy Preview vs. Production), but the raw `Origin` header is no longer trusted on its own: it is used only when it
 * is exactly one of the allowlisted origins (publicEnv.appUrl, CHECKOUT_ALLOWED_ORIGINS, Netlify's DEPLOY_PRIME_URL /
 * DEPLOY_URL — see lib/billing/checkout-origin.ts). Anything else falls back to publicEnv.appUrl, so a forged or
 * unexpected Origin can never become the payer's return address.
 */
async function resolveCheckoutOrigin(): Promise<string> {
  const headerList = await headers();
  return resolveCheckoutOriginFromHeader(headerList.get("origin"), {
    appUrl: publicEnv.appUrl,
    extraOrigins: process.env.CHECKOUT_ALLOWED_ORIGINS,
    deployUrls: [process.env.DEPLOY_PRIME_URL, process.env.DEPLOY_URL],
  });
}

/**
 * Batch B10 — checkout core entry point (Bagian G of the brief). Never
 * accepts a price from the client: services/checkout.ts#startCheckout()
 * always looks up the canonical amount from lib/billing/plans.ts
 * server-side. Fails closed with an honest error (no redirect at all)
 * when the configured PaymentProvider isn't ready — NullPaymentProvider,
 * always, until a real processor is chosen — rather than ever showing a
 * fake checkout.
 */
export async function startCheckoutAction(
  _prevState: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  const session = await requireSessionContext();

  if (session.role !== "owner") {
    return { error: "Hanya Owner yang dapat memulai pembayaran." };
  }

  const plan = formData.get("plan");
  if (typeof plan !== "string" || !PLANS.includes(plan as SubscriptionPlan)) {
    return { error: "Paket tidak valid." };
  }

  const origin = await resolveCheckoutOrigin();
  const result = await startCheckout({
    tenantId: session.tenantId,
    userId: session.userId,
    plan: plan as SubscriptionPlan,
    successUrl: `${origin}/billing?checkout=success`,
    cancelUrl: `${origin}/billing?checkout=cancelled`,
  });

  if (!result.ok || !result.checkoutUrl) {
    return { error: result.error ?? "Gagal memulai proses pembayaran." };
  }

  redirect(result.checkoutUrl);
}

/**
 * Batch B10 — "cancel at period end" (Bagian D). Owner-only toggle via
 * fn_schedule_cancellation() — never sets `status` itself; access stays
 * ACTIVE until current_period_end, matching the no-proration soft-launch
 * cancellation policy.
 */
export async function scheduleCancellationAction(cancel: boolean): Promise<BillingActionState> {
  const session = await requireSessionContext();

  if (session.role !== "owner") {
    return { error: "Hanya Owner yang dapat mengubah status pembatalan." };
  }

  const supabase = await createClient();
  const { data: rows, error } = await supabase.rpc("fn_schedule_cancellation", { p_cancel: cancel });
  const row = (Array.isArray(rows) ? rows[0] : rows) as { allowed: boolean; reason: string | null } | undefined;

  revalidatePath("/billing");

  if (error || !row?.allowed) {
    return { error: "Gagal memperbarui status pembatalan. Silakan coba lagi." };
  }

  await supabase.from("prompter_audit_logs").insert({
    tenant_id: session.tenantId,
    actor_user_id: session.userId,
    action: cancel ? "subscription.cancellation_scheduled" : "subscription.cancellation_undone",
    resource_type: "prompter_subscriptions",
    resource_id: null,
    context: {},
  });

  return { error: null };
}
