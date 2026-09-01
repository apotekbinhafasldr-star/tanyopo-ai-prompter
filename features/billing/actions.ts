"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSessionContext } from "@/services/session";
import { changePlan } from "@/services/billing";
import type { SubscriptionPlan } from "@/types/database";

export interface BillingActionState {
  error: string | null;
}

const PLANS: SubscriptionPlan[] = ["FREE", "PRO", "BUSINESS", "GROWTH", "AGENCY", "UMKMPRO_BUNDLE"];

/**
 * Owner-only plan change (financial governance, same level as Budget
 * Guard settings). Only ever changes the stored plan tier — see
 * services/billing.ts#changePlan() for why this isn't a billing event
 * without a configured payment provider.
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
