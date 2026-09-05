"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Globe, ChevronDown, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

// The approved vertical LINOE logo — the exact same asset/component used in
// the site's real header (public/brand/linoe/linoe-logo-vertical.png), just
// rendered directly here (rather than via <LinoeLogo>) so its height can be
// small enough to fit this compact strip without cutting into the presenter
// photo just below it. Not redrawn, not recreated with CSS — same file.
const LOGO_SRC = "/brand/linoe/linoe-logo-vertical.png";
const LOGO_WIDTH = 1024;
const LOGO_HEIGHT = 1536;
const LOGO_RENDER_HEIGHT = 30;
const LOGO_RENDER_WIDTH = Math.round((LOGO_WIDTH / LOGO_HEIGHT) * LOGO_RENDER_HEIGHT);

// Each maps to a section that already exists on this page — nothing invented.
// "Studi Kasus" has no existing case-study/social-proof section anywhere in
// the app (checked before adding this), so it's rendered as plain text
// below, not a link.
const NAV_ITEMS = [
  { label: "Beranda", href: "#produk" },
  { label: "Fitur", href: "#ai-agents" },
  { label: "Harga", href: "#harga" },
] as const;

const SECTION_IDS = NAV_ITEMS.map((item) => item.href.slice(1));

/**
 * Real, visible, keyboard-accessible navigation integrated into the top of
 * the desktop hero — replacing invisible click-only hotspots for the logo,
 * nav links, and Masuk/Mulai Sekarang buttons (the hero's main CTA row
 * lower down keeps its own separate invisible hotspots; that area is
 * locked/unchanged). Sits on the dark mask strip painted over the baked-in
 * horizontal logo and nav text in hero.tsx.
 */
export function HeroIntegratedNav() {
  const [activeHref, setActiveHref] = useState<string>("#produk");

  useEffect(() => {
    const sections = SECTION_IDS.map((id) => document.getElementById(id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActiveHref(`#${visible.target.id}`);
      },
      { rootMargin: "-40% 0px -50% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex h-full items-center justify-between gap-3 px-4 sm:px-6">
      <Link href="#produk" aria-label="LINOE — Beranda" className="inline-flex shrink-0 items-center">
        <Image
          src={LOGO_SRC}
          alt="LINOE by Tanyopo"
          width={LOGO_WIDTH}
          height={LOGO_HEIGHT}
          style={{ height: LOGO_RENDER_HEIGHT, width: LOGO_RENDER_WIDTH }}
          className="rounded-[var(--radius-sm)]"
          priority
        />
      </Link>

      <nav aria-label="Navigasi utama" className="flex items-center gap-5 text-xs font-medium text-white/75">
        {NAV_ITEMS.map((item) => {
          const isActive = activeHref === item.href;
          return (
            <a
              key={item.href}
              href={item.href}
              aria-current={isActive ? "true" : undefined}
              className={cn(
                "relative py-1 transition-colors hover:text-white focus-visible:text-white focus-visible:outline-none",
                isActive ? "text-white" : "text-white/75",
              )}
            >
              {item.label}
              <span
                aria-hidden
                className={cn(
                  "absolute inset-x-0 -bottom-0.5 h-px rounded-full bg-gradient-to-r from-[#22d3ee] to-[#8b5cf6] transition-opacity duration-300",
                  isActive ? "opacity-100" : "opacity-0",
                )}
              />
            </a>
          );
        })}
        <span className="cursor-default text-white/55">Studi Kasus</span>
      </nav>

      <div className="flex shrink-0 items-center gap-2">
        {/* Decorative only — there is no locale-switching feature elsewhere
            in the app to wire this up to, so it stays static rather than
            inventing one. */}
        <span
          aria-hidden
          className="flex items-center gap-1 text-xs font-medium text-white/60"
        >
          <Globe className="size-3.5" aria-hidden />
          ID
          <ChevronDown className="size-3" aria-hidden />
        </span>
        <Button
          asChild
          size="sm"
          variant="outline"
          className="border-white/25 text-white hover:bg-white/10 hover:text-white"
        >
          <Link href="/login">Masuk</Link>
        </Button>
        <Button
          asChild
          size="sm"
          className="bg-gradient-to-r from-[#22d3ee] via-[#3b82f6] to-[#8b5cf6] text-white hover:opacity-95"
        >
          <Link href="/register">
            Mulai Sekarang
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </Button>
      </div>
    </div>
  );
}
