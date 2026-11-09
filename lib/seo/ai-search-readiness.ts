import { buildLinoePublicFacts, isLinoeSelfEntity } from "@/lib/linoe/public-facts";
import { MAX_AEO_QUESTIONS, MAX_CONTENT_RECOMMENDATIONS, MAX_MISSING_FACTS, type AiSearchReadinessAi } from "@/schemas/ai/ai-search-readiness";

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
  /** Hanya untuk fakta publik LINOE (bisnis ini = LINOE): TERSEDIA | SEGERA | TARGET. */
  status?: "TERSEDIA" | "SEGERA" | "TARGET";
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
  // Fakta publik LINOE hanya bila IDENTITAS BRAND tenant = LINOE (nama + website brand resmi).
  // URL produk/project hanyalah referensi dan tidak pernah memicu ini.
  if (isLinoeSelfEntity(b)) {
    for (const f of buildLinoePublicFacts()) facts.push(f);
  }
  return facts;
}

/** `anyOf`: fakta apa pun dari daftar ini sudah memenuhi kebutuhan (mis. kontak resmi LINOE = email, bukan WhatsApp). */
const RECOMMENDED: { label: string; anyOf: string[]; needsProduct?: boolean }[] = [
  { label: "Deskripsi produk", anyOf: ["product_description", "linoe_what"], needsProduct: true },
  { label: "Kategori produk", anyOf: ["product_category", "linoe_what"], needsProduct: true },
  { label: "Harga produk", anyOf: ["product_price", "linoe_plan_free"], needsProduct: true },
  { label: "Lokasi bisnis", anyOf: ["location", "linoe_operator"] },
  { label: "Kontak WhatsApp/pemesanan", anyOf: ["whatsapp", "linoe_contact"] },
];

/**
 * Fakta penting yang belum ada — dihitung server, bukan ditebak AI. Tidak menyesatkan:
 *  - butir yang sudah dicakup fakta resmi LINOE (lokasi/kontak/harga paket) tidak dilaporkan kurang;
 *  - bila produk memang belum dipilih, butir per-produk tidak didaftar satu-satu (cukup catatan "Pilih produk").
 */
export function findMissingFacts(facts: VerifiedFact[]): string[] {
  const have = new Set(facts.map((f) => f.key));
  const hasProduct = have.has("product_name") || [...have].some((k) => k.startsWith("linoe_"));
  return RECOMMENDED.filter((r) => (r.needsProduct ? hasProduct : true) && !r.anyOf.some((k) => have.has(k))).map((r) => r.label);
}

/**
 * Tidak ada produk fallback otomatis (risiko salah konteks): bila project tidak punya produk, minta pemilik memilih
 * sendiri. Bisnis LINOE sendiri sudah dicakup fakta publik resmi, jadi catatan ini akan menyesatkan dan dilewati.
 */
export function productSelectionNote(product: unknown, facts: { key: string }[]): string[] {
  if (product || facts.some((f) => f.key.startsWith("linoe_"))) return [];
  return ["Pilih produk pada project SEO ini agar jawaban akurat"];
}

export function formatFactsForPrompt(facts: VerifiedFact[]): string {
  return facts.length
    ? facts.map((f) => `- ${f.status ? `[${f.status}] ` : ""}${f.label}: ${f.value}`).join("\n")
    : "(belum ada fakta terverifikasi)";
}

// Klaim yang tidak boleh muncul di jawaban/konteks: jaminan, ranking/visibilitas AI,
// testimoni/rating, superlatif tak terbukti.
const FORBIDDEN_CLAIMS =
  /(?:100\s*%|\b(garansi|dijamin|menjamin|pasti laku|terlaris|nomor\s*1|no\.?\s*1|terbaik|ranking|peringkat|muncul di (chatgpt|gemini|perplexity|google)|chatgpt|gemini|perplexity|ai overview|testimoni|ulasan pelanggan|rating|bintang\s*\d|review pelanggan|terbukti|bersertifikat|bpom|halal|publoe|mitapeng|umkmpro|linoe|tanyopo)\b)/i;

