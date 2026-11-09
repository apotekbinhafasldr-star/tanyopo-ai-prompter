import type { AiSearchReadinessAi } from "@/schemas/ai/ai-search-readiness";

/**
 * Fakta terverifikasi = data yang diisi tenant sendiri di LINOE (profil brand,
 * produk, project SEO). Disusun deterministik di server, TIDAK oleh AI, dan
 * itulah satu-satunya dasar jawaban AEO. Tidak ada testimoni, rating, angka
 * penjualan, atau klaim visibilitas AI yang dibuat di sini.
 */
export interface VerifiedFact {
  key: string;
  label: string;
  value: string;
}

export interface FactSources {
  brand?: {
    brand_name?: string | null;
    business_description?: string | null;
    what_do_you_sell?: string | null;
    default_location?: string | null;
    whatsapp_number?: string | null;
    website_url?: string | null;
    default_language?: string | null;
  } | null;
  product?: {
    name?: string | null;
    description?: string | null;
    category?: string | null;
    price?: number | null;
    currency?: string | null;
    website_url?: string | null;
    target_countries?: unknown;
    language?: string | null;
  } | null;
  projectWebsiteUrl?: string | null;
}

const clean = (v: unknown, max = 500): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

export function buildVerifiedFacts(src: FactSources): VerifiedFact[] {
  const facts: VerifiedFact[] = [];
  const add = (key: string, label: string, value: string | null) => {
    if (value) facts.push({ key, label, value });
  };
  const b = src.brand;
  const p = src.product;
  add("brand_name", "Nama bisnis", clean(b?.brand_name, 120));
  add("business_description", "Deskripsi bisnis", clean(b?.business_description));
  add("what_do_you_sell", "Yang dijual", clean(b?.what_do_you_sell));
  add("location", "Lokasi", clean(b?.default_location, 120));
  add("product_name", "Nama produk", clean(p?.name, 200));
  add("product_description", "Deskripsi produk", clean(p?.description));
  add("product_category", "Kategori produk", clean(p?.category, 100));
  if (typeof p?.price === "number" && Number.isFinite(p.price) && p.price > 0) {
    add("product_price", "Harga produk", `${p.currency ?? "IDR"} ${p.price}`);
  }
  const countries = Array.isArray(p?.target_countries)
    ? (p.target_countries as unknown[]).filter((c): c is string => typeof c === "string")
    : [];
  add("target_countries", "Target negara", countries.length ? countries.join(", ") : null);
  add("website", "Website", clean(p?.website_url ?? src.projectWebsiteUrl ?? b?.website_url, 300));
  add("whatsapp", "Kontak WhatsApp", clean(b?.whatsapp_number, 40));
  return facts;
}

const RECOMMENDED: { key: string; label: string }[] = [
  { key: "product_description", label: "Deskripsi produk" },
  { key: "product_category", label: "Kategori produk" },
  { key: "product_price", label: "Harga produk" },
  { key: "location", label: "Lokasi bisnis" },
  { key: "whatsapp", label: "Kontak WhatsApp/pemesanan" },
];

/** Fakta penting yang belum ada — dihitung server, bukan ditebak AI. */
export function findMissingFacts(facts: VerifiedFact[]): string[] {
  const have = new Set(facts.map((f) => f.key));
  return RECOMMENDED.filter((r) => !have.has(r.key)).map((r) => r.label);
}

export function formatFactsForPrompt(facts: VerifiedFact[]): string {
  return facts.length
    ? facts.map((f) => `- ${f.label}: ${f.value}`).join("\n")
    : "(belum ada fakta terverifikasi)";
}

// Klaim yang tidak boleh muncul di jawaban/konteks: jaminan, ranking/visibilitas AI,
// testimoni/rating, superlatif tak terbukti.
const FORBIDDEN_CLAIMS =
  /\b(garansi|dijamin|menjamin|pasti laku|terlaris|nomor\s*1|no\.?\s*1|terbaik|ranking|peringkat|muncul di (chatgpt|gemini|perplexity|google)|chatgpt|gemini|perplexity|ai overview|testimoni|ulasan pelanggan|rating|bintang\s*\d|review pelanggan|terbukti|100%|bersertifikat|bpom|halal)\b/i;

