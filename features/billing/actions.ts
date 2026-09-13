"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSessionContext } from "@/services/session";
import { changePlan } from "@/services/billing";
import { startCheckout } from "@/services/checkout";
import { publicEnv } from "@/lib/env";
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
  const result = await changePlan(supabase, session.tenantId, plan as SubscriptionPlan);

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

  const supabase = await createClient();
  const result = await startCheckout(supabase, {
    tenantId: session.tenantId,
    userId: session.userId,
    plan: plan as SubscriptionPlan,
    successUrl: `${publicEnv.appUrl}/billing?checkout=success`,
    cancelUrl: `${publicEnv.appUrl}/billing?checkout=cancelled`,
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
