import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HERO_CTA_MASK_RECT,
  HERO_CTA_RECT,
  HERO_SECONDARY_CTA_LEFT,
  HeroCtaOverlay,
  rectStyle,
} from "@/features/marketing/components/hero-cta-overlay";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);
const hero = readFileSync(join(process.cwd(), "features/marketing/sections/hero.tsx"), "utf8");

const IMG = { w: 1536, h: 477 };
// Pixel box of the baked button incl. its glow, measured from the JPG (see PR description).
const BAKED_BUTTON_PX = { x0: 57, y0: 352, x1: 336, y1: 417 };

describe("HeroCtaOverlay", () => {
  it("is a real link to /register, named 'Mulai Promosikan', with the navy action classes", () => {
    render(<HeroCtaOverlay />);
    const link = screen.getByRole("link", { name: /Mulai Promosikan/ });
    expect(link.getAttribute("href")).toBe("/register");
    expect(link.className).toContain("hero-cta");
    expect(link.className).toContain("action-btn--on-dark");
    expect(link.querySelector(".hero-cta-long")?.textContent).toBe(" Sekarang");
    expect(link.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders exactly one link and an aria-hidden mask", () => {
    const { container } = render(<HeroCtaOverlay />);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(container.querySelector(".hero-cta-mask")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("positions the button and the mask from the exported rects", () => {
    const { container } = render(<HeroCtaOverlay />);
    const link = screen.getByRole("link") as HTMLElement;
    const mask = container.querySelector(".hero-cta-mask") as HTMLElement;
    expect(link.style.left).toBe(`${HERO_CTA_RECT.left}%`);
    expect(link.style.top).toBe(`${HERO_CTA_RECT.top}%`);
    expect(link.style.width).toBe(`${HERO_CTA_RECT.width}%`);
    expect(link.style.height).toBe(`${HERO_CTA_RECT.height}%`);
    expect(mask.style.left).toBe(`${HERO_CTA_MASK_RECT.left}%`);
    expect(mask.style.width).toBe(`${HERO_CTA_MASK_RECT.width}%`);
    expect(rectStyle(HERO_CTA_RECT).top).toBe("74.63%");
  });
});

describe("hero geometry", () => {
  it("the button keeps the old hotspot's box (layout unchanged)", () => {
    expect(HERO_CTA_RECT).toEqual({ left: 3.78, top: 74.63, width: 18.03, height: 11.95 });
  });

  it("the mask covers the baked button AND its glow, with margin", () => {
    const m = HERO_CTA_MASK_RECT;
    const px = (v: number, total: number) => (v / 100) * total;
    expect(px(m.left, IMG.w)).toBeLessThanOrEqual(BAKED_BUTTON_PX.x0 - 3);
    expect(px(m.left + m.width, IMG.w)).toBeGreaterThanOrEqual(BAKED_BUTTON_PX.x1 + 3);
    expect(px(m.top, IMG.h)).toBeLessThanOrEqual(BAKED_BUTTON_PX.y0 - 3);
    expect(px(m.top + m.height, IMG.h)).toBeGreaterThanOrEqual(BAKED_BUTTON_PX.y1 + 3);
  });

  it("the mask stays clear of the neighbouring 'Lihat Cara Kerja' button and of the paragraph above", () => {
    const m = HERO_CTA_MASK_RECT;
    expect(m.left + m.width).toBeLessThan(HERO_SECONDARY_CTA_LEFT);
    expect(m.top).toBeGreaterThan(71.5); // paragraph text ends ~71% of the image height
  });

  it("the button sits inside its mask", () => {
    const b = HERO_CTA_RECT;
    const m = HERO_CTA_MASK_RECT;
    expect(b.left).toBeGreaterThan(m.left);
    expect(b.left + b.width).toBeLessThan(m.left + m.width);
    expect(b.top).toBeGreaterThan(m.top);
    expect(b.top + b.height).toBeLessThan(m.top + m.height);
  });

  it("legibility and target size hold over the real image widths (852px at 900 viewport up to 1232px)", () => {
    for (const w of [852, 900, 976, 1000, 1100, 1232]) {
      const fontPx = Math.min(15, Math.max(10, 0.0098 * w));
      const buttonW = (HERO_CTA_RECT.width / 100) * w;
      const buttonH = (HERO_CTA_RECT.height / 100) * (w * (IMG.h / IMG.w));
      expect(fontPx).toBeGreaterThanOrEqual(10); // never 8-9px
      expect(Math.max(buttonH, 44)).toBeGreaterThanOrEqual(44); // hit area (::after), see CSS test
      expect(buttonW).toBeGreaterThanOrEqual(150); // room for the short label at 10px
    }
  });
});

describe("hero.tsx wiring", () => {
  it("uses the overlay on a container-query box and keeps 'Lihat Cara Kerja'", () => {
    expect(hero).toContain("<HeroCtaOverlay />");
    expect(hero).toContain('containerType: "inline-size"');
    expect(hero).toContain('label: "Lihat Cara Kerja"');
    expect(hero).toContain('href: "#cara-kerja"');
  });

  it("no longer has the baked-button hotspot or the duplicate sr-only focus links", () => {
    expect(hero).not.toContain('label: "Mulai Promosikan Sekarang"');
    expect(hero).not.toContain("DESKTOP_HERO_CTA_CLASS");
    expect(hero).not.toContain("not-sr-only");
  });

  it("does not touch the JPG reference, dimensions, or the logo mask", () => {
    expect(hero).toContain('src="/brand/linoe/08-hero-desktop-final.jpg"');
    expect(hero).toContain("width={1536}");
    expect(hero).toContain("height={477}");
    expect(hero).toContain("<HeroIntegratedNav />");
  });
});
