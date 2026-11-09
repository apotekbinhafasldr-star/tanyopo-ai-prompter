import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

let session: { tenantId: string; userId: string; role: string };
vi.mock("@/services/session", () => ({ requireSessionContext: vi.fn(async () => session) }));

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let filtersSeen: { table: string; filters: Record<string, unknown> }[];
let upserts: { table: string; payload: Row }[];

interface Builder {
  select: () => Builder;
  eq: (k: string, v: unknown) => Builder;
  order: () => Builder;
  limit: () => Builder;
  single: () => Promise<{ data: Row | null; error: { message: string } | null }>;
  maybeSingle: () => Promise<{ data: Row | null; error: null }>;
  upsert: (payload: Row) => Promise<{ error: null }>;
}

function builder(table: string): Builder {
  const filters: Record<string, unknown> = {};
  const api: Builder = {
    select: () => api,
    eq: (k: string, v: unknown) => ((filters[k] = v), api),
    order: () => api,
    limit: () => api,
    single: async () => ((filtersSeen.push({ table, filters }), { data: match()[0] ?? null, error: match()[0] ? null : { message: "none" } })),
    maybeSingle: async () => ((filtersSeen.push({ table, filters }), { data: match()[0] ?? null, error: null })),
    upsert: async (payload: Row) => (upserts.push({ table, payload }), { error: null }),
  };
  const match = () => (tables[table] ?? []).filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
  return api;
}
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ from: (t: string) => builder(t) })) }));

let aiCalls: { prompt: string; system: string; tenantId: string }[];
let aiAnswer: (readiness: unknown) => unknown;
vi.mock("@/services/ai-jobs", () => ({
  runAiJob: vi.fn(async (p: { prompt: string; system: string; tenantId: string }) => {
    aiCalls.push({ prompt: p.prompt, system: p.system, tenantId: p.tenantId });
    return { ok: true, jobId: "j1", model: "m", data: aiAnswer(null) };
  }),
}));

import { generateSeoRecommendationsAction } from "@/features/seo/actions";
import { buildLinoePublicFacts, ECOSYSTEM_IN_DEVELOPMENT } from "@/lib/linoe/public-facts";
import { FAQS } from "@/features/marketing/faq-data";
import {
  buildVerifiedFacts,
  findMissingFacts,
  overstatesAvailability,
  productSelectionNote,
  sanitizeAiSearchReadiness,
} from "@/lib/seo/ai-search-readiness";
import type { AiSearchReadinessAi } from "@/schemas/ai/ai-search-readiness";

const LINOE_URL = "https://tanyopo-ai-prompter.netlify.app";
const facts = buildLinoePublicFacts();
const get = (k: string) => facts.find((f) => f.key === k)!;

const readiness = (answer: string | null, entity = "Entitas."): AiSearchReadinessAi => ({
  customer_questions: [
    { question: "Q1?", short_answer: answer, owner_input_needed: null },
    { question: "Q2?", short_answer: null, owner_input_needed: "x" },
    { question: "Q3?", short_answer: null, owner_input_needed: "x" },
  ],
  entity_context: entity,
  content_recommendations: [{ title: "FAQ", format: "FAQ", reason: "r" }],
  missing_facts: [],
});

describe("sumber fakta resmi LINOE", () => {
  it("target pengguna = jawaban FAQ resmi, kata demi kata (tidak dikarang)", () => {
    const faq = FAQS.find((f) => f.q === "Siapa yang cocok menggunakan LINOE?")!;
    expect(get("linoe_target_users").value).toBe(faq.a);
    expect(get("linoe_target_users").status).toBe("TERSEDIA");
    const what = FAQS.find((f) => f.q === "Apa itu LINOE?")!;
    expect(get("linoe_what").value).toBe(what.a);
  });
  it("LINOE mandiri (UMKMpro opsional) tersedia", () => {
    expect(get("linoe_standalone").status).toBe("TERSEDIA");
    expect(get("linoe_standalone").value).toMatch(/opsional/);
  });
});

