"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { brand } from "@/features/marketing/brand";

const NAV_LINKS = [
  { href: "#produk", label: "Produk" },
  { href: "#cara-kerja", label: "Cara Kerja" },
  { href: "#ai-agents", label: "AI Agents" },
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

  return (
    <header
      className={cn(
        "sticky top-0 z-40 transition-all duration-300",
        scrolled
          ? "border-b border-border bg-surface/80 shadow-[var(--shadow-sm)] backdrop-blur-lg"
          : "border-b border-transparent bg-surface/0",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2" onClick={() => setMenuOpen(false)}>
          <span className="flex size-8 items-center justify-center rounded-[var(--radius-md)] bg-gradient-to-br from-brand to-brand-2 text-sm font-bold text-brand-foreground shadow-[var(--shadow-sm)]">
            {brand.initial}
          </span>
          <span className="text-sm font-semibold tracking-tight text-foreground sm:text-base">
            {brand.shortName}
          </span>
        </Link>

        <nav className="hidden items-center gap-7 text-sm font-medium text-muted-foreground lg:flex">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} className="transition-colors hover:text-foreground">
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <Button asChild variant="ghost" size="sm">
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
            className="flex size-9 items-center justify-center rounded-[var(--radius-md)] text-foreground hover:bg-surface-muted"
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
