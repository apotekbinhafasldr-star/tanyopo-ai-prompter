import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { TrialBanner } from "@/components/layout/trial-banner";
import { requireSessionContext } from "@/services/session";
import { canSeeAdminCenterLink } from "@/services/platform-admin";
import { createClient } from "@/lib/supabase/server";
import { getTrialState } from "@/services/billing";

// The signed-in app is never a search landing page. Unauthenticated crawlers are redirected to /login (also noindex),
// and this tag covers any response that is ever served without that redirect. Child pages keep their own titles.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Read-only trial strip. It only reads the subscription row and derives the
 * state with getTrialState(); it never creates the row (that stays with the
 * Billing page / AI job path) and any failure simply hides the strip.
 */
async function loadTrialBanner(tenantId: string) {
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("prompter_subscriptions").select("*").eq("tenant_id", tenantId).maybeSingle();
    if (!data) return null;
    const trial = getTrialState(data);
    if (!trial.isTrialing) return null;
    return <TrialBanner daysRemaining={trial.daysRemaining} expired={trial.expired} />;
  } catch {
    return null;
  }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSessionContext();
  // Visibility hint only (false unless the Admin Center is enabled AND this user is a platform admin);
  // every /admin page re-checks on the server.
  const showAdminLink = await canSeeAdminCenterLink();
  const banner = await loadTrialBanner(session.tenantId);

  return (
    <AppShell
      businessName={session.businessName}
      userName={session.userName}
      userRole={session.role}
      showAdminLink={showAdminLink}
      banner={banner}
    >
      {children}
    </AppShell>
  );
}
