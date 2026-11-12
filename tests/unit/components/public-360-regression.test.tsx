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

  it("register: the legal checkbox sits inside a 44px hit area", () => {
    const form = src("features/auth/register-form.tsx");
    expect(form).toMatch(/size-11[^"]*"[\s\S]{0,200}id="acceptLegal"/);
    expect(form).not.toMatch(/id="acceptLegal"[\s\S]{0,200}size-4 /);
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
});
