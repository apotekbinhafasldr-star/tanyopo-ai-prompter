import { AppShell } from "@/components/layout/app-shell";
import { requireSessionContext } from "@/services/session";
import { canSeeAdminCenterLink } from "@/services/platform-admin";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSessionContext();
  // Visibility hint only (false unless the Admin Center is enabled AND this user is a platform admin);
  // every /admin page re-checks on the server.
  const showAdminLink = await canSeeAdminCenterLink();

  return (
    <AppShell
      businessName={session.businessName}
      userName={session.userName}
      userRole={session.role}
      showAdminLink={showAdminLink}
    >
      {children}
    </AppShell>
  );
}