describe("status produk: LINOE tersedia vs PUBLOE & MITAPENG dalam pengembangan", () => {
  it("PUBLOE & MITAPENG berstatus SEGERA, 'belum tersedia', bukan bagian LINOE; tanpa fitur/harga/tanggal", () => {
    expect([...ECOSYSTEM_IN_DEVELOPMENT]).toEqual(["PUBLOE", "MITAPENG"]);
    const f = get("linoe_ecosystem_status");
    expect(f.status).toBe("SEGERA");
    expect(f.value).toMatch(/PUBLOE dan MITAPENG masih dalam pengembangan dan belum tersedia/);
    expect(f.value).toMatch(/bukan bagian dari LINOE/);
    expect(f.value).not.toMatch(/\d|Rp|fitur/i);
  });
  it("fakta LINOE TERSEDIA tidak menyebut PUBLOE/MITAPENG", () => {
    for (const f of facts.filter((x) => x.key !== "linoe_ecosystem_status")) {
      expect(f.value, f.key).not.toMatch(/PUBLOE|MITAPENG/i);
    }
  });
  it("sanitizer menolak klaim PUBLOE/MITAPENG tersedia; mengizinkan yang berlabel pengembangan", () => {
    const self = buildVerifiedFacts({ brand: { brand_name: "LINOE", website_url: LINOE_URL } });
    for (const bad of ["PUBLOE sudah tersedia untuk umum.", "MITAPENG bisa dipakai sekarang.", "PUBLOE aktif dan siap digunakan."]) {
      expect(overstatesAvailability(bad, self), bad).toBe(true);
      expect(sanitizeAiSearchReadiness(readiness(bad), self).customer_questions[0].short_answer, bad).toBeNull();
    }
    const ok = "PUBLOE dan MITAPENG masih dalam pengembangan dan belum tersedia.";
    expect(overstatesAvailability(ok, self)).toBe(false);
    expect(sanitizeAiSearchReadiness(readiness(ok), self).customer_questions[0].short_answer).toBe(ok);
  });
});

describe("tenant lain tidak terpengaruh (isolasi fakta)", () => {
  const kopi = buildVerifiedFacts({
    brand: { brand_name: "Kopi Nusa", website_url: LINOE_URL },
    product: { name: "Kopi", website_url: LINOE_URL, price: 1000, currency: "IDR" },
    projectWebsiteUrl: LINOE_URL,
  });
  it("tidak ada fakta LINOE/PUBLOE/MITAPENG di konteks Kopi Nusa walau semua URL = LINOE", () => {
    expect(kopi.some((f) => f.key.startsWith("linoe_") || f.status)).toBe(false);
    // URL referensi milik tenant sendiri boleh tampil apa adanya; yang tidak boleh: fakta/nama LINOE di luar itu
    expect(JSON.stringify(kopi).split(LINOE_URL).join("")).not.toMatch(/PUBLOE|MITAPENG|LINOE|Tanyopo/i);
  });
  it("jawaban/konteks AI yang menyebut LINOE/PUBLOE/MITAPENG/UMKMpro di tenant lain dibuang (tidak ada di fakta mereka)", () => {
    for (const leak of ["Didukung oleh LINOE.", "Tersedia juga di PUBLOE.", "Cek MITAPENG.", "Terhubung ke UMKMpro."]) {
      const out = sanitizeAiSearchReadiness(readiness(leak, leak), kopi);
      expect(out.customer_questions[0].short_answer, leak).toBeNull();
      expect(out.entity_context, leak).toBeNull();
    }
  });
  it("bisnis yang memang bernama Linoe di fakta sendiri tetap boleh menyebut namanya", () => {
    const own = buildVerifiedFacts({ brand: { brand_name: "Linoe Kopi" }, product: { name: "Kopi Linoe" } });
    const out = sanitizeAiSearchReadiness(readiness("Kopi Linoe dijual di Linoe Kopi."), own);
    expect(out.customer_questions[0].short_answer).toBeTruthy();
  });
});

describe("pesan kelengkapan tidak menyesatkan", () => {
  it("bisnis LINOE: lokasi, kontak, harga, deskripsi dicakup fakta resmi → tidak dilaporkan kurang", () => {
    const self = buildVerifiedFacts({ brand: { brand_name: "LINOE", website_url: LINOE_URL } });
    expect(findMissingFacts(self)).toEqual([]);
    expect(productSelectionNote(null, self)).toEqual([]);
  });
  it("tenant biasa tanpa produk: tidak mendaftar butir per-produk satu-satu; hanya catatan 'Pilih produk' + lokasi/kontak", () => {
    const f = buildVerifiedFacts({ brand: { brand_name: "Kopi Nusa" } });
    expect(findMissingFacts(f)).toEqual(["Lokasi bisnis", "Kontak WhatsApp/pemesanan"]);
    expect(productSelectionNote(null, f)).toEqual(["Pilih produk pada project SEO ini agar jawaban akurat"]);
    expect(productSelectionNote({ name: "x" }, f)).toEqual([]);
  });
  it("tenant biasa dengan produk tanpa harga tetap diminta melengkapi harga", () => {
    const f = buildVerifiedFacts({ brand: { brand_name: "Kopi Nusa" }, product: { name: "Kopi" } });
    expect(findMissingFacts(f)).toEqual(expect.arrayContaining(["Deskripsi produk", "Harga produk"]));
  });
});

