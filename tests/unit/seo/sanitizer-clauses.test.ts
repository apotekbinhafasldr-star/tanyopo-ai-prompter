import { describe, expect, it } from "vitest";
import { buildLinoePublicFacts } from "@/lib/linoe/public-facts";
import {
  buildVerifiedFacts,
  overstatesAvailability,
  removeOverstatedSentences,
  sanitizeAiSearchReadiness,
  scrubStatusClaims,
  STATUS_CLAIM_REMOVED_NOTE,
} from "@/lib/seo/ai-search-readiness";
import type { AiSearchReadinessAi } from "@/schemas/ai/ai-search-readiness";

const LINOE_URL = "https://tanyopo-ai-prompter.netlify.app";
const self = buildVerifiedFacts({ brand: { brand_name: "LINOE", website_url: LINOE_URL } });
const ai = (answer: string | null, extra: Partial<AiSearchReadinessAi> = {}): AiSearchReadinessAi => ({
  customer_questions: [
    { question: "Q1?", short_answer: answer, owner_input_needed: null },
    { question: "Q2?", short_answer: null, owner_input_needed: "x" },
    { question: "Q3?", short_answer: null, owner_input_needed: "x" },
  ],
  entity_context: "Entitas.",
  content_recommendations: [{ title: "FAQ", format: "FAQ", reason: "r" }],
  missing_facts: [],
  ...extra,
});

describe("klaim campuran: dievaluasi per kalimat/klausa, bukan kualifikator global", () => {
  const mixed = [
    "PUBLOE sudah tersedia untuk umum. Namun MITAPENG belum.",
    "PUBLOE sudah tersedia, tetapi paket Agency belum dibuka.",
    "MITAPENG bisa dicoba sekarang, sedangkan fitur lain masih rencana.",
    "PUBLOE sudah launching; LINOE belum menjual paket berbayar.",
    "PUBLOE masih dalam pengembangan dan sudah tersedia untuk publik.",
    "PUBLOE belum lengkap, MITAPENG dapat diakses oleh siapa saja.",
    "PUBLOE dan MITAPENG masih dalam pengembangan. Keduanya sudah tersedia.",
    "PUBLOE, MITAPENG dan LINOE sudah tersedia.",
    "Trial LINOE tersedia dan PUBLOE bisa dicoba hari ini.",
  ];
  it.each(mixed)("ditolak: %s", (text) => {
    expect(overstatesAvailability(text, self)).toBe(true);
  });

  const variants = [
    "PUBLOE dapat diakses.",
    "MITAPENG bisa dicoba.",
    "PUBLOE sudah launching.",
    "MITAPENG telah diluncurkan.",
    "PUBLOE sudah dirilis.",
    "MITAPENG available sekarang.",
    "PUBLOE sudah live.",
    "MITAPENG sudah dibuka untuk publik.",
    "Produk Tanyopo lain sudah tersedia.",
  ];
  it.each(variants)("variasi kata ditolak: %s", (text) => {
    expect(overstatesAvailability(text, self)).toBe(true);
  });

  it("paket berbayar: klaim bisa dibeli/aktif ditolak walau kalimat lain berkualifikator", () => {
    for (const bad of [
      "Paket Starter sudah tersedia. Paket Agency masih rencana.",
      "Starter bisa dibeli sekarang, sedangkan Agency masih rencana.",
      "Anda bisa berlangganan Growth hari ini.",
      "Pembayaran online sudah aktif.",
    ]) {
      expect(overstatesAvailability(bad, self), bad).toBe(true);
    }
  });

  it("status benar tetap lolos", () => {
    for (const ok of [
      "PUBLOE dan MITAPENG masih dalam pengembangan dan belum tersedia untuk publik; keduanya bukan bagian dari LINOE.",
      "PUBLOE sudah dalam tahap pengembangan.",
      "PUBLOE belum tersedia, MITAPENG juga belum tersedia.",
      "Paket Starter berharga Rp99.000 per bulan (harga rencana), pembayaran online belum aktif.",
      "Paket Agency belum dibuka.",
      "Starter belum bisa dibeli.",
    ]) {
      expect(overstatesAvailability(ok, self), ok).toBe(false);
    }
  });

  it("fakta resmi LINOE sendiri tidak pernah ditolak oleh sanitizer", () => {
    for (const f of buildLinoePublicFacts()) expect(overstatesAvailability(f.value, self), f.key).toBe(false);
  });
});

