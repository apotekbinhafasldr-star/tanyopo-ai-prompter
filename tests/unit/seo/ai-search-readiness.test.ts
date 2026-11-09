import { describe, expect, it } from "vitest";
import {
  buildVerifiedFacts,
  findMissingFacts,
  formatFactsForPrompt,
  parseStoredAiSearchReadiness,
  sanitizeAiSearchReadiness,
} from "@/lib/seo/ai-search-readiness";
import { AiSearchReadinessSchema, type AiSearchReadinessAi } from "@/schemas/ai/ai-search-readiness";
import { SeoWithReadinessSchema, DiscoveryWithReadinessSchema } from "@/schemas/ai/seo-with-readiness";
import { SeoRecommendationsSchema } from "@/schemas/ai/seo-recommendations";
import { DiscoveryRecommendationsSchema } from "@/schemas/ai/discovery-recommendations";
import { buildDiscoveryRecommendationsPrompt, buildSeoRecommendationsPrompt } from "@/lib/ai/prompts";

const facts = buildVerifiedFacts({
  brand: { brand_name: "Kopi Nusa", default_location: "Bandung", whatsapp_number: "08123456789" },
  product: { name: "Kopi Robusta 200gr", description: "Biji kopi robusta sangrai medium", category: "Makanan & Minuman", price: 55000, currency: "IDR" },
});

const ai = (over: Partial<AiSearchReadinessAi> = {}): AiSearchReadinessAi => ({ ...base(), ...over });
function base(): AiSearchReadinessAi {
  return {
    customer_questions: [
      { question: "Berapa harga Kopi Robusta 200gr?", short_answer: "Harganya IDR 55000.", owner_input_needed: null },
      { question: "Dari mana kopinya?", short_answer: null, owner_input_needed: "Isi asal biji kopi." },
      { question: "Bagaimana cara pesan?", short_answer: "Pesan lewat WhatsApp 08123456789.", owner_input_needed: null },
    ],
    entity_context: "Kopi Nusa adalah bisnis kopi di Bandung.",
    content_recommendations: [{ title: "FAQ cara pesan", format: "FAQ", reason: "Menjawab pertanyaan umum" }],
    missing_facts: [],
  };
}

describe("buildVerifiedFacts", () => {
  it("hanya memuat data tenant; tidak ada fakta karangan", () => {
    expect(facts.map((f) => f.key)).toEqual([
      "brand_name", "location", "product_name", "product_description", "product_category", "product_price", "whatsapp",
    ]);
    expect(formatFactsForPrompt([])).toContain("belum ada fakta terverifikasi");
  });
  it("mengabaikan harga 0/null dan teks kosong", () => {
    const f = buildVerifiedFacts({ brand: { brand_name: "  " }, product: { name: "X", price: 0 } });
    expect(f.map((x) => x.key)).toEqual(["product_name"]);
  });
  it("findMissingFacts dihitung server", () => {
    expect(findMissingFacts(facts)).toEqual([]);
    expect(findMissingFacts(buildVerifiedFacts({ product: { name: "X" } }))).toContain("Harga produk");
  });
});

