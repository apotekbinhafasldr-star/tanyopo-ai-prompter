import { Sidebar } from "@/components/layout/sidebar";
import { requireSessionContext } from "@/services/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSessionContext();

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar
        businessName={session.businessName}
        userName={session.userName}
        userRole={session.role}
      />
      <main className="flex min-h-screen flex-1 flex-col overflow-x-hidden">{children}</main>
    </div>
  );
}
