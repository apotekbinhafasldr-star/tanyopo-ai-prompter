import { describe, expect, it } from "vitest";
import { buildLinoePublicFacts, isLinoeSelfEntity, ONLINE_PAYMENT_LIVE } from "@/lib/linoe/public-facts";
import { PLAN_TIERS } from "@/lib/billing/plans";
import { LEGAL } from "@/features/legal/legal-meta";
import {
  buildVerifiedFacts,
  formatFactsForPrompt,
  overstatesAvailability,
  sanitizeAiSearchReadiness,
} from "@/lib/seo/ai-search-readiness";
import { buildSystemPreamble, buildDiscoveryRecommendationsPrompt } from "@/lib/ai/prompts";
import type { AiSearchReadinessAi } from "@/schemas/ai/ai-search-readiness";

const LINOE_URL = "https://tanyopo-ai-prompter.netlify.app";
const facts = buildLinoePublicFacts();
const byKey = (k: string) => facts.find((f) => f.key === k)!;

describe("buildLinoePublicFacts — hanya dari sumber resmi", () => {
  it("pembayaran online belum aktif (gerbang Founder masih OFF)", () => {
    expect(ONLINE_PAYMENT_LIVE).toBe(false);
  });
  it("trial gratis TERSEDIA; paket berbayar SEGERA berlabel rencana + belum bisa dibeli; Agency TARGET", () => {
    expect(byKey("linoe_plan_free").status).toBe("TERSEDIA");
    for (const id of ["starter", "growth", "pro", "business"]) {
      const f = byKey(`linoe_plan_${id}`);
      expect(f.status, id).toBe("SEGERA");
      expect(f.value).toMatch(/harga rencana/);
      expect(f.value).toMatch(/belum bisa dibeli/);
    }
    expect(byKey("linoe_plan_agency").status).toBe("TARGET");
    expect(byKey("linoe_plan_agency").value).toMatch(/belum dibuka; harga target/);
    expect(byKey("linoe_payment_status").status).toBe("SEGERA");
  });
  it("harga sama persis dengan PLAN_TIERS (tidak ada angka karangan)", () => {
    for (const t of PLAN_TIERS.filter((p) => p.priceIDR > 0 && p.availability === "ACTIVE")) {
      expect(byKey(`linoe_plan_${t.id.toLowerCase()}`).value).toContain(t.priceIDR.toLocaleString("id-ID"));
    }
  });
  it("fitur 'segera hadir' tidak tercampur ke fitur tersedia", () => {
    const pro = byKey("linoe_plan_pro").value;
    expect(pro).toMatch(/Segera hadir \(belum tersedia\):.*A\/B testing/);
    expect(pro.split("Segera hadir")[0]).not.toMatch(/A\/B testing/);
  });
  it("kontak resmi = LEGAL; tidak membocorkan limit/kuota internal", () => {
    expect(byKey("linoe_contact").value).toContain(LEGAL.contactEmail);
    const all = formatFactsForPrompt(facts);
    expect(all).not.toMatch(/aiUsageAllowance|maxActive|maxUsers/);
    expect(all).toMatch(/\[SEGERA\]/);
    expect(all).toMatch(/\[TARGET\]/);
  });
});

const LINOE_BRAND = { brand_name: "LINOE by Tanyopo", website_url: LINOE_URL };
const hasLinoe = (f: { key: string }[]) => f.some((x) => x.key.startsWith("linoe_"));