describe("generateSeoRecommendationsAction — isolasi tenant end-to-end", () => {
  beforeEach(() => {
    session = { tenantId: "t-kopi", userId: "u1", role: "owner" };
    filtersSeen = [];
    upserts = [];
    aiCalls = [];
    aiAnswer = () => ({
      primary_keywords: ["kopi"], supporting_keywords: [], profile_name_tip: "x", bio_recommendation: "y",
      content_ideas: [{ title: "a", angle: "b" }], hashtags: [], cta_recommendation: "z",
      recommended_channels: [{ channel: "INSTAGRAM", reason: "r" }],
      ai_search_readiness: readiness("Kopi dijual seharga IDR 1000."),
    });
    tables = {
      prompter_seo_projects: [
        { id: "p-kopi", tenant_id: "t-kopi", discovery_mode: "NO_WEBSITE", product_id: "prod-kopi", website_url: LINOE_URL },
        { id: "p-linoe", tenant_id: "t-linoe", discovery_mode: "NO_WEBSITE", product_id: null, website_url: null },
      ],
      prompter_brand_profiles: [
        { tenant_id: "t-kopi", brand_name: "Kopi Nusa", website_url: LINOE_URL, default_language: "id" },
        { tenant_id: "t-linoe", brand_name: "LINOE by Tanyopo", website_url: LINOE_URL, default_language: "id" },
        { tenant_id: "t-lain", brand_name: "Toko Rahasia", website_url: "https://rahasia.id", default_language: "id" },
      ],
      prompter_products: [
        { id: "prod-kopi", tenant_id: "t-kopi", name: "Kopi", price: 1000, currency: "IDR", website_url: LINOE_URL, description: "Kopi robusta" },
        { id: "prod-lain", tenant_id: "t-lain", name: "Produk Rahasia Tenant Lain", price: 777, currency: "IDR" },
      ],
      prompter_master_campaigns: [],
    };
  });

  it("Kopi Nusa (URL LINOE di mana-mana): prompt AI tanpa fakta LINOE/PUBLOE/MITAPENG, tanpa data tenant lain; semua query bertenant", async () => {
    const r = await generateSeoRecommendationsAction("p-kopi");
    expect(r.error).toBeNull();
    expect(aiCalls).toHaveLength(1);
    const all = (aiCalls[0].prompt + aiCalls[0].system).split(LINOE_URL).join("");
    expect(all).not.toMatch(/PUBLOE|MITAPENG|\[SEGERA\]|\[TARGET\]|tanyopofuturetechnology|Rp99\.000/);
    expect(all).not.toMatch(/Rahasia|rahasia\.id|777/);
    expect(aiCalls[0].tenantId).toBe("t-kopi");
    for (const q of filtersSeen) expect(q.filters.tenant_id, q.table).toBe("t-kopi");
    expect(upserts[0].payload.tenant_id).toBe("t-kopi");
  });

  it("tenant LINOE (brand + website resmi): fakta publik + status masuk prompt; tanpa catatan 'Pilih produk'", async () => {
    session = { tenantId: "t-linoe", userId: "u2", role: "owner" };
    aiAnswer = () => ({
      primary_keywords: ["linoe"], supporting_keywords: [], profile_name_tip: "x", bio_recommendation: "y",
      content_ideas: [{ title: "a", angle: "b" }], hashtags: [], cta_recommendation: "z",
      recommended_channels: [{ channel: "INSTAGRAM", reason: "r" }],
      ai_search_readiness: readiness("PUBLOE dan MITAPENG masih dalam pengembangan dan belum tersedia."),
    });
    const r = await generateSeoRecommendationsAction("p-linoe");
    expect(r.error).toBeNull();
    const p = aiCalls[0].prompt;
    expect(p).toMatch(/\[TERSEDIA\] Target pengguna LINOE/);
    expect(p).toMatch(/\[SEGERA\] Produk Tanyopo lain: PUBLOE dan MITAPENG masih dalam pengembangan/);
    expect(p).not.toMatch(/Toko Rahasia|rahasia\.id|Produk Rahasia/);
    const stored = (upserts[0].payload.discovery_recommendations as { ai_search_readiness: { missing_facts: string[]; customer_questions: { short_answer: string | null }[] } }).ai_search_readiness;
    expect(stored.missing_facts).toEqual([]);
    expect(stored.customer_questions[0].short_answer).toMatch(/masih dalam pengembangan/);
  });

  it("role tanpa izin ditolak sebelum AI/DB", async () => {
    session.role = "kasir";
    const r = await generateSeoRecommendationsAction("p-kopi");
    expect(r.error).toMatch(/Owner\/Marketing/);
    expect(aiCalls).toHaveLength(0);
    expect(upserts).toHaveLength(0);
  });

  it("project milik tenant lain tidak ditemukan (tidak ada panggilan AI)", async () => {
    const r = await generateSeoRecommendationsAction("p-linoe");
    expect(r.error).toMatch(/tidak ditemukan/);
    expect(aiCalls).toHaveLength(0);
  });
});