const NUMBER_RE = /\d[\d.,]*/g;
const norm = (s: string) => s.replace(/[.,\s]/g, "");

function numbersAllowed(text: string, factsText: string): boolean {
  const allowed = new Set((factsText.match(NUMBER_RE) ?? []).map(norm));
  return (text.match(NUMBER_RE) ?? []).every((n) => allowed.has(norm(n)));
}

/** Klaim sensitif hanya lolos bila kata itu memang ada di fakta tenant sendiri. */
function claimsAllowed(text: string, factsText: string): boolean {
  const m = text.match(new RegExp(FORBIDDEN_CLAIMS.source, "gi")) ?? [];
  const lowerFacts = factsText.toLowerCase();
  return m.every((w) => lowerFacts.includes(w.toLowerCase()));
}

export function isGroundedText(text: string, factsText: string): boolean {
  return numbersAllowed(text, factsText) && claimsAllowed(text, factsText);
}

export interface StoredAiSearchReadiness {
  version: 1;
  generated_at: string;
  verified_facts: VerifiedFact[];
  missing_facts: string[];
  customer_questions: { question: string; short_answer: string | null; owner_input_needed: string | null }[];
  entity_context: string | null;
  content_recommendations: AiSearchReadinessAi["content_recommendations"];
  /** Jumlah jawaban/konteks yang dibuang pemeriksa karena tidak berdasar fakta. */
  removed_count: number;
}

/**
 * Pemeriksa pasca-AI (heuristik, bukan jaminan): jawaban yang memuat angka yang
 * tidak ada di fakta, atau klaim jaminan/ranking/testimoni, dibuang → pertanyaan
 * tetap tampil dengan "perlu dilengkapi pemilik". Tidak ada jawaban saat fakta kosong.
 */
export function sanitizeAiSearchReadiness(
  ai: AiSearchReadinessAi,
  facts: VerifiedFact[],
  now: Date = new Date(),
): StoredAiSearchReadiness {
  const factsText = facts.map((f) => f.value).join(" \n ");
  let removed = 0;
  const questions = ai.customer_questions.map((q) => {
    let answer = clean(q.short_answer, 600);
    if (answer && (facts.length === 0 || !isGroundedText(answer, factsText))) {
      answer = null;
      removed++;
    }
    return {
      question: q.question.trim(),
      short_answer: answer,
      owner_input_needed: answer
        ? null
        : clean(q.owner_input_needed, 300) ?? "Lengkapi data produk/bisnis agar pertanyaan ini bisa dijawab akurat.",
    };
  });
  let entity = clean(ai.entity_context, 600);
  if (entity && (facts.length === 0 || !isGroundedText(entity, factsText))) {
    entity = null;
    removed++;
  }
  const recs = ai.content_recommendations.filter((r) => {
    const ok = claimsAllowed(`${r.title} ${r.reason}`, factsText);
    if (!ok) removed++;
    return ok;
  });
  const missing = Array.from(new Set([...findMissingFacts(facts), ...ai.missing_facts.map((m) => m.trim()).filter(Boolean)])).slice(0, 10);
  return {
    version: 1,
    generated_at: now.toISOString(),
    verified_facts: facts,
    missing_facts: missing,
    customer_questions: questions,
    entity_context: entity,
    content_recommendations: recs,
    removed_count: removed,
  };
}

/** Parser lenient untuk data tersimpan: baris lama (tanpa kunci ini) → null. */
export function parseStoredAiSearchReadiness(json: unknown): StoredAiSearchReadiness | null {
  if (!json || typeof json !== "object") return null;
  const raw = (json as Record<string, unknown>).ai_search_readiness;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<StoredAiSearchReadiness>;
  if (r.version !== 1 || !Array.isArray(r.customer_questions)) return null;
  return {
    version: 1,
    generated_at: typeof r.generated_at === "string" ? r.generated_at : "",
    verified_facts: Array.isArray(r.verified_facts) ? r.verified_facts : [],
    missing_facts: Array.isArray(r.missing_facts) ? r.missing_facts : [],
    customer_questions: r.customer_questions,
    entity_context: typeof r.entity_context === "string" ? r.entity_context : null,
    content_recommendations: Array.isArray(r.content_recommendations) ? r.content_recommendations : [],
    removed_count: typeof r.removed_count === "number" ? r.removed_count : 0,
  };
}
