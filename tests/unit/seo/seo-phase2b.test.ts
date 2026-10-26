import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";

import { FAQS } from "@/features/marketing/faq-data";
import { LEGAL } from "@/features/legal/legal-meta";
import { buildLandingJsonLd, serializeJsonLd, JSON_LD_DESCRIPTION } from "@/lib/seo/json-ld";
import { getSiteOrigin, PRODUCTION_ORIGIN } from "@/lib/seo/site-url";

afterEach(() => vi.unstubAllEnvs());
const read = (f: string) => readFileSync(f, "utf8");

type LdNode = Record<string, unknown> & { "@type": string };
const graph = (o = PRODUCTION_ORIGIN) => buildLandingJsonLd(o)["@graph"] as unknown as LdNode[];
const byType = (t: string) => graph().filter((n) => n["@type"] === t);

describe("SEO Phase 2B — JSON-LD", () => {
  it("is valid JSON with one Organization, one SoftwareApplication, one FAQPage (no duplicates)", () => {
    const parsed = JSON.parse(serializeJsonLd(buildLandingJsonLd(PRODUCTION_ORIGIN)));
    expect(parsed["@context"]).toBe("https://schema.org");
    expect(byType("Organization")).toHaveLength(1);
    expect(byType("SoftwareApplication")).toHaveLength(1);
    expect(byType("FAQPage")).toHaveLength(1);
  });

  it("Organization uses the verified legal identity only", () => {
    const org = byType("Organization")[0];
    expect(org.name).toBe("PT Tanyopo Future Technology");
    expect(org.email).toBe(LEGAL.contactEmail);
    expect(org.address).toBe("Ladang Rimba, Aceh Selatan, Indonesia");
    for (const k of ["telephone", "sameAs", "logo", "aggregateRating", "review", "award", "hasCertification"]) {
      expect(org, k).not.toHaveProperty(k);
    }
  });

  it("SoftwareApplication matches required fields and has no offers/ratings", () => {
    const app = byType("SoftwareApplication")[0];
    expect(app.name).toBe("LINOE");
    expect(app.alternateName).toBe("LINOE by Tanyopo");
    expect(app.applicationCategory).toBe("BusinessApplication");
    expect(app.operatingSystem).toBe("Web");
    expect(String(app.description)).toContain("14 hari");
    for (const k of ["offers", "aggregateRating", "review", "price"]) expect(app, k).not.toHaveProperty(k);
  });

  it("uses the production origin, never localhost, and respects getSiteOrigin()", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    vi.stubEnv("URL", "");
    const json = serializeJsonLd(buildLandingJsonLd(getSiteOrigin()));
    expect(json).toContain(PRODUCTION_ORIGIN);
    expect(json).not.toMatch(/localhost|127\.0\.0\.1/);
  });

  it("FAQPage is generated from the same data the landing renders", () => {
    const faq = byType("FAQPage")[0].mainEntity as { name: string; acceptedAnswer: { text: string } }[];
    expect(faq).toHaveLength(FAQS.length);
    faq.forEach((q, i) => {
      expect(q.name).toBe(FAQS[i].q);
      expect(q.acceptedAnswer.text).toBe(FAQS[i].a);
    });
    const faqUi = read("features/marketing/sections/faq.tsx");
    expect(faqUi).toContain('from "@/features/marketing/faq-data"');
    expect(faqUi).not.toContain("const FAQS");
  });

  it("makes no false integration, payment, or sales-result claims", () => {
    const json = serializeJsonLd(buildLandingJsonLd(PRODUCTION_ORIGIN)) + JSON_LD_DESCRIPTION;
    expect(json).not.toMatch(/omzet|penjualan naik|dijamin|garansi|rating|ratingValue|reviewCount|"offers"/i);
    expect(json).not.toMatch(/pembayaran (online )?(sudah )?aktif/i);
    // TikTok/X appear only inside the honest FAQ answer that says publication is in development.
    const answers = FAQS.filter((f) => /TikTok|\bX\b/.test(f.a));
    for (const f of answers) expect(f.a).toContain("masih dalam pengembangan");
  });

  it("contains no tenant/user data sources", () => {
    const imports = read("lib/seo/json-ld.ts").split("\n").filter((l) => l.startsWith("import "));
    expect(imports.join("\n")).not.toMatch(/supabase|auth|billing|tenant|workspace|next\/headers/i);
  });

  it("serialization escapes HTML/script-breaking characters", () => {
    const out = serializeJsonLd({ a: "</script><script>alert(1)</script> & <b>", b: "\u2028" });
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out).not.toContain("&");
    expect(JSON.parse(out).a).toBe("</script><script>alert(1)</script> & <b>");
  });

  it("is rendered only on the landing page, not in root layout or private areas", () => {
    expect(read("app/(marketing)/page.tsx")).toContain("application/ld+json");
    expect(read("app/layout.tsx")).not.toContain("ld+json");
    expect(read("app/(marketing)/layout.tsx")).not.toContain("ld+json");
    expect(existsSync("app/ld.json")).toBe(false);
  });

  it("does not regress canonical/OG from Phase 2A", () => {
    const page = read("app/(marketing)/page.tsx");
    expect(page).toContain('alternates: { canonical: "/" }');
    expect(page).toContain("images: [OG_IMAGE]");
  });
});
