"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { onboardingSchema } from "@/schemas/onboarding";

export interface OnboardingActionState {
  error: string | null;
}

async function currentTenantId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: tenantId, error } = await supabase.rpc("fn_current_tenant_id");

  if (error || !tenantId) {
    return { supabase, user, tenantId: null as string | null };
  }

  return { supabase, user, tenantId: tenantId as string };
}

export async function completeOnboardingAction(
  _prevState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  const parsed = onboardingSchema.safeParse({
    brandName: formData.get("brandName"),
    countryCode: formData.get("countryCode"),
    language: formData.get("language"),
    timezone: formData.get("timezone"),
    currency: formData.get("currency"),
    businessCategory: formData.get("businessCategory"),
    whatDoYouSell: formData.get("whatDoYouSell"),
    primaryGoal: formData.get("primaryGoal"),
    targetMarketCountryCode: formData.get("targetMarketCountryCode") ?? "",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data tidak valid" };
  }

  const { supabase, user, tenantId } = await currentTenantId();

  if (!tenantId) {
    return { error: "Gagal memuat data akun. Silakan muat ulang halaman." };
  }

  const { error } = await supabase.from("prompter_brand_profiles").upsert({
    tenant_id: tenantId,
    brand_name: parsed.data.brandName,
    country_code: parsed.data.countryCode,
    default_language: parsed.data.language,
    default_timezone: parsed.data.timezone,
    default_currency: parsed.data.currency,
    billing_country: parsed.data.countryCode,
    business_category: parsed.data.businessCategory as never,
    what_do_you_sell: parsed.data.whatDoYouSell,
    primary_goal: parsed.data.primaryGoal as never,
    // Reuses the existing target_market free-text field (already read by
    // lib/ai/prompts.ts#buildSystemPreamble) rather than adding a new
    // column — a country code is a valid, if terse, value for it, and a
    // standalone international user without UMKMpro can still describe
    // their target market in more detail later from Settings.
    target_market: parsed.data.targetMarketCountryCode || undefined,
    onboarding_completed: true,
    onboarding_step: 8,
  });

  if (error) {
    return { error: "Gagal menyimpan data. Silakan coba lagi." };
  }

  await supabase.from("prompter_audit_logs").insert({
    tenant_id: tenantId,
    actor_user_id: user!.id,
    action: "onboarding.completed",
    resource_type: "prompter_brand_profiles",
    resource_id: null,
    context: { source: "onboarding_wizard" },
  });

  redirect("/dashboard");
}

export async function skipOnboardingAction() {
  const { supabase, tenantId } = await currentTenantId();

  if (tenantId) {
    await supabase.from("prompter_brand_profiles").upsert({
      tenant_id: tenantId,
      onboarding_completed: true,
      onboarding_step: 8,
    });
  }

  redirect("/dashboard");
}