/** Batasi ke 2 kalimat pendek (potongan dari jawaban berdasar fakta tetap berdasar fakta). */
export function limitToTwoSentences(text: string, maxChars = 300): string {
  // Pisah hanya di tanda akhir kalimat + spasi, sehingga "Rp99.000" tidak terpotong.
  const sentences = text.trim().split(/(?<=[.!?])\s+/);
  const two = sentences.slice(0, 2).join(" ").trim();
  return two.length > maxChars ? two.slice(0, maxChars).trimEnd() : two;
}

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

/**
 * Fakta berstatus SEGERA/TARGET (belum aktif): klaim "tersedia/aktif/bisa dibeli/bisa dicoba/launching"
 * tidak boleh muncul untuk subjek yang belum aktif. Pemeriksaan dilakukan PER KLAUSA (bukan kualifikator
 * global), sehingga kata "belum"/"rencana" di klausa lain tidak menutupi klaim yang berlebihan, dan klaim
 * benar tentang hal yang memang TERSEDIA (mis. trial gratis 14 hari) tidak ikut ditolak.
 */
const PURCHASE_CLAIM = /(siap dibeli|beli sekarang|bayar sekarang|langganan sekarang|checkout)/i;
const QUALIFIER = /(belum|tidak|bukan|segera|rencana|direncanakan|target|akan|pengembangan|dikembangkan|coming soon|not yet|soon)/i;
const AVAILABLE_CLAIM =
  /\b(tersedia|available|aktif|active|sudah|bisa|dapat|siap|ready|live|launch(?:ing|ed)?|diluncurkan|dirilis|rilis|released?|dibuka|beroperasi|hadir|resmi|go[- ]live|(?:di)?(?:akses|coba|pakai|gunakan|beli|bayar|order|pesan|daftar))\b/i;
/** "sudah dalam pengembangan" adalah pernyataan status yang benar, bukan klaim tersedia. */
const BENIGN_DEV_PHRASE = /sudah\s+(?:dalam|masuk|di)\s+(?:tahap\s+|proses\s+)?pengembangan/gi;

/** Produk yang masih dalam pengembangan (PUBLOE, MITAPENG, "produk Tanyopo lain"). */
const DEV_SUBJECT = /(publoe|mitapeng|ekosistem|produk\s+(?:tanyopo\s+)?lain(?:nya)?)/i;
const PAYMENT_SUBJECT = /\b(pembayaran|membayar|bayar|checkout|(?:mem|di)?beli|(?:ber)?langganan|penagihan|upgrade)\b/i;
const OTHER_ENTITY = /\b(linoe|trial|gratis)\b/i;
const CROSS_SENTENCE_PRONOUN = /^\s*(keduanya|ketiganya|mereka|produk\s+(?:tersebut|lainnya))/i;
const CONTRAST_OR_BOUNDARY = /\s*[;:()—–]\s*|\s+(?:tetapi|tapi|namun|sedangkan|sementara|padahal|meskipun|meski|walaupun|but|while|however)\s+/i;
const CLAUSE_SPLIT = /(\s*,\s*|\s+(?:dan|serta|lalu|kemudian|juga|and)\s+)/i;
const COORDINATING = /^\s+(?:dan|serta|lalu|kemudian|juga|and)\s+$/i;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Subjek yang BELUM aktif, diturunkan dari fakta SEGERA/TARGET milik tenant ini saja. */
function unavailableSubject(facts: VerifiedFact[]): RegExp | null {
  const parts: string[] = [];
  for (const f of facts) {
    if (f.status !== "SEGERA" && f.status !== "TARGET") continue;
    if (f.key.startsWith("linoe_plan_")) {
      const name = f.label.replace(/^Paket\s+/i, "").trim();
      if (name) parts.push(`(?:paket\\s+)?${escapeRe(name)}`);
    } else if (f.key === "linoe_platform_status") parts.push("platform\\s+iklan");
  }
  return parts.length ? new RegExp(`\\b(?:${parts.join("|")})\\b`) : null; // sensitif huruf: "Growth" paket vs "growth" umum
}

