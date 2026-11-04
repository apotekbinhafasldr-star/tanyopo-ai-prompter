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
  // Only plain strings cross the server->client boundary: icon components are not serialisable
  // (passing them made /admin fail at runtime). AdminNav looks the icon up by href.
  const items = visibleAdminNav(principal).map(({ label, href }) => ({ label, href }));

  return (
    <div className="min-h-screen overflow-x-clip bg-background pb-24 md:pb-0">
      <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-brand/10">
              <ShieldCheck className="size-4.5 text-brand" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight text-foreground">Admin Perusahaan</p>
              <p className="truncate text-xs leading-tight text-muted-foreground">PT Tanyopo Future Technology</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
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
      <main className="mx-auto flex min-w-0 max-w-5xl flex-col gap-4 px-3 py-4 sm:px-4 md:py-6 [&>*]:min-w-0">{children}</main>
    </div>
  );
}
