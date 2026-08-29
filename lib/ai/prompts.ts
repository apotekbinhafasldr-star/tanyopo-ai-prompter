import type { Database } from "@/types/database";

type BrandProfile = Database["public"]["Tables"]["prompter_brand_profiles"]["Row"] | null;
type Product = Database["public"]["Tables"]["prompter_products"]["Row"];

const GUARDRAILS = `Aturan wajib:
- Jangan membuat klaim yang menyesatkan, klaim medis tanpa dasar, atau janji hasil finansial.
- Jangan membuat testimoni palsu atau kesan urgensi/scarcity yang tidak benar.
- Jangan mempromosikan produk ilegal atau melanggar kebijakan iklan platform umum (Meta, TikTok, X).
- Jika ada risiko klaim yang meragukan, sebutkan di field yang relevan agar pengguna bisa meninjau — jangan menghilangkannya begitu saja.`;

/**
 * Shared system-prompt preamble for every AI generation call — brand
 * context plus the guardrails from docs/AI_SYSTEM.md. Every feature-level
 * prompt builder below composes on top of this.
 */
export function buildSystemPreamble(brandProfile: BrandProfile): string {
  const lines = [
    "Anda adalah asisten strategi marketing untuk Tanyopo AI Promoter, platform AI marketing untuk UMKM dan bisnis di Indonesia.",
    "Tulis dalam Bahasa Indonesia yang natural kecuali diminta lain.",
  ];

  if (brandProfile?.brand_name) {
    lines.push(`Nama brand: ${brandProfile.brand_name}.`);
  }
  if (brandProfile?.business_description) {
    lines.push(`Deskripsi bisnis: ${brandProfile.business_description}`);
  }
  if (brandProfile?.tone_of_voice) {
    lines.push(`Tone of voice yang diinginkan: ${brandProfile.tone_of_voice}.`);
  }
  if (brandProfile?.target_market) {
    lines.push(`Target pasar: ${brandProfile.target_market}.`);
  }
  if (brandProfile?.prohibited_claims) {
    lines.push(`Klaim yang HARUS dihindari: ${brandProfile.prohibited_claims}`);
  }

  lines.push(GUARDRAILS);
  return lines.join("\n");
}

function describeProduct(product: Product): string {
  const parts = [
    `Nama produk: ${product.name}`,
    `Jenis: ${product.product_type}`,
    product.category ? `Kategori: ${product.category}` : null,
    product.description ? `Deskripsi: ${product.description}` : null,
    product.price ? `Harga: ${product.price} ${product.currency}` : null,
  ];
  return parts.filter(Boolean).join("\n");
}

export function buildMarketingBlueprintPrompt(product: Product): string {
  return [
    "Buat Marketing Blueprint terstruktur untuk produk berikut.",
    describeProduct(product),
    "Hasilkan summary, USP, benefits, pain points yang diselesaikan, target persona (1-4), positioning, marketing angles, recommended channels, ide konten, risiko, dan disclaimer bila perlu.",
  ].join("\n\n");
}

export interface CampaignProposalInputs {
  objective: string;
  channels: string[];
  targetCountry: string | null;
  targetRegion: string | null;
  targetCity: string | null;
  audienceNotes: string | null;
  dailyBudget: number | null;
  totalBudget: number | null;
  currency: string;
}

export function buildCampaignProposalPrompt(
  product: Product,
  inputs: CampaignProposalInputs,
): string {
  return [
    "Buat proposal campaign untuk produk berikut.",
    describeProduct(product),
    `Tujuan campaign: ${inputs.objective}`,
    `Channel yang dipilih: ${inputs.channels.join(", ")}`,
    [inputs.targetCity, inputs.targetRegion, inputs.targetCountry].filter(Boolean).length
      ? `Target lokasi: ${[inputs.targetCity, inputs.targetRegion, inputs.targetCountry].filter(Boolean).join(", ")}`
      : null,
    inputs.audienceNotes ? `Catatan audiens dari pengguna: ${inputs.audienceNotes}` : null,
    inputs.dailyBudget || inputs.totalBudget
      ? `Budget: ${inputs.dailyBudget ? `harian ${inputs.dailyBudget} ${inputs.currency}` : ""} ${inputs.totalBudget ? `total ${inputs.totalBudget} ${inputs.currency}` : ""}`.trim()
      : null,
    "Hasilkan positioning, ringkasan audiens, marketing angle, headline, primary text, CTA, konsep kreatif, recommended channels (hanya dari channel yang dipilih), dan alokasi budget per channel (persentase, total 100).",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export interface SeoRecommendationsInputs {
  websiteUrl: string;
  targetKeywords: string[];
}

export function buildSeoRecommendationsPrompt(inputs: SeoRecommendationsInputs): string {
  return [
    `Buat rekomendasi SEO untuk website berikut: ${inputs.websiteUrl}`,
    inputs.targetKeywords.length > 0
      ? `Kata kunci target yang sudah dipilih pengguna: ${inputs.targetKeywords.join(", ")}`
      : "Pengguna belum menentukan kata kunci target — usulkan kata kunci yang relevan berdasarkan URL dan konteks bisnis.",
    "Anda tidak memiliki akses untuk benar-benar mengunjungi atau meng-crawl website ini — dasarkan rekomendasi pada URL, nama domain, dan konteks bisnis yang diberikan, bukan seolah-olah Anda sudah memeriksa isi halaman sebenarnya.",
    "Hasilkan ringkasan peluang SEO, daftar kata kunci target (dengan intent dan alasan), rekomendasi on-page (isu, rekomendasi, prioritas HIGH/MEDIUM/LOW), dan content plan (judul artikel, kata kunci target, jenis konten, angle singkat).",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export interface ContentGenerationInputs {
  platform: string;
  contentType: string;
  goal: string | null;
  tone: string | null;
  language: string;
}

export function buildContentPrompt(product: Product, inputs: ContentGenerationInputs): string {
  return [
    `Buat konten ${inputs.contentType} untuk platform ${inputs.platform}.`,
    describeProduct(product),
    inputs.goal ? `Tujuan: ${inputs.goal}` : null,
    inputs.tone ? `Tone: ${inputs.tone}` : null,
    `Bahasa: ${inputs.language === "en" ? "English" : "Bahasa Indonesia"}`,
    "Hasilkan hook, caption, body, CTA, hashtag (maks 15), creative brief singkat untuk visual pendamping, dan video script bila content type adalah VIDEO_SCRIPT (selain itu isi video_script dengan null).",
  ]
    .filter(Boolean)
    .join("\n\n");
}