describe("isLinoeSelfEntity — gerbang dua syarat (nama brand + website brand resmi)", () => {
  it("true hanya bila KEDUANYA terpenuhi", () => {
    expect(isLinoeSelfEntity(LINOE_BRAND)).toBe(true);
    expect(isLinoeSelfEntity({ brand_name: "Tanyopo Labs", website_url: "tanyopo-ai-prompter.netlify.app/harga" })).toBe(true);
    expect(isLinoeSelfEntity({ brand_name: "linoe", website_url: "https://www.tanyopo-ai-prompter.netlify.app" })).toBe(true);
  });
  it("nama LINOE tanpa website / website salah → false", () => {
    expect(isLinoeSelfEntity({ brand_name: "LINOE", website_url: null })).toBe(false);
    expect(isLinoeSelfEntity({ brand_name: "LINOE", website_url: "" })).toBe(false);
    expect(isLinoeSelfEntity({ brand_name: "LINOE", website_url: "https://linoe-fans.id" })).toBe(false);
  });
  it("website LINOE tetapi nama brand lain → false", () => {
    expect(isLinoeSelfEntity({ brand_name: "Kopi Nusa", website_url: LINOE_URL })).toBe(false);
    expect(isLinoeSelfEntity({ brand_name: null, website_url: LINOE_URL })).toBe(false);
    expect(isLinoeSelfEntity({ website_url: LINOE_URL })).toBe(false);
  });
  it("host tiruan/subdomain/URL rusak ditolak (cocok host persis)", () => {
    for (const u of [
      "https://tanyopo-ai-prompter.netlify.app.evil.com",
      "https://evil.com/tanyopo-ai-prompter.netlify.app",
      "https://x.tanyopo-ai-prompter.netlify.app",
      "https://tanyopo-ai-prompter.netlify.app@evil.com",
      "bukan url ::",
    ]) {
      expect(isLinoeSelfEntity({ brand_name: "LINOE", website_url: u }), u).toBe(false);
    }
    expect(isLinoeSelfEntity(null)).toBe(false);
    expect(isLinoeSelfEntity(undefined)).toBe(false);
  });
});

describe("buildVerifiedFacts — fakta LINOE tidak bocor ke tenant lain", () => {
  it("tenant biasa: tidak ada fakta LINOE sama sekali", () => {
    const f = buildVerifiedFacts({
      brand: { brand_name: "Kopi Nusa", website_url: "https://kopinusa.id" },
      product: { name: "Kopi", website_url: "https://kopinusa.id/kopi", price: 1000, currency: "IDR" },
    });
    expect(f.some((x) => x.status)).toBe(false);
    expect(hasLinoe(f)).toBe(false);
    expect(formatFactsForPrompt(f)).not.toMatch(/LINOE|Tanyopo|99\.000/i);
  });
  it("REGRESI: brand Kopi Nusa memakai URL LINOE sebagai referensi (brand/produk/project) → tanpa fakta LINOE", () => {
    const variants = [
      { brand: { brand_name: "Kopi Nusa", website_url: LINOE_URL }, product: { name: "Kopi" } },
      { brand: { brand_name: "Kopi Nusa" }, product: { name: "Kopi", website_url: LINOE_URL } },
      { brand: { brand_name: "Kopi Nusa" }, product: { name: "Kopi" }, projectWebsiteUrl: LINOE_URL },
      { brand: { brand_name: "Kopi Nusa", website_url: LINOE_URL }, product: { name: "Kopi", website_url: LINOE_URL }, projectWebsiteUrl: LINOE_URL },
    ];
    for (const v of variants) {
      const f = buildVerifiedFacts(v);
      expect(hasLinoe(f)).toBe(false);
      expect(f.some((x) => x.status)).toBe(false);
      expect(formatFactsForPrompt(f)).not.toMatch(/Tanyopo|tanyopofuturetechnology|Rp99\.000|\[SEGERA\]/);
    }
  });
  it("produk/project berURL LINOE tidak memicu walau brand bernama LINOE tanpa website brand", () => {
    expect(hasLinoe(buildVerifiedFacts({ brand: { brand_name: "LINOE" }, product: { name: "LINOE", website_url: LINOE_URL } }))).toBe(false);
    expect(hasLinoe(buildVerifiedFacts({ brand: { brand_name: "LINOE" }, projectWebsiteUrl: LINOE_URL }))).toBe(false);
  });
  it("brand LINOE tanpa website → tanpa fakta LINOE", () => {
    expect(hasLinoe(buildVerifiedFacts({ brand: { brand_name: "LINOE by Tanyopo" }, product: { name: "LINOE" } }))).toBe(false);
  });
  it("brand LINOE dengan website resmi → fakta publik ikut, semuanya berlabel status", () => {
    const f = buildVerifiedFacts({ brand: LINOE_BRAND, product: { name: "LINOE" } });
    expect(f.filter((x) => x.key.startsWith("linoe_")).length).toBeGreaterThan(5);
    expect(f.every((x) => !x.key.startsWith("linoe_") || x.status)).toBe(true);
    expect(f.find((x) => x.key === "linoe_plan_starter")?.status).toBe("SEGERA");
    expect(f.find((x) => x.key === "linoe_plan_agency")?.status).toBe("TARGET");
  });
  it("tenant tanpa website: tidak ada fakta LINOE", () => {
    expect(buildVerifiedFacts({ brand: { brand_name: "X" }, product: { name: "Y" } }).some((x) => x.status)).toBe(false);
  });
});

