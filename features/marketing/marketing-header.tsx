"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LinoeLogo } from "@/components/brand/linoe-logo";
import { cn } from "@/lib/utils/cn";

const NAV_LINKS = [
  { href: "#produk", label: "Produk" },
  { href: "#ai-agents", label: "AI Team" },
  { href: "#cara-kerja", label: "Cara Kerja" },
  { href: "#analitik", label: "Analitik" },
  { href: "#harga", label: "Harga" },
];

export function MarketingHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Lock body scroll while the mobile menu is open.
  useEffect(() => {
    if (menuOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [menuOpen]);

  // The only page using this header is the landing page, whose hero is a
  // large dark navy/blue/violet composition — so before scrolling past it,
  // the header renders light-on-dark; scrolled state switches to the
  // normal light-surface header once the page background is light again.
  const onDark = !scrolled;

  return (
    <header
      className={cn(
        // `fixed` (not `sticky`) so the header is removed from normal flow
        // entirely and truly overlaps the hero's top edge instead of
        // reserving its own 64px of layout space above it — with `sticky`,
        // the transparent header would sit on the plain page background,
        // not the dark hero, making light-on-dark text invisible.
        "fixed inset-x-0 top-0 z-40 transition-all duration-300",
        scrolled
          ? "border-b border-border bg-surface/80 shadow-[var(--shadow-sm)] backdrop-blur-lg"
          : "border-b border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <span onClick={() => setMenuOpen(false)}>
          <LinoeLogo size="md" />
        </span>

        <nav
          className={cn(
            "hidden items-center gap-7 text-sm font-medium lg:flex",
            onDark ? "text-white/75" : "text-muted-foreground",
          )}
        >
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={cn("transition-colors", onDark ? "hover:text-white" : "hover:text-foreground")}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className={cn(onDark && "text-white hover:bg-white/10 hover:text-white")}
          >
            <Link href="/login">Masuk</Link>
          </Button>
          <Button
            asChild
            size="sm"
            className="bg-gradient-to-r from-brand to-brand-2 shadow-[var(--shadow-glow)] hover:opacity-95"
          >
            <Link href="/register">Mulai Promosikan</Link>
          </Button>
        </div>

        <div className="flex items-center gap-2 lg:hidden">
          <Button asChild size="sm" className="bg-gradient-to-r from-brand to-brand-2">
            <Link href="/register">Mulai</Link>
          </Button>
          <button
            type="button"
            aria-label={menuOpen ? "Tutup menu" : "Buka menu"}
            aria-expanded={menuOpen}
            aria-controls="marketing-mobile-nav"
            onClick={() => setMenuOpen((v) => !v)}
            className={cn(
              "flex size-9 items-center justify-center rounded-[var(--radius-md)]",
              onDark ? "text-white hover:bg-white/10" : "text-foreground hover:bg-surface-muted",
            )}
          >
            {menuOpen ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          </button>
        </div>
      </div>

      {menuOpen ? (
        <div
          id="marketing-mobile-nav"
          className="border-t border-border bg-surface px-4 pb-6 pt-2 lg:hidden"
        >
          <nav className="flex flex-col">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="border-b border-border py-3.5 text-sm font-medium text-foreground last:border-none"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className="mt-4 flex flex-col gap-2">
            <Button asChild variant="outline" size="md" onClick={() => setMenuOpen(false)}>
              <Link href="/login">Masuk</Link>
            </Button>
          </div>
        </div>
      ) : null}
    </header>
  );
}
