import Image from "next/image";
import Link from "next/link";
import { Sparkles, ArrowRight, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HeroVisual } from "@/features/marketing/components/hero-visual";
import { HeroIntegratedNav } from "@/features/marketing/components/hero-integrated-nav";
import { ProductVisual } from "@/features/marketing/components/product-visual";

// Real CTA links kept for keyboard/screen-reader users on the desktop hero,
// where the approved final asset already bakes the headline and CTAs into
// its pixels — visually hidden by default (sr-only) so nothing duplicates
// the artwork, revealed only when focused so the links stay operable.
const DESKTOP_HERO_CTA_CLASS =
  "sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:left-4 focus-visible:top-4 focus-visible:z-20 focus-visible:rounded-[var(--radius-md)] focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-semibold focus-visible:text-white focus-visible:shadow-lg";

// Transparent, click/keyboard-accessible hotspots aligned over the controls
// baked into the approved desktop hero image (public/brand/linoe/
// 08-hero-desktop-final.jpg, 1536x477 native). Positions were measured
// directly from the image's own pixels (per-pixel brightness/color probing
// to find each button's actual edges), then expressed as percentages of
// the image's own box so they stay aligned as it scales responsively.
// Each targets an existing route/anchor already used elsewhere on this
// page — nothing new was invented.
//
// Only the main CTA row (Mulai Promosikan Sekarang / Lihat Cara Kerja)
// still uses this invisible-hotspot approach — that row is locked/
// unchanged. The logo, nav links, and Masuk/Mulai Sekarang are now real,
// visible elements (HeroIntegratedNav below) instead, since invisible
// hotspots can't show hover/focus/active states.
type HeroHotspot = {
  label: string;
  href: string;
  external?: boolean; // true = real navigation (next/link), false = in-page anchor
  rect: { left: number; top: number; width: number; height: number }; // % of image box
};

const HERO_IMAGE_HOTSPOTS: HeroHotspot[] = [
  {
    label: "Mulai Promosikan Sekarang",
    href: "/register",
    external: true,
    rect: { left: 3.78, top: 74.63, width: 18.03, height: 11.95 },
  },
  { label: "Lihat Cara Kerja", href: "#cara-kerja", rect: { left: 22.98, top: 74.63, width: 10.68, height: 11.95 } },
];

// Fully transparent — no fill/border ever, even on hover — a focus ring is
// the only visual feedback, and only while keyboard-focused (never a
// permanent visible addition to the approved artwork).
const HERO_HOTSPOT_CLASS =
  "absolute rounded-[var(--radius-sm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80";