function qualifiedBeforeClaim(clause: string): boolean {
  const t = clause.replace(BENIGN_DEV_PHRASE, " ");
  const m = AVAILABLE_CLAIM.exec(t);
  if (!m) return true; // tidak ada klaim ketersediaan
  return QUALIFIER.test(t.slice(0, m.index)) || QUALIFIER.test(m[0]);
}

interface Clause { text: string; coordinated: boolean }

function clausesOf(sentence: string): Clause[] {
  const out: Clause[] = [];
  for (const seg of sentence.split(CONTRAST_OR_BOUNDARY)) {
    if (!seg?.trim()) continue;
    const parts = seg.split(CLAUSE_SPLIT);
    let coordinated = false;
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) { coordinated = COORDINATING.test(parts[i]); continue; }
      if (parts[i].trim()) out.push({ text: parts[i].trim(), coordinated: i > 0 && coordinated });
    }
  }
  return out;
}

function isSubjectOnly(text: string, subj: RegExp[]): boolean {
  let rest = text;
  let hit = false;
  for (const re of subj) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    if (g.test(rest)) { hit = true; rest = rest.replace(g, " "); }
  }
  rest = rest.replace(/\b(dan|serta|atau|and|yang|di|ke|dari|produk|paket|tanyopo)\b/gi, " ");
  return hit && !/[a-z0-9]/i.test(rest);
}

/** Apakah kalimat ini membuat klaim ketersediaan berlebihan untuk subjek yang belum aktif? */
function sentenceOverstates(sentence: string, facts: VerifiedFact[], carryDev: boolean): { flagged: boolean; dev: boolean } {
  const unavail = unavailableSubject(facts);
  const hasPaymentFact = facts.some((f) => f.key === "linoe_payment_status" && f.status === "SEGERA");
  const subj: RegExp[] = [DEV_SUBJECT, ...(unavail ? [unavail] : []), ...(hasPaymentFact ? [PAYMENT_SUBJECT] : [])];
  // Fragmen yang hanya berisi nama ("PUBLOE, MITAPENG ...") digabung ke klausa berikutnya.
  const merged: Clause[] = [];
  let pending = "";
  for (const c of clausesOf(sentence)) {
    if (isSubjectOnly(c.text, subj)) { pending = `${pending} ${c.text}`.trim(); continue; }
    merged.push({ text: `${pending} ${c.text}`.trim(), coordinated: pending ? false : c.coordinated });
    pending = "";
  }
  if (pending) merged.push({ text: pending, coordinated: false });

  let prevDev = carryDev && CROSS_SENTENCE_PRONOUN.test(sentence);
  let prevUnavail = false;
  let flagged = false;
  let lastDev = false;
  merged.forEach((c, i) => {
    const own = DEV_SUBJECT.test(c.text);
    const ownUnavail = (unavail?.test(c.text) ?? false) || (hasPaymentFact && PAYMENT_SUBJECT.test(c.text));
    const inherit = (c.coordinated || (i === 0 && prevDev)) && !own && !ownUnavail && !OTHER_ENTITY.test(c.text);
    const dev = own || (inherit && prevDev);
    const unv = ownUnavail || (inherit && prevUnavail);
    if (dev && AVAILABLE_CLAIM.test(c.text.replace(BENIGN_DEV_PHRASE, " ")) && !qualifiedBeforeClaim(c.text)) flagged = true;
    if (unv && !qualifiedBeforeClaim(c.text)) flagged = true;
    if (PURCHASE_CLAIM.test(c.text) && !qualifiedBeforeClaim(c.text.replace(PURCHASE_CLAIM, "tersedia"))) flagged = true;
    prevDev = dev;
    prevUnavail = unv;
    lastDev = dev;
  });
  return { flagged, dev: lastDev };
}

const hasPlannedFacts = (facts: VerifiedFact[]) => facts.some((f) => f.status === "SEGERA" || f.status === "TARGET");

const splitSentences = (text: string) => text.trim().split(/(?<=[.!?])\s+/).filter(Boolean);