describe("sanitizer — status ketersediaan", () => {
  const selfFacts = buildVerifiedFacts({ brand: LINOE_BRAND, product: { name: "LINOE" } });
  const ai = (answer: string): AiSearchReadinessAi => ({
    customer_questions: [
      { question: "Berapa harga Starter?", short_answer: answer, owner_input_needed: null },
      { question: "A?", short_answer: null, owner_input_needed: "x" },
      { question: "B?", short_answer: null, owner_input_needed: "x" },
    ],
    entity_context: "LINOE dikembangkan oleh PT Tanyopo Future Technology.",
    content_recommendations: [{ title: "FAQ harga", format: "FAQ", reason: "r" }],
    missing_facts: [],
  });
  it("menolak jawaban yang menyebut paket SEGERA siap dibeli", () => {
    expect(overstatesAvailability("Starter Rp99.000/bulan, bisa dibeli sekarang.", selfFacts)).toBe(true);
    const out = sanitizeAiSearchReadiness(ai("Starter Rp99.000/bulan, siap dibeli."), selfFacts);
    expect(out.customer_questions[0].short_answer).toBeNull();
  });
  it("mengizinkan jawaban yang berlabel rencana", () => {
    const a = "Harga rencana Starter Rp99.000/bulan; pembayaran online belum aktif.";
    expect(sanitizeAiSearchReadiness(ai(a), selfFacts).customer_questions[0].short_answer).toBe(a);
  });
  it("tidak berlaku untuk tenant tanpa fakta SEGERA/TARGET", () => {
    expect(overstatesAvailability("Bisa dibeli sekarang.", buildVerifiedFacts({ product: { name: "Kopi" } }))).toBe(false);
  });
  it("batas 2 kalimat tidak memotong angka berpemisah titik (Rp99.000)", async () => {
    const { limitToTwoSentences } = await import("@/lib/seo/ai-search-readiness");
    expect(limitToTwoSentences("Starter Rp99.000/bulan, rencana. Pembayaran belum aktif. Tiga.")).toBe("Starter Rp99.000/bulan, rencana. Pembayaran belum aktif.");
  });
  it("produk belum dipilih → catatan 'Pilih produk' tampil lebih dulu, tanpa produk fallback", () => {
    const out = sanitizeAiSearchReadiness(ai("x"), [], new Date(), ["Pilih produk pada project SEO ini agar jawaban akurat"]);
    expect(out.missing_facts[0]).toMatch(/Pilih produk/);
    expect(out.missing_facts.length).toBeLessThanOrEqual(5);
  });
});

describe("konteks AI tenant dilengkapi dengan data milik tenant sendiri", () => {
  const brand = {
    tenant_id: "t1", brand_name: "Kopi Nusa", business_description: "Roastery kecil", what_do_you_sell: "Biji kopi sangrai",
    business_category: null, primary_goal: null, tone_of_voice: null, target_market: null, prohibited_claims: null,
    default_language: "id", default_location: "Bandung", default_currency: "IDR", default_timezone: "Asia/Jakarta",
    country_code: "ID", region: null, billing_country: null, logo_url: null, website_url: "https://kopinusa.id",
    whatsapp_number: "08123456789", onboarding_completed: true, onboarding_step: 5, created_at: "", updated_at: "",
  } as unknown as Parameters<typeof buildSystemPreamble>[0];
  it("preamble memuat yang dijual, lokasi, website, kontak — hanya jika diisi", () => {
    const p = buildSystemPreamble(brand);
    expect(p).toContain("Biji kopi sangrai");
    expect(p).toContain("Lokasi bisnis: Bandung");
    expect(p).toContain("https://kopinusa.id");
    expect(p).toContain("08123456789");
    const empty = buildSystemPreamble({ ...(brand as object), what_do_you_sell: null, default_location: null, website_url: null, whatsapp_number: null } as never);
    expect(empty).not.toMatch(/Lokasi bisnis|Website bisnis|Kontak bisnis|Yang dijual bisnis/);
  });
  it("preamble tenant tidak pernah memuat fakta LINOE", () => {
    expect(buildSystemPreamble(brand)).not.toMatch(/\[SEGERA\]|99\.000|tanyopofuturetechnology/);
  });
  it("prompt SEO memuat aturan label status", () => {
    expect(buildDiscoveryRecommendationsPrompt({ verifiedFactsText: "-" })).toMatch(/\[SEGERA\] atau \[TARGET\] BELUM tersedia/);
  });
});
