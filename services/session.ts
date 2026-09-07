import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Locale, TenantRole } from "@/types/database";
import { DEFAULT_LOCALE } from "@/lib/i18n/config";

/**
 * Prefers LINOE's own brand name (prompter_brand_profiles.brand_name) over
 * the shared tenant's UMKMpro AI business name (tenants.nama_usaha). This
 * Supabase project is shared between UMKMpro AI and LINOE: an existing
 * UMKMpro AI identity registering on LINOE keeps the same auth.users row
 * and the same tenant_id (Supabase never creates a duplicate account for
 * an existing email), so `tenants.nama_usaha` can be a business name set
 * long before that identity ever used LINOE. Falls back to it only for a
 * tenant that hasn't completed LINOE's own onboarding yet (no brand_name
 * saved there). Pure function so this fallback — the entire point of this
 * fix — has direct test coverage.
 */
export function resolveBusinessName(
  brandName: string | null | undefined,
  tenantName: string | null | undefined,
): string {
  return brandName ?? tenantName ?? "Bisnis Anda";
}

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
  /** Tenant's configured currency (prompter_brand_profiles.default_currency)
   * — used to default new-record currency pickers (e.g. product creation)
   * to the tenant's own market instead of assuming IDR. Defaults to 'IDR'
   * before onboarding sets one, matching every other pre-Global-Edition
   * default. */
  defaultCurrency: string;
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
    // A valid Supabase session with no matching user_profiles row (the row
    // is created by an external trigger owned by a separate Supabase
    // project — see docs/DATABASE.md) is unresolvable here. Redirecting to
    // /login would loop forever: the user is still authenticated, so
    // proxy.ts's AUTH_ONLY_PATHS check immediately bounces /login back to
    // /dashboard, which lands right back here. /session-error is not an
    // auth-only path, so the user can actually see it and sign out.
    redirect("/session-error");
  }

  const { data: tenant } = await supabase
    .from("tenants")
    .select("nama_usaha")
    .eq("id", profile.tenant_id)
    .single();

  const { data: brandProfile } = await supabase
    .from("prompter_brand_profiles")
    .select("brand_name, onboarding_completed, default_language, default_currency")
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
    businessName: resolveBusinessName(brandProfile?.brand_name, tenant?.nama_usaha),
    onboardingCompleted,
    locale: brandProfile?.default_language ?? DEFAULT_LOCALE,
    defaultCurrency: brandProfile?.default_currency ?? "IDR",
  };
}
