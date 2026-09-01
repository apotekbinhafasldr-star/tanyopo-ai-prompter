"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSessionContext } from "@/services/session";
import { budgetPolicySchema } from "@/schemas/budget";
import { globalPreferencesSchema } from "@/schemas/global-preferences";
import { COMPLIANCE_FLAG_TYPES } from "@/services/compliance";
import type { AutomationMode, AutopilotPolicyType, ComplianceFlagType, ComplianceStatus, FeatureFlagKey } from "@/types/database";

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

/**
 * Business home market + UI/AI language (product spec §2-3). Owner or
 * marketing can change it, same governance level as the brand profile
 * itself (features/onboarding/actions.ts) — not the stricter owner-only
 * tier used for Budget Guard/automation, since this doesn't touch money
 * or execution safety. target_market_country_code stays independent of
 * country_code — a campaign's target market is never assumed to equal
 * the business's home market (product spec §8).
 */
export async function updateGlobalPreferencesAction(
  _prevState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const session = await requireSessionContext({ allowIncompleteOnboarding: true });

  if (session.role !== "owner" && session.role !== "marketing") {
    return { error: "Anda tidak memiliki izin untuk mengubah preferensi ini." };
  }

  const parsed = globalPreferencesSchema.safeParse({
    countryCode: formData.get("countryCode"),
    language: formData.get("language"),
    timezone: formData.get("timezone"),
    currency: formData.get("currency"),
    targetMarketCountryCode: formData.get("targetMarketCountryCode") ?? "",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data tidak valid." };
  }

  const supabase = await createClient();

  const { error } = await supabase.from("prompter_brand_profiles").upsert({
    tenant_id: session.tenantId,
    country_code: parsed.data.countryCode,
    default_language: parsed.data.language,
    default_timezone: parsed.data.timezone,
    default_currency: parsed.data.currency,
    billing_country: parsed.data.countryCode,
  });

  if (error) {
    return { error: "Gagal menyimpan preferensi global." };
  }

  await supabase.from("prompter_audit_logs").insert({
    tenant_id: session.tenantId,
    actor_user_id: session.userId,
    action: "brand_profile.global_preferences_updated",
    resource_type: "prompter_brand_profiles",
    resource_id: null,
    context: {
      country_code: parsed.data.countryCode,
      language: parsed.data.language,
      timezone: parsed.data.timezone,
      currency: parsed.data.currency,
    },
  });

  revalidatePath("/settings");
  return { error: null };
}

/**
 * Toggles one Global Edition feature flag (product spec §21). Owner-only.
 * A missing row means OFF (lib/feature-flags.ts#isFeatureEnabled()) — this
 * only ever writes the tenant's own explicit choice, never auto-enrolls it.
 */
export async function toggleFeatureFlagAction(
  flagKey: FeatureFlagKey,
  enabled: boolean,
): Promise<SettingsActionState> {
  const session = await requireSessionContext({ allowIncompleteOnboarding: true });

  if (session.role !== "owner") {
    return { error: "Hanya Owner yang dapat mengubah feature flag." };
  }

  const supabase = await createClient();

  const { error } = await supabase.from("prompter_feature_flags").upsert(
    { tenant_id: session.tenantId, flag_key: flagKey, enabled },
    { onConflict: "tenant_id,flag_key" },
  );

  if (error) {
    return { error: "Gagal menyimpan feature flag." };
  }

  await supabase.from("prompter_audit_logs").insert({
    tenant_id: session.tenantId,
    actor_user_id: session.userId,
    action: enabled ? "feature_flag.enabled" : "feature_flag.disabled",
    resource_type: "prompter_feature_flags",
    resource_id: null,
    context: { flag_key: flagKey },
  });

  revalidatePath("/settings");
  revalidatePath("/connections");
  return { error: null };
}

/**
 * Sets one compliance readiness flag's status (product spec §16) —
 * never a "fully compliant" assertion, just one of the four honest
 * statuses. Global scope only (market_country_code null) in this pass.
 * Owner-only, same governance tier as Budget Guard settings, since this
 * carries real legal-readiness signal for the business.
 */
export async function updateComplianceFlagAction(
  _prevState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const session = await requireSessionContext({ allowIncompleteOnboarding: true });

  if (session.role !== "owner") {
    return { error: "Hanya Owner yang dapat mengubah status compliance." };
  }

  const flagType = formData.get("flagType");
  const status = formData.get("status");
  const notes = formData.get("notes");
  const url = formData.get("url");

  if (typeof flagType !== "string" || !COMPLIANCE_FLAG_TYPES.includes(flagType as ComplianceFlagType)) {
    return { error: "Jenis compliance tidak valid." };
  }
  const validStatuses: ComplianceStatus[] = ["COMPLIANCE_REVIEW_REQUIRED", "SUPPORTED", "RESTRICTED", "NOT_CONFIGURED"];
  if (typeof status !== "string" || !validStatuses.includes(status as ComplianceStatus)) {
    return { error: "Status tidak valid." };
  }

  const supabase = await createClient();

  const { error } = await supabase.from("prompter_compliance_flags").upsert(
    {
      tenant_id: session.tenantId,
      market_country_code: "",
      flag_type: flagType as ComplianceFlagType,
      status: status as ComplianceStatus,
      notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
      url: typeof url === "string" && url.trim() ? url.trim() : null,
    },
    { onConflict: "tenant_id,market_country_code,flag_type" },
  );

  if (error) {
    return { error: "Gagal menyimpan status compliance." };
  }

  await supabase.from("prompter_audit_logs").insert({
    tenant_id: session.tenantId,
    actor_user_id: session.userId,
    action: "compliance_flag.updated",
    resource_type: "prompter_compliance_flags",
    resource_id: null,
    context: { flag_type: flagType, status },
  });

  revalidatePath("/settings");
  return { error: null };
}
