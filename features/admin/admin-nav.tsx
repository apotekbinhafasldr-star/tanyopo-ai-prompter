"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { activeAdminHref } from "@/lib/admin/nav";
import { cn } from "@/lib/utils/cn";

export interface AdminNavLink {
  label: string;
  href: string;
  icon: LucideIcon;
}

/**
 * Bottom tab bar on phones (thumb reach, no drawer state to get stuck), docked
 * under the header from `md` up. Plain links: it works without JavaScript and
 * only reads the pathname to highlight the current section. The list passed in is
 * already filtered by permission on the server.
 */
export function AdminNav({ items }: { items: AdminNavLink[] }) {
  const pathname = usePathname();
  const active = activeAdminHref(pathname, items);

  return (
    <nav
      aria-label="Navigasi Admin Center"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface md:static md:border-t-0 md:border-b"
    >
      <ul className="mx-auto flex max-w-5xl items-stretch justify-around md:justify-start md:gap-1 md:px-4">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = item.href === active;
          return (
            <li key={item.href} className="flex-1 md:flex-none">
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 px-3 text-xs font-medium md:min-h-12 md:flex-row md:gap-2 md:text-sm",
                  isActive ? "text-brand" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-5 shrink-0 md:size-4" aria-hidden />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
