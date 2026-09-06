"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import { Sidebar } from "@/components/layout/sidebar";
import { LinoeLogo } from "@/components/brand/linoe-logo";
import { cn } from "@/lib/utils/cn";

interface AppShellProps {
  businessName: string;
  userName: string;
  userRole: string;
  children: ReactNode;
}

/**
 * Below `lg` (1024px) the sidebar has nowhere to live at its normal 256px
 * width without pushing every dashboard page's content into a sliver a few
 * dozen pixels wide — there was previously no mobile/tablet handling at
 * all, just an always-docked <Sidebar>. This makes it an off-canvas drawer
 * on small screens, opened from a slim top bar, and leaves the `lg:` docked
 * layout exactly as it was.
 */
export function AppShell({ businessName, userName, userRole, children }: AppShellProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div className="flex min-h-screen bg-background">
      <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-surface px-4 lg:hidden">
        <LinoeLogo size="sm" href="/dashboard" />
        <button
          type="button"
          aria-label={open ? "Tutup menu" : "Buka menu"}
          aria-expanded={open}
          aria-controls="app-sidebar-drawer"
          onClick={() => setOpen((v) => !v)}
          className="flex size-11 items-center justify-center rounded-[var(--radius-md)] text-foreground hover:bg-surface-muted"
        >
          {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
        </button>
      </div>

      {open ? (
        <div
          aria-hidden
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
        />
      ) : null}

      <div
        id="app-sidebar-drawer"
        className={cn(
          "fixed inset-y-0 left-0 z-40 transition-transform duration-200 ease-out lg:static lg:z-auto lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <Sidebar
          businessName={businessName}
          userName={userName}
          userRole={userRole}
          onNavigate={() => setOpen(false)}
        />
      </div>

      <main className="flex min-h-screen flex-1 flex-col overflow-x-hidden pt-14 lg:pt-0">
        {children}
      </main>
    </div>
  );
}
