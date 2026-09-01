import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Locale, TenantRole } from "@/types/database";
import { DEFAULT_LOCALE } from "@/lib/i18n/config";

export interface SessionContext {
  userId: string;
  email: string | null;
  userName: string;
  role: TenantRole;
  tenantId: string;
  businessName: string;
  onboardingCompleted: boolean;
  /** UI + AI-generation locale (prompter_brand_profiles.default_language).
   * Defaults to DEFAULT_LOCALE ('id') before onboarding sets one — existing
   * Indonesia tenants are never affected. */
  locale: Locale;
}

/**
 * Loads the authenticated user's tenant context. Redirects to /login if
 * unauthenticated (defense in depth — proxy.ts already gates these routes).
 * Redirects to /onboarding when the Promoter brand profile hasn't been
 * completed yet, unless `allowIncompleteOnboarding` is set.
 */
export async function requireSessionContext(
  options: { allowIncompleteOnboarding?: boolean } = {},
): Promise<SessionContext> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("nama, role, tenant_id")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    redirect("/login");
  }

  const { data: tenant } = await supabase
    .from("tenants")
    .select("nama_usaha")
    .eq("id", profile.tenant_id)
    .single();

  const { data: brandProfile } = await supabase
    .from("prompter_brand_profiles")
    .select("onboarding_completed, default_language")
    .eq("tenant_id", profile.tenant_id)
    .maybeSingle();

  const onboardingCompleted = brandProfile?.onboarding_completed ?? false;

  if (!onboardingCompleted && !options.allowIncompleteOnboarding) {
    redirect("/onboarding");
  }

  return {
    userId: user.id,
    email: user.email ?? null,
    userName: profile.nama,
    role: profile.role,
    tenantId: profile.tenant_id,
    businessName: tenant?.nama_usaha ?? "Bisnis Anda",
    onboardingCompleted,
    locale: brandProfile?.default_language ?? DEFAULT_LOCALE,
  };
}
