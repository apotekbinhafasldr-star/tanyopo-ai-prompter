import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";

import { legalMetadata, LEGAL_LINKS } from "@/features/legal/legal-meta";
import { OG_IMAGE, SITE_DESCRIPTION, SITE_TITLE } from "@/lib/seo/og";
import { getSiteOrigin, PRODUCTION_ORIGIN } from "@/lib/seo/site-url";

afterEach(() => vi.unstubAllEnvs());

const read = (f: string) => readFileSync(f, "utf8");

describe("SEO Phase 2A — metadata base & canonical", () => {
  it("root layout derives metadataBase from getSiteOrigin()", () => {
    const src = read("app/layout.tsx");
    expect(src).toContain("new URL(getSiteOrigin())");
    expect(src).not.toContain("process.env.NEXT_PUBLIC_APP_URL");
  });

  it("origin falls back to production and never to localhost", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    vi.stubEnv("URL", "");
    expect(getSiteOrigin()).toBe(PRODUCTION_ORIGIN);
    expect(getSiteOrigin()).not.toMatch(/localhost|127\.0\.0\.1/);
  });

  it("landing declares canonical '/' and a landing og:url", () => {
    const src = read("app/(marketing)/page.tsx");
    expect(src).toContain('alternates: { canonical: "/" }');
    expect(src).toContain('url: "/"');
  });

  it("legal pages keep their own canonical and stay indexable", () => {
    for (const l of LEGAL_LINKS) {
      const m = legalMetadata({ title: l.label, description: "d", path: l.href });
      expect(m.alternates?.canonical).toBe(l.href);
      expect(m.openGraph?.url).toBe(l.href);
      expect(m.robots).toEqual({ index: true, follow: true });
    }
  });
});

describe("SEO Phase 2A — Open Graph & Twitter", () => {
  it("static OG PNG exists and is 1200x630", () => {
    const file = `public${OG_IMAGE.url}`;
    expect(existsSync(file)).toBe(true);
    const buf = readFileSync(file);
    expect(buf.subarray(1, 4).toString()).toBe("PNG");
    expect(buf.readUInt32BE(16)).toBe(1200);
    expect(buf.readUInt32BE(20)).toBe(630);
    expect(OG_IMAGE.width).toBe(1200);
    expect(OG_IMAGE.height).toBe(630);
    expect(OG_IMAGE.alt.length).toBeGreaterThan(0);
  });

  it("uses a static image, not a dynamic opengraph-image route", () => {
    expect(existsSync("app/opengraph-image.tsx")).toBe(false);
    expect(existsSync("app/(marketing)/opengraph-image.tsx")).toBe(false);
  });

  it("legal pages carry the OG image and summary_large_image", () => {
    const m = legalMetadata({ title: "Kebijakan Privasi", description: "d", path: "/privacy" });
    expect(m.openGraph?.images).toEqual([OG_IMAGE]);
    expect((m.twitter as { card?: string }).card).toBe("summary_large_image");
  });

  it("root layout and landing declare OG image + summary_large_image", () => {
    for (const f of ["app/layout.tsx", "app/(marketing)/page.tsx"]) {
      const src = read(f);
      expect(src, f).toContain("images: [OG_IMAGE]");
      expect(src, f).toContain('card: "summary_large_image"');
    }
  });

  it("description explains the product, mentions the 14-day trial, no sales promises", () => {
    expect(SITE_TITLE).toContain("LINOE");
    expect(SITE_DESCRIPTION).toContain("14 hari");
    expect(SITE_DESCRIPTION).toMatch(/campaign/);
    expect(SITE_DESCRIPTION).not.toMatch(/omzet|penjualan naik|dijamin|garansi|TikTok|\bX\b/i);
  });
});

describe("SEO Phase 2A — integration claim accuracy", () => {
  const files = [
    "features/marketing/sections/faq.tsx",
    "features/marketing/sections/trust.tsx",
    "features/marketing/sections/omnichannel.tsx",
  ];

  it("FAQ separates connection / preparation / publication and marks TikTok & X as in development", () => {
    const src = read("features/marketing/sections/faq.tsx");
    expect(src).toContain("TikTok dan X, publikasi campaign masih dalam pengembangan");
    expect(src).toContain("menunggu persetujuan");
  });

  it("no marketing copy claims TikTok/X campaign launch or end-to-end integration", () => {
    for (const f of files) {
      const src = read(f);
      expect(src, f).not.toMatch(/(TikTok|\bX\b)[^.\n]{0,60}(meluncurkan|menayangkan|publikasi otomatis|end-to-end)/i);
      expect(src, f).not.toMatch(/OAuth resmi ke Facebook, Instagram, TikTok/);
    }
  });
});