export function Hero() {
  return (
    <>
      {/* The premium dark hero: headline, human presenter, and the
          Tanyopo Intelligence dashboard overlay all live inside this one
          navy/blue/violet composition — never a light page with a photo
          bolted on. */}
      <section id="produk" className="relative overflow-hidden bg-ink">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(60% 55% at 10% 0%, color-mix(in srgb, #3b82f6 30%, transparent), transparent 65%), radial-gradient(55% 50% at 100% 10%, color-mix(in srgb, #8b5cf6 28%, transparent), transparent 70%), radial-gradient(45% 40% at 55% 100%, color-mix(in srgb, #22d3ee 14%, transparent), transparent 70%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
            backgroundSize: "42px 42px",
          }}
        />

        {/* Mobile/tablet composition (below the 900px `desktop:` breakpoint,
            see app/globals.css) — the reconstructed hero (real headline,
            CTA, and presenter photo as separate elements) stays exactly as
            approved. Untouched by the desktop asset swap below. */}
        <div className="relative mx-auto grid max-w-6xl gap-8 px-4 pb-14 pt-24 sm:gap-10 sm:px-6 sm:pb-20 sm:pt-28 desktop:hidden">
          <div className="flex flex-col items-center gap-4 text-center sm:gap-5">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1 text-xs font-medium text-white/80 backdrop-blur">
              <Sparkles className="size-3.5 text-[#67e8f9]" aria-hidden />
              AI Marketing & Growth Platform
            </div>

            {/* text-3xl on the smallest screens (below the 640px `sm` step)
                keeps the full slogan reliably clear of the viewport edge on
                320-430px phones — text-4xl left too little margin there. */}
            <h1 className="max-w-xl text-3xl font-semibold leading-[1.15] tracking-[-0.02em] text-white sm:text-5xl sm:leading-[1.05]">
              Marketing Lebih Cepat. Bisnis Melaju Lebih Jauh.{" "}
              <span className="bg-gradient-to-r from-[#22d3ee] via-[#3b82f6] to-[#8b5cf6] bg-clip-text text-transparent">
                Bersama LINOE.
              </span>
            </h1>

            <p className="max-w-md text-balance text-sm leading-relaxed text-white/70 sm:text-base">
              LINOE membantu Anda menganalisis produk, menyusun strategi, membuat konten,
              menjalankan campaign, memantau hasil, dan mengoptimasi pertumbuhan — semua dengan
              AI dalam satu platform.
            </p>

            <div className="flex w-full flex-col gap-3 pt-1 sm:w-auto sm:flex-row">
              <Button
                asChild
                size="lg"
                className="bg-gradient-to-r from-[#22d3ee] via-[#3b82f6] to-[#8b5cf6] text-sm text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_20px_48px_-12px_rgba(59,130,246,0.55)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_0_0_1px_rgba(255,255,255,0.12),0_24px_56px_-12px_rgba(139,92,246,0.6)] motion-reduce:hover:translate-y-0 active:translate-y-0 sm:text-base"
              >
                <Link href="/register">
                  Mulai Promosikan
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-white/25 text-sm text-white transition-all duration-300 hover:-translate-y-0.5 hover:border-white/40 hover:bg-white/10 motion-reduce:hover:translate-y-0 active:translate-y-0 sm:text-base"
              >
                <a href="#cara-kerja">
                  <PlayCircle className="size-4" aria-hidden />
                  Lihat Cara Kerja
                </a>
              </Button>
            </div>

            <p className="text-xs text-white/50">
              Tidak perlu kartu kredit · Anda menyetujui setiap campaign sebelum tayang
            </p>
          </div>

          {/* Human presenter + Tanyopo Intelligence overlay — directly beneath
              the CTA on mobile, inside this same dark composition. */}
          <HeroVisual />
        </div>

        {/* Desktop (>=900px, `desktop:` breakpoint) — the founder-approved
            final hero asset, installed as-is (not reconstructed from
            separate elements): it already bakes in the headline, CTAs,
            presenter + tablet, and dashboard preview in one composition.
            A small top padding (desktop:pt-2) gives it a touch of breathing
            room from the browser edge without recreating the large empty
            band a previous round removed — the real header still stays
            invisible while unscrolled here (see marketing-header.tsx).
            Real CTA links are kept for keyboard/screen-reader users (see
            DESKTOP_HERO_CTA_CLASS above) without duplicating the artwork's
            own visible text. */}
        <div className="relative mx-auto hidden max-w-7xl px-4 pb-16 pt-24 sm:px-6 sm:pb-20 sm:pt-28 desktop:block desktop:pb-20 desktop:pt-2">
          {/* This inner wrapper has no padding of its own, so its box exactly
              matches the rendered image — the hotspots below are positioned
              in percentages of THIS box, not the padded outer container.
              overflow-hidden lets the left-edge mask strip below clip
              cleanly against the image's own edge. */}
          <div className="relative overflow-hidden">
            <Image
              src="/brand/linoe/08-hero-desktop-final.jpg"
              alt="LINOE — AI Marketing & Growth Platform. Marketing Lebih Cepat. Bisnis Melaju Lebih Jauh. Bersama LINOE. LINOE membantu Anda menganalisis produk, menyusun strategi, membuat konten, menjalankan campaign, memantau hasil, dan mengoptimasi pertumbuhan — semua dengan AI dalam satu platform. Presenter memegang tablet LINOE di samping pratinjau dashboard LINOE."
              width={1536}
              height={477}
              priority
              sizes="(min-width: 1536px) 1280px, 90vw"
              className="h-auto w-full"
            />
            {/* The supplied asset has a ~4px stray white line baked into its
                left edge (verified via pixel probing — present at every row,
                unrelated to any content behind it). Masking it with a strip
                matching the hero's own dark background is a display-only
                fix: the image file itself is never modified, cropped, or
                regenerated. The image's right edge has no such artifact —
                its white pixels there are the dashboard card's own design,
                confirmed by sampling rows above and below the card where the
                edge is correctly dark — so only the left edge is masked. */}
            <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-[0.55%] bg-ink" />
            {/* Covers the baked-in horizontal logo and Beranda/Fitur/Harga/
                Studi Kasus/language/Masuk/Mulai Sekarang row so
                HeroIntegratedNav's real elements replace them cleanly.
                Solid (not faded) — a gradient fade here let the old baked-in
                logo's swoosh mark ghost through its semi-transparent zone.
                Height is capped just above where the presenter's hair
                enters the frame (verified via pixel probing — it starts
                around 9.4% of the image's height), so her photo is never
                covered. */}
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[9.2%] bg-ink" />
            <div className="absolute inset-x-0 top-0 h-[42px]">
              <HeroIntegratedNav />
            </div>
            {HERO_IMAGE_HOTSPOTS.map((hotspot) => {
              const style = {
                left: `${hotspot.rect.left}%`,
                top: `${hotspot.rect.top}%`,
                width: `${hotspot.rect.width}%`,
                height: `${hotspot.rect.height}%`,
              };
              return hotspot.external ? (
                <Link key={hotspot.label} href={hotspot.href} aria-label={hotspot.label} className={HERO_HOTSPOT_CLASS} style={style} />
              ) : (
                <a key={hotspot.label} href={hotspot.href} aria-label={hotspot.label} className={HERO_HOTSPOT_CLASS} style={style} />
              );
            })}
          </div>
          <Link
            href="/register"
            className={`${DESKTOP_HERO_CTA_CLASS} bg-gradient-to-r from-[#22d3ee] via-[#3b82f6] to-[#8b5cf6]`}
          >
            Mulai Promosikan
          </Link>
          <a href="#cara-kerja" className={`${DESKTOP_HERO_CTA_CLASS} border border-white/25 bg-ink`}>
            Lihat Cara Kerja
          </a>
        </div>
      </section>

      <div className="bg-background">
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-14 sm:px-6 sm:pb-24 sm:pt-16">
          <p className="mb-6 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Bagaimana LINOE Bekerja
          </p>
          <ProductVisual />
        </div>
      </div>
    </>
  );
}
