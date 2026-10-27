import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AdminNav } from "@/features/admin/admin-nav";
import { visibleAdminNav } from "@/lib/admin/nav";
import type { AdminPrincipal, PlatformRole } from "@/lib/admin/permissions";

const ROLE_LABEL: Record<PlatformRole, string> = {
  SUPER_ADMIN: "Super Admin",
  STAFF: "Staf",
  FINANCE_ADMIN: "Admin Keuangan",
  FINANCE_VIEWER: "Pemantau Keuangan",
};

/**
 * Shell for every /admin page. It only ever receives a principal that the server
 * already authorised, and shows just the sections that principal may open.
 */
export function AdminShell({ principal, children }: { principal: AdminPrincipal; children: ReactNode }) {
  const items = visibleAdminNav(principal).map(({ label, href, icon }) => ({ label, href, icon }));

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <ShieldCheck className="size-5 shrink-0 text-brand" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">Admin Perusahaan</p>
              <p className="hidden truncate text-xs text-muted-foreground sm:block">PT Tanyopo Future Technology</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="brand">{ROLE_LABEL[principal.role]}</Badge>
            <Link
              href="/dashboard"
              className="flex min-h-11 items-center gap-1 rounded-[var(--radius-md)] px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" aria-hidden />
              <span className="hidden sm:inline">Kembali ke aplikasi</span>
              <span className="sm:hidden">Aplikasi</span>
            </Link>
          </div>
        </div>
      </header>
      <AdminNav items={items} />
      <main className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-4 md:py-6">{children}</main>
    </div>
  );
}
