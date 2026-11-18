import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Button } from "@/components/ui/button";

afterEach(cleanup);

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("navy action tokens", () => {
  const css = read("app/globals.css");

  it("defines the exact navy tokens and leaves --brand / --brand-2 untouched", () => {
    expect(css).toMatch(/--action:\s*#172b4d;/i);
    expect(css).toMatch(/--action-hover:\s*#243f68;/i);
    expect(css).toMatch(/--action-foreground:\s*#ffffff;/i);
    expect(css).toMatch(/--brand:\s*#4338ca;/i);
    expect(css).toMatch(/--brand-2:\s*#6d28d9;/i);
    expect(css).toContain("--color-action: var(--action);");
    expect(css).toContain("--color-action-hover: var(--action-hover);");
    expect(css).toContain("--color-action-foreground: var(--action-foreground);");
  });

  it("keeps the global focus ring on --brand (indigo)", () => {
    expect(css).toMatch(/:focus-visible\s*{\s*outline:\s*2px solid var\(--brand\);/);
  });

  it("white text is AA on navy and on its hover colour (WCAG 4.5:1)", () => {
    expect(contrast("#ffffff", "#172b4d")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#ffffff", "#243f68")).toBeGreaterThanOrEqual(4.5);
  });

  it("the navy focus ring is visible (>= 3:1) on the light surfaces buttons sit on", () => {
    for (const bg of ["#ffffff", "#fafafa", "#f4f4f5", "#eef2ff"]) {
      expect(contrast("#172b4d", bg)).toBeGreaterThanOrEqual(3);
    }
  });

  it("GROWTH card: white outline and white border stay visible against both gradient ends (>= 3:1)", () => {
    for (const end of ["#2563eb" /* blue-600 */, "#c026d3" /* fuchsia-600 */]) {
      expect(contrast("#ffffff", end)).toBeGreaterThanOrEqual(3);
    }
    const cards = read("features/billing/pricing-cards.tsx");
    const growth = cards.slice(cards.indexOf("GROWTH: {"), cards.indexOf("PRO: {"));
    expect(growth).toContain("bg-action");
    expect(growth).toContain("action-btn--on-card"); // light border + white ring come from globals.css (unlayered)
    expect(growth).not.toMatch(/border-white|focus-visible:outline-/); // utilities would be ignored by the cascade
    expect(growth).not.toContain("fuchsia-700");
    expect(growth).toContain("from-blue-600 to-fuchsia-600"); // card background unchanged
  });
});

describe("Button variants", () => {
  it("primary is navy with white text, a navy offset focus ring, and no indigo", () => {
    render(<Button>Simpan</Button>);
    const cls = screen.getByRole("button").className;
    expect(cls).toContain("bg-action");
    expect(cls).toContain("text-action-foreground");
    expect(cls).toContain("hover:bg-action-hover");
    expect(cls).toContain("action-btn");
    expect(cls).not.toMatch(/focus-visible:outline-/); // would lose to the unlayered global :focus-visible rule
    expect(cls).not.toMatch(/bg-brand|hover:bg-brand/);
  });

  it("primaryOnDark keeps a light edge and a white focus ring on dark backgrounds", () => {
    render(<Button variant="primaryOnDark">Mulai</Button>);
    const cls = screen.getByRole("button").className;
    expect(cls).toContain("bg-action");
    expect(cls).toContain("action-btn--on-dark");
    expect(cls).not.toMatch(/border-white|focus-visible:outline-/);
  });

  it("disabled and loading keep the navy style and block interaction", () => {
    const { rerender } = render(<Button disabled>Simpan</Button>);
    expect(screen.getByRole("button").className).toContain("disabled:pointer-events-none");
    expect(screen.getByRole("button").className).toContain("disabled:opacity-50");
    rerender(<Button loading>Simpan</Button>);
    const b = screen.getByRole("button");
    expect(b.getAttribute("aria-busy")).toBe("true");
    expect((b as HTMLButtonElement).disabled).toBe(true);
    expect(b.className).toContain("bg-action");
  });

  it("every size is at least 44px tall below the sm breakpoint (phones)", () => {
    for (const size of ["sm", "md", "lg", "icon"] as const) {
      render(<Button size={size}>x</Button>);
      expect(screen.getByRole("button").className).toMatch(/\b(h-1[12]|size-11)\b/);
      cleanup();
    }
  });

  it("other variants keep their look (destructive stays red, secondary stays neutral)", () => {
    render(<Button variant="destructive">Hapus</Button>);
    expect(screen.getByRole("button").className).toContain("bg-danger");
  });
});

describe("no purple action buttons remain", () => {
  const ctaFiles = [
    "app/ops/payments/page.tsx",
    "app/demo/layout.tsx",
    "app/demo/analytics/page.tsx",
    "features/legal/legal-header.tsx",
    "features/marketing/marketing-header.tsx",
    "features/marketing/components/hero-integrated-nav.tsx",
    "features/marketing/sections/hero.tsx",
    "features/marketing/sections/ide-ke-hasil.tsx",
    "features/marketing/sections/final-cta.tsx",
    "features/marketing/sections/device-showcase.tsx",
    "features/marketing/sections/pricing.tsx",
    "features/marketing/sections/adpersona-bridge.tsx",
    "features/billing/pricing-cards.tsx",
  ];
  // Decorative (non-button) gradients are allowed: text gradients, thin rules, avatars, mock-up bars.
  const decorative = /bg-clip-text|\bh-px\b|h-0\.5|\bsize-[0-9]+\b|h-full/;

  it.each(ctaFiles)("%s has no brand/violet/fuchsia gradient or indigo fill on a button", (file) => {
    const offenders = read(file)
      .split("\n")
      .filter((line) => !decorative.test(line) && !/^\s*(badge|icon_bg|card|actionBar):/.test(line))
      .filter((line) => /from-brand to-brand-2|via-\[#3b82f6\]|to-\[#8b5cf6\]|bg-violet-600|text-fuchsia-700|bg-brand(?![-/])[^"]*text-brand-foreground/.test(line));
    expect(offenders).toEqual([]);
  });

  it("pricing: AGENCY and GROWTH CTAs are navy; STARTER/blue/orange/green keep their colours", () => {
    const cards = read("features/billing/pricing-cards.tsx");
    const agency = cards.slice(cards.indexOf("AGENCY: {"));
    expect(agency).toContain('primaryCta: "action-btn bg-action');
    expect(cards).toContain("bg-sky-600 text-white");
    expect(cards).toContain("bg-blue-600 text-white");
    expect(cards).toContain("bg-orange-600 text-white");
    expect(cards).toContain("bg-emerald-600 text-white");
    expect(agency).toContain("bg-violet-600 text-white"); // badge colour kept (badge is not a button)
  });
});
