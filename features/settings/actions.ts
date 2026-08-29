"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSessionContext } from "@/services/session";
import { budgetPolicySchema } from "@/schemas/budget";

export interface SettingsActionState {
  error: string | null;
}

export async function updateBudgetPolicyAction(
  _prevState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const session = await requireSessionContext();

  if (session.role !== "owner") {
    return { error: "Hanya Owner yang dapat mengubah Budget Guard." };
  }

  const parsed = budgetPolicySchema.safeParse({
    dailyLimit: formData.get("dailyLimit") || undefined,
    monthlyLimit: formData.get("monthlyLimit") || undefined,
    campaignLimit: formData.get("campaignLimit") || undefined,
    requireApprovalAbove: formData.get("requireApprovalAbove") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data tidak valid" };
  }

  const supabase = await createClient();

  const { error } = await supabase.from("prompter_budget_policies").upsert({
    tenant_id: session.tenantId,
    daily_limit: parsed.data.dailyLimit ?? null,
    monthly_limit: parsed.data.monthlyLimit ?? null,
    campaign_limit: parsed.data.campaignLimit ?? null,
    require_approval_above: parsed.data.requireApprovalAbove ?? null,
  });

  if (error) {
    return { error: "Gagal menyimpan Budget Guard." };
  }

  await supabase.from("prompter_audit_logs").insert({
    tenant_id: session.tenantId,
    actor_user_id: session.userId,
    action: "budget_policy.updated",
    resource_type: "prompter_budget_policies",
    resource_id: null,
    context: {
      daily_limit: parsed.data.dailyLimit ?? null,
      monthly_limit: parsed.data.monthlyLimit ?? null,
      campaign_limit: parsed.data.campaignLimit ?? null,
      require_approval_above: parsed.data.requireApprovalAbove ?? null,
    },
  });

  revalidatePath("/settings");
  return { error: null };
}
