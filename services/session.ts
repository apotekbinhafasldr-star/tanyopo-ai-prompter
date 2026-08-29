import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { TenantRole } from "@/types/database";

export interface SessionContext {
  userId: string;
  email: string | null;
  userName: string;
  role: TenantRole;
  tenantId: string;
  businessName: string;
  onboardingCompleted: boolean;
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
    .select("onboarding_completed")
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
  };
}