describe("klaim benar tentang yang TERSEDIA tidak ditolak", () => {
  it.each([
    "Trial gratis LINOE 14 hari sudah tersedia.",
    "Anda bisa mencoba LINOE gratis selama 14 hari.",
    "LINOE sudah dapat dipakai sebagai bisnis mandiri.",
  ])("lolos: %s", (text) => {
    expect(overstatesAvailability(text, self)).toBe(false);
    const out = sanitizeAiSearchReadiness(ai(text), self).customer_questions[0].short_answer;
    expect(out).toBe(text);
  });

  it("hanya kalimat yang berlebihan dibuang; kalimat benar dipertahankan", () => {
    const r = removeOverstatedSentences("Trial gratis 14 hari sudah tersedia. PUBLOE sudah tersedia.", self);
    expect(r.text).toBe("Trial gratis 14 hari sudah tersedia.");
    expect(r.removed).toBe(1);
    const out = sanitizeAiSearchReadiness(ai("Trial gratis 14 hari sudah tersedia. PUBLOE sudah tersedia."), self);
    expect(out.customer_questions[0].short_answer).toBe("Trial gratis 14 hari sudah tersedia.");
    expect(out.removed_count).toBe(1);
  });
});

describe("field output AI lain divalidasi", () => {
  it("rekomendasi konten, owner_input_needed dan missing_facts yang berlebihan dibuang", () => {
    const out = sanitizeAiSearchReadiness(
      ai(null, {
        content_recommendations: [
          { title: "PUBLOE sudah tersedia", format: "FAQ", reason: "Umumkan sekarang." },
          { title: "FAQ trial", format: "FAQ", reason: "Jelaskan trial 14 hari." },
        ],
        missing_facts: ["MITAPENG sudah launching", "Kontak WhatsApp"],
      }),
      self,
    );
    expect(out.content_recommendations.map((r) => r.title)).toEqual(["FAQ trial"]);
    expect(out.missing_facts).not.toContain("MITAPENG sudah launching");
    expect(out.missing_facts).toContain("Kontak WhatsApp");
    const o2 = sanitizeAiSearchReadiness(
      { ...ai(null), customer_questions: [{ question: "Q?", short_answer: null, owner_input_needed: "PUBLOE sudah aktif" }, ...ai(null).customer_questions.slice(1)] },
      self,
    );
    expect(o2.customer_questions[0].owner_input_needed).toMatch(/Lengkapi data/);
  });

  it("field legacy (summary, keywords, bio, ide konten, on-page) dibersihkan; struktur & enum utuh", () => {
    const data = {
      summary: "Trial tersedia. PUBLOE sudah tersedia.",
      bio_recommendation: "MITAPENG bisa dicoba sekarang.",
      primary_keywords: ["linoe trial", "PUBLOE sudah rilis", "ai marketing"],
      content_plan: [{ title: "Cara mencoba trial", target_keyword: "trial", content_type: "BLOG", angle: "PUBLOE dapat diakses." }],
    };
    const out = scrubStatusClaims(data, self);
    expect(out.summary).toBe("Trial tersedia.");
    expect(out.bio_recommendation).toBe(STATUS_CLAIM_REMOVED_NOTE);
    expect(out.primary_keywords).toEqual(["linoe trial", "ai marketing"]);
    expect(out.content_plan[0].content_type).toBe("BLOG");
    expect(out.content_plan[0].title).toBe("Cara mencoba trial");
    expect(out.content_plan[0].angle).toBe(STATUS_CLAIM_REMOVED_NOTE);
  });
});

describe("isolasi tenant: tenant biasa tidak terpengaruh", () => {
  const kopi = buildVerifiedFacts({
    brand: { brand_name: "Kopi Nusa", website_url: LINOE_URL },
    product: { name: "Kopi", price: 1000, currency: "IDR", description: "Kopi robusta" },
  });
  it("tanpa fakta SEGERA/TARGET, pemeriksa status tidak aktif dan teks tidak diubah", () => {
    const text = "Kopi kami sudah tersedia dan bisa dibeli sekarang. Starter bisa dibeli.";
    expect(overstatesAvailability(text, kopi)).toBe(false);
    const data = { summary: text, tags: ["PUBLOE sudah tersedia"] };
    expect(scrubStatusClaims(data, kopi)).toEqual(data);
    expect(kopi.some((f) => f.status)).toBe(false);
  });
  it("fakta LINOE tidak masuk ke tenant biasa", () => {
    expect(JSON.stringify(kopi).split(LINOE_URL).join("")).not.toMatch(/PUBLOE|MITAPENG|Starter|SEGERA/);
  });
  it("tenant biasa yang menyebut nama Tanyopo di fakta sendiri tidak diblokir berlebihan", () => {
    const f = buildVerifiedFacts({ brand: { brand_name: "Toko Mitra Tanyopo", website_url: "https://toko.example.com" }, product: { name: "Kopi", description: "Reseller resmi Tanyopo", price: 1000, currency: "IDR" } });
    const out = sanitizeAiSearchReadiness(ai("Toko Mitra Tanyopo adalah reseller resmi Tanyopo."), f);
    expect(out.customer_questions[0].short_answer).toBe("Toko Mitra Tanyopo adalah reseller resmi Tanyopo.");
  });
});
