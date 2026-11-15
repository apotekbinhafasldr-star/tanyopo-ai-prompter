import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { FAQS } from "@/features/marketing/faq-data";
import { LEGAL } from "@/features/legal/legal-meta";
import { buildLandingJsonLd, serializeJsonLd } from "@/lib/seo/json-ld";
import { ECOSYSTEM_IN_DEVELOPMENT, ONLINE_PAYMENT_LIVE } from "@/lib/linoe/public-facts";
import { PRODUCTION_ORIGIN } from "@/lib/seo/site-url";
import { isPublicAsset } from "@/proxy";
import sitemap from "@/app/sitemap";

// Proof that the AEO/GEO surface is actually wired into the public site and only states approved facts.
const read = (f: string) => readFileSync(f, "utf8");
const ld = () => JSON.parse(serializeJsonLd(buildLandingJsonLd(PRODUCTION_ORIGIN)));

describe("AEO/GEO wiring on the public site", () => {
  it("the landing page renders the JSON-LD script from the shared builder", () => {
    const page = read("app/(marketing)/page.tsx");
    expect(page).toContain('type="application/ld+json"');
    expect(page).toContain("buildLandingJsonLd(");
  });

  it("serialised JSON-LD is valid JSON and never carries rating, review or offer data", () => {
    const text = JSON.stringify(ld());
    expect(text).not.toMatch(/aggregateRating|ratingValue|reviewCount|"review"|"offers"|"price"/);
  });

  it("FAQPage contains the PUBLOE/MITAPENG status answer, matching the Founder-approved ecosystem list", () => {
    const faq = FAQS.find((f) => f.q === "Apakah PUBLOE dan MITAPENG sudah tersedia?");
    expect(faq).toBeDefined();
    for (const name of ECOSYSTEM_IN_DEVELOPMENT) expect(faq!.a).toContain(name);
    expect(faq!.a).toMatch(/^Belum\./);
    expect(faq!.a).toContain("belum tersedia untuk publik");
    expect(faq!.a).toContain("bukan bagian dari LINOE");
    const names = ld()["@graph"].find((n: { "@type": string }) => n["@type"] === "FAQPage").mainEntity.map((q: { name: string }) => q.name);
    expect(names).toContain(faq!.q);
  });

  it("no FAQ answer claims online payment is live while ONLINE_PAYMENT_LIVE is false", () => {
    expect(ONLINE_PAYMENT_LIVE).toBe(false);
    expect(FAQS.find((f) => f.q === "Berapa harga LINOE?")!.a).toContain("Pembayaran online belum aktif");
  });

  it("the FAQ never mentions PUBLOE/MITAPENG with any feature, price or date", () => {
    const a = FAQS.find((f) => f.q.includes("PUBLOE"))!.a;
    expect(a).not.toMatch(/Rp|\d|fitur|harga|rilis|peluncuran/i);
  });

  it("every FAQ and organisation contact uses the single legal email", () => {
    const org = ld()["@graph"].find((n: { "@type": string }) => n["@type"] === "Organization");
    expect(org.email).toBe(LEGAL.contactEmail);
  });

  it("sitemap lists only the landing and the four legal pages", () => {
    const paths = sitemap().map((e) => new URL(e.url).pathname);
    expect(paths.sort()).toEqual(["/", "/data-deletion", "/privacy", "/refund", "/terms"]);
  });
});

describe("llms.txt connection guard", () => {
  it("a public/llms.txt file may only exist if the proxy lets crawlers fetch /llms.txt without a session", () => {
    if (existsSync("public/llms.txt")) expect(isPublicAsset("/llms.txt")).toBe(true);
    else expect(existsSync("public/llms.txt")).toBe(false);
  });
});
