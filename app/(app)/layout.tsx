import { AppShell } from "@/components/layout/app-shell";
import { requireSessionContext } from "@/services/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSessionContext();

  return (
    <AppShell
      businessName={session.businessName}
      userName={session.userName}
      userRole={session.role}
    >
      {children}
    </AppShell>
  );
}
