import type { LucideIcon } from "lucide-react";
import { Banknote, LayoutGrid, Receipt, Users } from "lucide-react";
import type { AdminPrincipal, Permission } from "@/lib/admin/permissions";
import { can } from "@/lib/admin/permissions";

export interface AdminNavItem {
  readonly label: string;
  readonly href: string;
  readonly icon: LucideIcon;
  readonly permission: Permission;
  readonly description: string;
}

export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  {
    label: "Ringkasan",
    href: "/admin",
    icon: LayoutGrid,
    permission: "admin.overview",
    description: "Gambaran umum Admin Center",
  },
  {
    label: "Keuangan",
    href: "/admin/finance",
    icon: Banknote,
    permission: "finance.view",
    description: "Pembayaran, pendapatan, settlement, laba-rugi",
  },
  {
    label: "Pajak",
    href: "/admin/finance/tax",
    icon: Receipt,
    permission: "tax.view",
    description: "Rekap omzet dan status konfigurasi pajak",
  },
  {
    label: "Staf",
    href: "/admin/staff",
    icon: Users,
    permission: "staff.view",
    description: "Hak akses karyawan",
  },
];

/** Only the sections this person may open. The server re-checks on every page. */
export function visibleAdminNav(principal: AdminPrincipal): AdminNavItem[] {
  return ADMIN_NAV_ITEMS.filter((item) => can(principal, item.permission));
}

/** Longest matching nav href wins, so /admin/finance/tax highlights Pajak, not Keuangan. */
export function activeAdminHref(pathname: string, items: readonly { href: string }[]): string | null {
  let best: string | null = null;
  for (const { href } of items) {
    const match = pathname === href || (href !== "/admin" && pathname.startsWith(`${href}/`));
    if (match && (best === null || href.length > best.length)) best = href;
  }
  return best;
}