/** Hapus HANYA kalimat yang melebih-lebihkan; kalimat benar tetap dipertahankan. */
export function removeOverstatedSentences(text: string, facts: VerifiedFact[]): { text: string; removed: number } {
  if (!hasPlannedFacts(facts)) return { text, removed: 0 };
  let carry = false;
  const kept: string[] = [];
  let removed = 0;
  for (const s of splitSentences(text)) {
    const r = sentenceOverstates(s, facts, carry);
    carry = r.dev;
    if (r.flagged) removed++;
    else kept.push(s);
  }
  return { text: kept.join(" "), removed };
}

export function overstatesAvailability(text: string, facts: VerifiedFact[]): boolean {
  return removeOverstatedSentences(text, facts).removed > 0;
}

export const STATUS_CLAIM_REMOVED_NOTE = "Teks dihapus karena memuat klaim status produk yang belum terverifikasi.";

/**
 * Field AI lain (mis. keywords, bio, ide konten, CTA, rekomendasi on-page): kalimat yang melebih-lebihkan
 * status produk dibuang. Hanya aktif bila tenant memiliki fakta SEGERA/TARGET (yaitu LINOE sendiri);
 * tenant lain tidak terpengaruh. Elemen larik string yang habis dibuang; field skalar diberi catatan netral.
 */
export function scrubStatusClaims<T>(value: T, facts: VerifiedFact[]): T {
  if (!hasPlannedFacts(facts)) return value;
  const walk = (v: unknown, inArray: boolean): unknown => {
    if (typeof v === "string") {
      if (!v.trim()) return v;
      const r = removeOverstatedSentences(v, facts);
      if (r.removed === 0) return v;
      return r.text || (inArray ? null : STATUS_CLAIM_REMOVED_NOTE);
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, true)).filter((x) => x !== null);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x, false)]));
    }
    return v;
  };
  return walk(value, false) as T;
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
  /** Catatan konteks yang kurang dari server (mis. produk belum dipilih) — ditampilkan lebih dulu. */
  extraMissing: string[] = [],
): StoredAiSearchReadiness {
  const factsText = facts.map((f) => f.value).join(" \n ");
  let removed = 0;
  /** Buang kalimat yang melebih-lebihkan status; sisanya tetap diperiksa terhadap fakta. */
  const guard = (raw: string | null): string | null => {
    if (!raw) return null;
    const r = removeOverstatedSentences(raw, facts);
    if (r.removed > 0) removed++;
    const t = r.text.trim();
    if (!t || facts.length === 0 || !isGroundedText(t, factsText)) {
      if (r.removed === 0) removed++;
      return null;
    }
    return t;
  };
  const questions = ai.customer_questions.slice(0, MAX_AEO_QUESTIONS).map((q) => {
    const answer = guard(clean(q.short_answer, 600));
    const needed = clean(q.owner_input_needed, 300);
    return {
      question: q.question.trim(),
      short_answer: answer ? limitToTwoSentences(answer) : null,
      owner_input_needed: answer
        ? null
        : (needed && !overstatesAvailability(needed, facts) ? needed : null) ??
          "Lengkapi data produk/bisnis agar pertanyaan ini bisa dijawab akurat.",
    };
  });
  const entity = guard(clean(ai.entity_context, 600));
  const recs = ai.content_recommendations.slice(0, MAX_CONTENT_RECOMMENDATIONS).filter((r) => {
    const ok = claimsAllowed(`${r.title} ${r.reason}`, factsText) && !overstatesAvailability(`${r.title}. ${r.reason}`, facts);
    if (!ok) removed++;
    return ok;
  });
  // Maks 3 dari hitungan server agar tersisa ruang untuk fakta spesifik dari AI (total tetap <= MAX_MISSING_FACTS).
  const missing = Array.from(new Set([...extraMissing, ...findMissingFacts(facts).slice(0, 3), ...ai.missing_facts.map((m) => m.trim()).filter((m) => m && !overstatesAvailability(m, facts))])).slice(0, MAX_MISSING_FACTS);
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
