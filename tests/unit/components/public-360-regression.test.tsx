import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { LegalLinks } from "@/features/legal/legal-links";

afterEach(cleanup);

const src = (rel: string) => readFileSync(path.resolve(__dirname, "../../..", rel), "utf8");

// jsdom has no layout, so these pin the class contract that the Playwright 360px job (qa-mobile-360 workflow)
// measures for real in a browser: every control on a phone is >=44px, and a horizontally scrolling region is
// reachable by keyboard.
describe("public pages at 360px: regression for the QA findings", () => {
  it("legal link row: every link is a 44px-tall target", () => {
    render(<LegalLinks />);
    for (const link of screen.getAllByRole("link")) expect(link.className).toMatch(/(^|\s)min-h-11(\s|$)/);
  });

  it("legal pages: table-of-contents and related-document links are 44px targets", () => {
    const parts = src("features/legal/legal-parts.tsx");
    expect(parts.match(/inline-flex min-h-11 items-center/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("register: the legal checkbox row is one 44px label (tapping the text toggles the box)", () => {
    const form = src("features/auth/register-form.tsx");
    expect(form).toMatch(/<label htmlFor="acceptLegal" className="[^"]*min-h-11/);
    expect(form).toMatch(/id="acceptLegal"[\s\S]{0,300}size-5/);
  });

  it("app screens: dropdowns are 44px on phones (h-11), compact only from sm", () => {
    for (const f of ["features/billing/plan-form.tsx", "features/settings/global-preferences-form.tsx", "features/analytics/conversion-form.tsx"]) {
      expect(src(f)).toMatch(/selectClass =\s*"h-11 sm:h-/);
    }
  });

  it("dashboard metric card: the aria-label sits on an element with a role (axe aria-prohibited-attr)", () => {
    expect(src("features/dashboard/metric-card.tsx")).toMatch(/role="img"[^>]*aria-label="Belum ada data"/);
  });

  it("marketing header menu button and logo links are >=44px", () => {
    expect(src("features/marketing/marketing-header.tsx")).toMatch(/"flex size-11 items-center justify-center/);
    expect(src("components/brand/linoe-logo.tsx")).toMatch(/min-h-11 min-w-11/);
    expect(src("features/marketing/components/hero-integrated-nav.tsx")).toMatch(/min-h-11 min-w-11/);
  });

  it("team carousel: slide dots and arrows are 44px buttons (dot is drawn inside)", () => {
    const c = src("features/marketing/components/team-carousel.tsx");
    expect(c).not.toMatch(/size-9/);
    expect(c).toMatch(/className="flex size-11 items-center justify-center"\s*>\s*<span\s+aria-hidden/);
  });

  it("how-it-works: the horizontally scrolling track is a focusable, labelled region", () => {
    const h = src("features/marketing/sections/how-it-works.tsx");
    expect(h).toMatch(/role="region" aria-label="Langkah cara kerja LINOE" tabIndex=\{0\}/);
  });

  it("settings compliance rows: every field has an accessible name (no bare select/input)", () => {
    const f = src("features/settings/compliance-flags-form.tsx");
    expect(f).toMatch(/<select name="status" aria-label=/);
    expect(f).toMatch(/<Input name="notes" aria-label=/);
    expect(f).toMatch(/<Input name="url" type="url" aria-label=/);
  });

  it("billing pricing cards: sub-text is dark enough on tinted card backgrounds (no muted-foreground on colour)", () => {
    expect(src("features/billing/pricing-cards.tsx")).not.toMatch(/subtext: "text-(muted-foreground|white\/80)"/);
  });

  it("billing: white-on-orange CTA uses orange-700 (contrast), not orange-600", () => {
    expect(src("features/billing/pricing-cards.tsx")).not.toMatch(/bg-(orange|emerald|sky)-600 text-white/);
  });

  it("demo: banner text is not muted-on-tint, and the long analytics CTA can wrap at 360px", () => {
    expect(src("app/demo/layout.tsx")).toMatch(/<p className="text-xs text-foreground">/);
    expect(src("app/demo/analytics/page.tsx")).toMatch(/max-w-full[^"]*whitespace-normal/);
  });
});