describe("sanitizeAiSearchReadiness", () => {
  it("mempertahankan jawaban yang berdasar fakta", () => {
    const out = sanitizeAiSearchReadiness(ai(), facts);
    expect(out.customer_questions[0].short_answer).toBe("Harganya IDR 55000.");
    expect(out.customer_questions[2].short_answer).toContain("08123456789");
    expect(out.removed_count).toBe(0);
  });
  it("membuang angka yang tidak ada di fakta", () => {
    const out = sanitizeAiSearchReadiness(
      ai({ customer_questions: [{ question: "Harga?", short_answer: "Hanya IDR 45000.", owner_input_needed: null }, ...base().customer_questions.slice(1)] }),
      facts,
    );
    expect(out.customer_questions[0].short_answer).toBeNull();
    expect(out.customer_questions[0].owner_input_needed).toBeTruthy();
    expect(out.removed_count).toBe(1);
  });
  it.each(["Sudah bersertifikat halal.", "Garansi uang kembali.", "Muncul di ChatGPT.", "Rating bintang 5 dari pelanggan.", "Produk terbaik."])(
    "membuang klaim terlarang: %s",
    (claim) => {
      const out = sanitizeAiSearchReadiness(
        ai({ customer_questions: [{ question: "Q?", short_answer: claim, owner_input_needed: null }, ...base().customer_questions.slice(1)] }),
        facts,
      );
      expect(out.customer_questions[0].short_answer).toBeNull();
    },
  );
  it("tanpa fakta apa pun, tidak ada jawaban maupun konteks entitas", () => {
    const out = sanitizeAiSearchReadiness(ai(), []);
    expect(out.customer_questions.every((q) => q.short_answer === null && q.owner_input_needed)).toBe(true);
    expect(out.entity_context).toBeNull();
  });
  it("membuang rekomendasi konten yang berisi klaim visibilitas AI", () => {
    const out = sanitizeAiSearchReadiness(
      ai({ content_recommendations: [{ title: "Agar muncul di ChatGPT", format: "ARTICLE", reason: "x" }, ...base().content_recommendations] }),
      facts,
    );
    expect(out.content_recommendations).toHaveLength(1);
  });
  it("menggabungkan fakta yang kurang dari server dan AI tanpa duplikat", () => {
    const f = buildVerifiedFacts({ product: { name: "X" } });
    const out = sanitizeAiSearchReadiness(ai({ missing_facts: ["Harga produk", "Asal bahan"] }), f);
    expect(out.missing_facts.filter((m) => m === "Harga produk")).toHaveLength(1);
    expect(out.missing_facts).toContain("Asal bahan");
  });
});

describe("parseStoredAiSearchReadiness (kompatibilitas data lama)", () => {
  it("baris lama tanpa kunci → null; null/bentuk lain → null", () => {
    expect(parseStoredAiSearchReadiness(null)).toBeNull();
    expect(parseStoredAiSearchReadiness({ primary_keywords: ["a"] })).toBeNull();
    expect(parseStoredAiSearchReadiness({ ai_search_readiness: "x" })).toBeNull();
  });
  it("round-trip hasil sanitizer", () => {
    const stored = sanitizeAiSearchReadiness(ai(), facts);
    expect(parseStoredAiSearchReadiness({ primary_keywords: ["a"], ai_search_readiness: stored })?.customer_questions).toHaveLength(3);
  });
});

describe("skema AI", () => {
  it("skema lama tetap tidak mewajibkan ai_search_readiness", () => {
    expect("ai_search_readiness" in SeoRecommendationsSchema.shape).toBe(false);
    expect("ai_search_readiness" in DiscoveryRecommendationsSchema.shape).toBe(false);
    expect("ai_search_readiness" in SeoWithReadinessSchema.shape).toBe(true);
    expect("ai_search_readiness" in DiscoveryWithReadinessSchema.shape).toBe(true);
  });
  it("tanpa .optional() (syarat strict structured outputs)", () => {
    for (const [key, field] of Object.entries(AiSearchReadinessSchema.shape)) {
      expect(field.safeParse(undefined).success, key).toBe(false);
    }
    expect(AiSearchReadinessSchema.safeParse(base()).success).toBe(true);
    expect(AiSearchReadinessSchema.safeParse({ ...base(), customer_questions: [] }).success).toBe(false);
  });
});

describe("prompt", () => {
  it("menyertakan fakta & larangan hanya bila verifiedFactsText diberikan", () => {
    const withFacts = buildDiscoveryRecommendationsPrompt({ verifiedFactsText: "- Nama produk: X" });
    expect(withFacts).toContain("ai_search_readiness");
    expect(withFacts).toContain("- Nama produk: X");
    expect(withFacts).toMatch(/testimoni/i);
    expect(withFacts).toMatch(/ChatGPT/);
    expect(buildDiscoveryRecommendationsPrompt({})).not.toContain("ai_search_readiness");
    expect(buildSeoRecommendationsPrompt({ websiteUrl: "https://a.id", targetKeywords: [], verifiedFactsText: "-" })).toContain("ai_search_readiness");
    expect(buildSeoRecommendationsPrompt({ websiteUrl: "https://a.id", targetKeywords: [] })).not.toContain("ai_search_readiness");
  });
});
