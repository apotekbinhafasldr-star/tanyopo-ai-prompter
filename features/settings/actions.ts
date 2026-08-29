"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSessionContext } from "@/services/session";
import { budgetPolicySchema } from "@/schemas/budget";
import type { AutomationMode, AutopilotPolicyType } from "@/types/database";

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

const AUTOMATION_MODES: AutomationMode[] = ["manual", "ai_assist", "autopilot"];

/**
 * Owner-only, even though RLS on prompter_automation_settings itself
 * allows owner/marketing to write (Phase 0 default) — switching a tenant
 * into 'autopilot' mode is real automation-scope authorization (product
 * spec's Autopilot "tenant authorization" boundary), so the app layer
 * holds it to the same stricter bar as Budget Guard and autopilot
 * policies rather than relying on the broader RLS grant.
 */
export async function updateAutomationModeAction(
  _prevState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const session = await requireSessionContext();

  if (session.role !== "owner") {
    return { error: "Hanya Owner yang dapat mengubah mode automation." };
  }

  const mode = formData.get("automationMode");
  if (typeof mode !== "string" || !AUTOMATION_MODES.includes(mode as AutomationMode)) {
    return { error: "Mode automation tidak valid." };
  }

  const supabase = await createClient();

  const { error } = await supabase.from("prompter_automation_settings").upsert({
    tenant_id: session.tenantId,
    automation_mode: mode as AutomationMode,
  });

  if (error) {
    return { error: "Gagal menyimpan mode automation." };
  }

  await supabase.from("prompter_audit_logs").insert({
    tenant_id: session.tenantId,
    actor_user_id: session.userId,
    action: "automation_settings.mode_changed",
    resource_type: "prompter_automation_settings",
    resource_id: null,
    context: { automation_mode: mode },
  });

  revalidatePath("/settings");
  return { error: null };
}

/**
 * Emergency Stop must override all automation (product spec) — this is
 * the one toggle that takes effect immediately and is checked at
 * execution time, not just when a recommendation was generated (see
 * features/approvals/actions.ts#executeAutopilotAction, which re-reads
 * this flag fresh before ever calling out to a real connector).
 */
export async function toggleEmergencyStopAction(
  activate: boolean,
  reason: string | null,
): Promise<SettingsActionState> {
  const session = await requireSessionContext();

  if (session.role !== "owner") {
    return { error: "Hanya Owner yang dapat mengaktifkan/menonaktifkan Emergency Stop." };
  }

  const supabase = await createClient();

  const { error } = await supabase.from("prompter_automation_settings").upsert({
    tenant_id: session.tenantId,
    emergency_stop_active: activate,
    emergency_stop_activated_at: activate ? new Date().toISOString() : null,
    emergency_stop_activated_by: activate ? session.userId : null,
    emergency_stop_reason: activate ? reason : null,
  });

  if (error) {
    return { error: "Gagal mengubah status Emergency Stop." };
  }

  await supabase.from("prompter_audit_logs").insert({
    tenant_id: session.tenantId,
    actor_user_id: session.userId,
    action: activate ? "emergency_stop.activated" : "emergency_stop.deactivated",
    resource_type: "prompter_automation_settings",
    resource_id: null,
    context: reason ? { reason } : {},
  });

  revalidatePath("/settings");
  return { error: null };
}

/**
 * Enabling a policy is real automation-scope authorization, not just a
 * UI preference — see the Phase 7 migration comment on
 * prompter_autopilot_policies. Owner-only, matching that table's RLS.
 */
export async function updateAutopilotPolicyAction(
  policyType: AutopilotPolicyType,
  enabled: boolean,
): Promise<SettingsActionState> {
  const session = await requireSessionContext();

  if (session.role !== "owner") {
    return { error: "Hanya Owner yang dapat mengubah kebijakan autopilot." };
  }

  const supabase = await createClient();

  const { error } = await supabase.from("prompter_autopilot_policies").upsert(
    {
      tenant_id: session.tenantId,
      policy_type: policyType,
      enabled,
    },
    { onConflict: "tenant_id,policy_type" },
  );

  if (error) {
    return { error: "Gagal menyimpan kebijakan autopilot." };
  }

  await supabase.from("prompter_audit_logs").insert({
    tenant_id: session.tenantId,
    actor_user_id: session.userId,
    action: enabled ? "autopilot_policy.enabled" : "autopilot_policy.disabled",
    resource_type: "prompter_autopilot_policies",
    resource_id: null,
    context: { policy_type: policyType },
  });

  revalidatePath("/settings");
  return { error: null };
}
