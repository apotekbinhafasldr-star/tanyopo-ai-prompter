"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HelpCircle, LogOut, ChevronsUpDown } from "lucide-react";
import { NAV_ITEMS } from "@/lib/constants/nav";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils/cn";
import { logoutAction } from "@/features/auth/actions";

interface SidebarProps {
  businessName: string;
  userName: string;
  userRole: string;
}

export function Sidebar({ businessName, userName, userRole }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex h-16 items-center gap-2 px-5">
        <span className="flex size-7 items-center justify-center rounded-[var(--radius-md)] bg-brand text-sm font-bold text-brand-foreground">
          T
        </span>
        <span className="text-sm font-semibold tracking-tight text-foreground">
          Tanyopo AI Promoter
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2">
        <ul className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-brand-muted text-brand"
                      : "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="flex flex-col gap-1 border-t border-border p-3">
        <button
          type="button"
          className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] px-3 py-2 text-left text-sm hover:bg-surface-muted"
        >
          <span className="truncate font-medium text-foreground">{businessName}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>

        <Link
          href="/settings"
          className="flex items-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-sm text-muted-foreground hover:bg-surface-muted hover:text-foreground"
        >
          <HelpCircle className="size-4" aria-hidden />
          Bantuan
        </Link>

        <div className="mt-1 flex items-center gap-2 rounded-[var(--radius-md)] px-3 py-2">
          <Avatar name={userName} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{userName}</p>
            <p className="truncate text-xs text-muted-foreground capitalize">{userRole}</p>
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              aria-label="Keluar"
              className="rounded-[var(--radius-sm)] p-1.5 text-muted-foreground hover:bg-surface-muted hover:text-danger"
            >
              <LogOut className="size-4" aria-hidden />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
