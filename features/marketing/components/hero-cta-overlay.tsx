import Link from "next/link";
import { ArrowRight } from "lucide-react";

/** Box in percent of the hero image (1536x477 JPG). */
export interface HeroRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where the baked-in "Mulai Promosikan Sekarang" button sits in
 * public/brand/linoe/08-hero-desktop-final.jpg (same box the old invisible
 * hotspot used, measured from the image's own pixels).
 */
export const HERO_CTA_RECT: HeroRect = { left: 3.78, top: 74.63, width: 18.03, height: 11.95 };

/**
 * Solid patch painted over the baked button and its glow so the real, navy
 * button replaces it. Wider than the button by ~0.4% each side and taller by
 * ~1.8% above and ~2.9% below (the glow reaches ~10px under the button). It
 * must stay left of the neighbouring "Lihat Cara Kerja" button (22.98%) and
 * below the paragraph text above it.
 */
export const HERO_CTA_MASK_RECT: HeroRect = { left: 3.4, top: 72.8, width: 18.9, height: 15.8 };

/** Where the neighbouring baked "Lihat Cara Kerja" button starts (% of image width). */
export const HERO_SECONDARY_CTA_LEFT = 22.98;

export function rectStyle(rect: HeroRect) {
  return {
    left: `${rect.left}%`,
    top: `${rect.top}%`,
    width: `${rect.width}%`,
    height: `${rect.height}%`,
  };
}

/**
 * Real, accessible navy CTA placed over the hero image's baked-in purple
 * button. The JPG, the logo and the layout are untouched; the parent box must
 * be `position: relative` with `container-type: inline-size` (its width drives
 * the font size and the short label below 1000px). Styles live in globals.css
 * (`.hero-cta*`) so the focus ring and border are not lost to the cascade.
 */
export function HeroCtaOverlay() {
  return (
    <>
      <div aria-hidden className="hero-cta-mask" style={rectStyle(HERO_CTA_MASK_RECT)} />
      <Link href="/register" className="hero-cta action-btn action-btn--on-dark" style={rectStyle(HERO_CTA_RECT)}>
        <span>
          Mulai Promosikan<span className="hero-cta-long"> Sekarang</span>
        </span>
        <ArrowRight aria-hidden />
      </Link>
    </>
  );
}
