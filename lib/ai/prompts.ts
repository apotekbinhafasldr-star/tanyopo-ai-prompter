import type { Database, Locale } from "@/types/database";

type BrandProfile = Database["public"]["Tables"]["prompter_brand_profiles"]["Row"] | null;
type Product = Database["public"]["Tables"]["prompter_products"]["Row"];

/**
 * Product spec §9's explicit AI-localization guardrails, added to every
 * generation alongside the pre-existing claims/testimonial/policy rules.
 * "Localized" means natural language and cultural adaptation for the
 * target market — never an excuse to target by protected characteristics,
 * assert legal compliance, invent local statistics, or promise an outcome.
 */
const GUARDRAILS_ID = `Aturan wajib:
- Jangan membuat klaim yang menyesatkan, klaim medis tanpa dasar, atau janji hasil finansial.
- Jangan membuat testimoni palsu atau kesan urgensi/scarcity yang tidak benar.
- Jangan mempromosikan produk ilegal atau melanggar kebijakan iklan platform umum (Meta, TikTok, X).
- Jika target pasar campaign berbeda dari pasar asal bisnis, sesuaikan bahasa dan konteks budaya secara natural — bukan sekadar terjemahan literal.
- Jangan pernah menargetkan audiens berdasarkan ras, agama, etnis, orientasi seksual, disabilitas, atau karakteristik dilindungi lainnya.
- Jangan pernah mengklaim kepatuhan hukum/regulasi suatu negara secara otomatis — itu keputusan manusia, bukan AI.
- Jangan pernah mengarang statistik atau data pasar lokal yang tidak diberikan sebagai konteks.
- Jangan pernah menjanjikan hasil, ranking, atau angka performa tertentu.
- Jika ada risiko klaim yang meragukan, sebutkan di field yang relevan agar pengguna bisa meninjau — jangan menghilangkannya begitu saja.`;

const GUARDRAILS_EN = `Mandatory rules:
- Never make misleading claims, unsubstantiated medical claims, or promise financial results.
- Never fabricate testimonials or a false sense of urgency/scarcity.
- Never promote an illegal product or violate a major platform's ad policy (Meta, TikTok, X).
- If the campaign's target market differs from the business's home market, adapt language and cultural context naturally — never a literal word-for-word translation.
- Never target an audience by race, religion, ethnicity, sexual orientation, disability, or other protected characteristics.
- Never automatically claim legal/regulatory compliance for any country — that is a human decision, not the AI's to make.
- Never fabricate local market statistics or data that wasn't given as context.
- Never promise a specific result, ranking, or performance number.
- If a claim carries real risk, surface it in the relevant field so the user can review it — never silently drop it.`;

/**
 * Shared system-prompt preamble for every AI generation call — brand
 * context plus the guardrails from docs/AI_SYSTEM.md. Every feature-level
 * prompt builder below composes on top of this. Writes in the tenant's
 * own language (prompter_brand_profiles.default_language) — a genuine
 * language switch, not a translation instruction bolted onto an
 * Indonesian-only prompt, so output is naturally localized rather than
 * literally translated (product spec §9).
 */
export function buildSystemPreamble(brandProfile: BrandProfile): string {
  const locale: Locale = brandProfile?.default_language ?? "id";
  const isEn = locale === "en";

  const lines = isEn
    ? [
        "You are a marketing strategy assistant for Tanyopo AI Promoter, an AI marketing platform for small businesses globally.",
        "Write in natural English unless asked otherwise.",
      ]
    : [
        "Anda adalah asisten strategi marketing untuk Tanyopo AI Promoter, platform AI marketing untuk UMKM dan bisnis di Indonesia.",
        "Tulis dalam Bahasa Indonesia yang natural kecuali diminta lain.",
      ];

  if (brandProfile?.brand_name) {
    lines.push(isEn ? `Brand name: ${brandProfile.brand_name}.` : `Nama brand: ${brandProfile.brand_name}.`);
  }
  if (brandProfile?.business_description) {
    lines.push(
      isEn
        ? `Business description: ${brandProfile.business_description}`
        : `Deskripsi bisnis: ${brandProfile.business_description}`,
    );
  }
  if (brandProfile?.tone_of_voice) {
    lines.push(
      isEn
        ? `Desired tone of voice: ${brandProfile.tone_of_voice}.`
        : `Tone of voice yang diinginkan: ${brandProfile.tone_of_voice}.`,
    );
  }
  if (brandProfile?.country_code) {
    lines.push(
      isEn
        ? `Business home market (country): ${brandProfile.country_code}.`
        : `Pasar asal bisnis (negara): ${brandProfile.country_code}.`,
    );
  }
  if (brandProfile?.target_market) {
    lines.push(isEn ? `Target market: ${brandProfile.target_market}.` : `Target pasar: ${brandProfile.target_market}.`);
  }
  if (brandProfile?.prohibited_claims) {
    lines.push(
      isEn
        ? `Claims that MUST be avoided: ${brandProfile.prohibited_claims}`
        : `Klaim yang HARUS dihindari: ${brandProfile.prohibited_claims}`,
    );
  }

  lines.push(isEn ? GUARDRAILS_EN : GUARDRAILS_ID);
  return lines.join("\n");
}

function describeProduct(product: Product): string {
  const parts = [
    `Nama produk: ${product.name}`,
    `Jenis: ${product.product_type}`,
    product.category ? `Kategori: ${product.category}` : null,
    product.description ? `Deskripsi: ${product.description}` : null,
    product.price ? `Harga: ${product.price} ${product.currency}` : null,
    Array.isArray(product.target_countries) && product.target_countries.length > 0
      ? `Target negara produk: ${product.target_countries.join(", ")}`
      : null,
  ];
  return parts.filter(Boolean).join("\n");
}

export function buildMarketingBlueprintPrompt(product: Product, homeMarket: string | null): string {
  const targetCountries = Array.isArray(product.target_countries) ? product.target_countries : [];
  const hasDistinctTargetMarket =
    targetCountries.length > 0 && !(targetCountries.length === 1 && targetCountries[0] === homeMarket);

  return [
    "Buat Marketing Blueprint terstruktur untuk produk berikut.",
    describeProduct(product),
    homeMarket ? `Pasar asal bisnis: ${homeMarket}.` : null,
    hasDistinctTargetMarket
      ? "Target pasar produk berbeda dari (atau lebih luas dari) pasar asal bisnis — isi localization_strategy dengan bagaimana positioning/konten harus disesuaikan untuk target pasar tersebut (bahasa, konteks budaya, mata uang), bukan sekadar terjemahan literal. Jangan mengklaim kepatuhan hukum negara manapun dan jangan mengarang statistik pasar lokal."
      : "Target pasar produk sama dengan pasar asal bisnis — localization_strategy boleh berupa string kosong.",
    "Hasilkan summary, USP, benefits, pain points yang diselesaikan, target persona (1-4), positioning, marketing angles, recommended channels, ide konten, risiko, disclaimer bila perlu, dan localization_strategy.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export interface ChannelPerformanceInput {
  channel: string;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
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
  /** Batch B2 — tenant's own historical channel performance, when any exists. Omitted/empty means no history yet. */
  channelPerformanceHistory?: ChannelPerformanceInput[];
}

export function buildCampaignProposalPrompt(
  product: Product,
  inputs: CampaignProposalInputs,
): string {
  return [
    "Buat proposal campaign untuk produk berikut, dengan penalaran marketing yang terstruktur — bukan hanya mengisi kolom generik.",
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
    inputs.channelPerformanceHistory && inputs.channelPerformanceHistory.length > 0
      ? [
          "Data historis performa channel tenant ini (dari campaign-campaign sebelumnya — boleh dipakai sebagai sinyal TAMBAHAN, bukan satu-satunya faktor, dan jangan mengarang angka di luar yang tercantum ini):",
          inputs.channelPerformanceHistory
            .map((c) => `- ${c.channel}: spend ${c.spend}, impressions ${c.impressions}, klik ${c.clicks}, reach ${c.reach}`)
            .join("\n"),
        ].join("\n")
      : "Belum ada data historis performa channel untuk tenant ini — dasarkan rekomendasi channel HANYA pada reasoning produk/tujuan/audiens/pasar/budget di bawah, jangan mengarang data performa yang tidak ada.",
    [
      "Langkah penalaran (isi field yang sesuai — jangan tampilkan proses berpikir mentah, hanya hasilnya):",
      "1. customer_pain — masalah/frustrasi nyata calon pelanggan, digali dari jenis produk/kategori/deskripsi di atas. Jangan generik.",
      "2. desired_outcome — hasil yang diinginkan pelanggan, sebagai lawan dari pain tersebut.",
      "3. value_proposition — kenapa produk ini relevan menjawabnya, HANYA berdasarkan atribut produk yang benar-benar diberikan di atas. Jangan mengarang fitur/kapabilitas yang tidak disebutkan.",
      "4. marketing_angle — sudut pandang terkuat untuk tujuan campaign ini dibanding alternatif lain yang mungkin.",
      "5. candidates — hasilkan TEPAT 3 kandidat {hook, headline, cta, primary_text, rationale} yang berbeda ANGLE satu sama lain (bukan variasi kata dari angle yang sama) — misalnya satu angle bisa fokus ke efisiensi waktu, angle lain ke akurasi/kontrol, angle lain ke kemudahan pemakaian, sesuai apa yang paling relevan untuk produk ini. Setiap kandidat wajib punya primary_text SENDIRI yang konsisten dengan hook/headline kandidat itu — jangan menulis satu body copy generik lalu dipakai ulang untuk ketiganya.",
      "6. Urutkan candidates dari yang TERKUAT ke yang terlemah, dinilai dari: relevansi terhadap customer_pain, kejelasan, kespesifikan, kekuatan benefit yang ditawarkan, kecocokan dengan objective dan jenis produk, kecocokan dengan tahap funnel, kealamian bahasa, seberapa actionable CTA-nya, dan kejujuran klaim. JANGAN memilih pemenang hanya karena bahasanya terdengar lebih agresif/menjual — persuasif harus tetap jujur dan jelas, bukan sekadar lebih 'berani'.",
      "7. Tiap kandidat butuh rationale singkat (maksimal 1 kalimat, bahasa sederhana, tanpa istilah teknis) yang menjelaskan KENAPA kandidat itu mendapat peringkat tersebut berdasarkan kriteria di atas.",
      "8. hook, headline, cta, dan primary_text di level atas WAJIB sama persis dengan candidates[0].",
    ].join("\n"),
    [
      "Kualitas hook wajib:",
      "- Spesifik terhadap customer_pain/desired_outcome yang sudah diidentifikasi, bukan template generik seperti 'Solusi terbaik untuk bisnis Anda', 'Produk berkualitas untuk Anda', atau 'Tingkatkan bisnis sekarang' kecuali benar-benar berdasar dari konteks produk.",
      "- Sesuai platform dan bahasa target — natural, bukan terjemahan kaku.",
      "- Arahnya boleh berupa pertanyaan yang menyentuh pain nyata calon pelanggan, tapi buat versi sendiri sesuai produk ini — jangan menyalin contoh generik apa pun secara literal.",
    ].join("\n"),
    [
      "Kualitas CTA wajib:",
      "- Sesuai objective, tahap funnel, dan JENIS produk — misalnya ajakan mencoba/membeli untuk tujuan penjualan, ajakan konsultasi/kontak untuk leads, ajakan mengenal lebih jauh untuk awareness. Untuk produk aplikasi/software, pilih ajakan yang paling sesuai dengan tahap funnel campaign ini (bisa berupa ajakan mencoba, ajakan melihat cara kerja produk, atau ajakan lain yang relevan) — JANGAN selalu jatuh ke satu CTA default yang sama untuk semua produk/tujuan.",
      "- JANGAN gunakan CTA yang mengklaim atau menyiratkan adanya kapabilitas/penawaran yang TIDAK disebutkan sebagai fakta di deskripsi produk di atas — misalnya CTA yang menyiratkan ada demo, uji coba gratis, atau diskon padahal itu tidak disebutkan sebagai fakta yang tersedia.",
      "- Jangan pernah membuat urgency/scarcity palsu (contoh yang DILARANG: 'stok tinggal 2', 'promo berakhir hari ini', 'ribuan orang sudah membeli') kecuali benar-benar didukung data yang diberikan sebagai konteks di atas — di sini tidak ada data seperti itu, jadi jangan gunakan.",
      "- Jangan pernah mengarang jumlah pelanggan, testimoni, penghargaan, sertifikasi, hasil yang dijamin, atau kapabilitas produk yang tidak disebutkan di atas.",
    ].join("\n"),
    [
      "Rekomendasi channel & alokasi budget (budget_allocation, excluded_channels) — WAJIB bernalar per channel, JANGAN membagi rata ke semua channel yang tersedia:",
      "1. Untuk SETIAP channel di 'Channel yang dipilih' di atas, pertimbangkan: kesesuaian dengan jenis/kategori produk (fisik/digital/jasa/aplikasi), kecocokan dengan tujuan campaign, kecocokan dengan audiens (dari customer_pain/desired_outcome yang sudah diidentifikasi), kecocokan dengan target negara/pasar, kecocokan dengan marketing_angle yang dipilih, karakter konten channel tsb (visual/video pendek/teks/pencarian) dibanding produk ini, dan data historis performa channel di atas jika tersedia.",
      "2. JANGAN memaksakan semua channel yang tersedia untuk mendapat alokasi budget. Channel yang relevansinya rendah untuk campaign spesifik ini masuk ke excluded_channels (dengan alasan singkat spesifik, bukan generik) — JANGAN dimasukkan ke budget_allocation dengan persentase kecil hanya supaya semua channel kebagian.",
      "3. Jika budget (harian/total) yang diberikan kecil, JANGAN membaginya tipis ke banyak channel — fokuskan ke 2-3 channel yang paling kuat justifikasinya untuk campaign ini, bukan seluruh channel yang tersedia.",
      "4. budget_allocation HANYA berisi channel yang benar-benar direkomendasikan (persentase > 0), masing-masing dengan reason singkat (maksimal 1 kalimat, bahasa sederhana, tanpa jargon) yang spesifik untuk campaign ini — bukan alasan generik yang bisa dipakai untuk produk apa saja. Total persentase budget_allocation harus tepat 100.",
      "5. recommended_channels harus sama persis dengan daftar channel di budget_allocation.",
      "6. Jangan pernah mengklaim atau menyiratkan bahwa channel yang direkomendasikan sudah terhubung/siap publikasi — ini murni rekomendasi strategi; status koneksi teknis ditangani terpisah oleh sistem dan ditampilkan apa adanya ke pengguna.",
    ].join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export interface SeoRecommendationsInputs {
  websiteUrl: string;
  targetKeywords: string[];
  /** Target market for this SEO project — never assumed to be Indonesia (product spec §18). */
  countryCode?: string | null;
  language?: string | null;
}

export function buildSeoRecommendationsPrompt(inputs: SeoRecommendationsInputs): string {
  return [
    `Buat rekomendasi SEO untuk website berikut: ${inputs.websiteUrl}`,
    inputs.countryCode
      ? `Target pasar geografis untuk SEO ini: ${inputs.countryCode}${inputs.language ? ` (bahasa: ${inputs.language})` : ""}. Sesuaikan rekomendasi kata kunci dan konten dengan mesin pencari, bahasa, dan kebiasaan pencarian pasar ini — jangan berasumsi pasar Indonesia kecuali memang target pasarnya Indonesia.`
      : "Target pasar geografis belum ditentukan — jangan berasumsi pasar Indonesia; dasarkan rekomendasi pada konteks yang tersedia saja.",
    inputs.targetKeywords.length > 0
      ? `Kata kunci target yang sudah dipilih pengguna: ${inputs.targetKeywords.join(", ")}`
      : "Pengguna belum menentukan kata kunci target — usulkan kata kunci yang relevan berdasarkan URL dan konteks bisnis.",
    "Anda tidak memiliki akses untuk benar-benar mengunjungi atau meng-crawl website ini — dasarkan rekomendasi pada URL, nama domain, dan konteks bisnis yang diberikan, bukan seolah-olah Anda sudah memeriksa isi halaman sebenarnya.",
    "Hasilkan ringkasan peluang SEO, daftar kata kunci target (dengan intent dan alasan), rekomendasi on-page (isu, rekomendasi, prioritas HIGH/MEDIUM/LOW), dan content plan (judul artikel, kata kunci target, jenis konten, angle singkat).",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Batch B5 — SEO & Discovery, NO_WEBSITE mode. For a tenant with no
 * website (Instagram/Facebook/TikTok/WhatsApp/marketplace only), reasoned
 * from business/product context rather than a URL. Context Inheritance:
 * every field here is optional because whichever of product/campaign/
 * brand-profile context the caller already has is passed straight
 * through — nothing is asked twice.
 */
export interface DiscoveryRecommendationsInputs {
  businessName?: string | null;
  productName?: string | null;
  productDescription?: string | null;
  productCategory?: string | null;
  targetCountries?: string[];
  language?: string | null;
  audienceNotes?: string | null;
  campaignObjective?: string | null;
  /** Channels a campaign (Batch B2) already recommended/selected, if opened from one — reused as a hint, never re-asked. */
  existingChannels?: string[];
  whatsappNumber?: string | null;
}

export function buildDiscoveryRecommendationsPrompt(inputs: DiscoveryRecommendationsInputs): string {
  return [
    "Bisnis ini TIDAK memiliki website — jangan menyarankan atau berasumsi ada website. Fokus membantu bisnis ini lebih mudah ditemukan lewat profil media sosial dan/atau marketplace.",
    inputs.businessName ? `Nama bisnis: ${inputs.businessName}` : null,
    inputs.productName
      ? `Produk/layanan yang dipromosikan: ${inputs.productName}${inputs.productDescription ? ` — ${inputs.productDescription}` : ""}`
      : null,
    inputs.productCategory ? `Kategori: ${inputs.productCategory}` : null,
    inputs.targetCountries && inputs.targetCountries.length > 0
      ? `Target pasar geografis: ${inputs.targetCountries.join(", ")}${inputs.language ? ` (bahasa: ${inputs.language})` : ""}. Jangan berasumsi pasar Indonesia kecuali memang termasuk di sini.`
      : "Target pasar geografis belum ditentukan — jangan berasumsi pasar Indonesia; dasarkan pada konteks yang tersedia saja.",
    inputs.audienceNotes ? `Catatan target audiens: ${inputs.audienceNotes}` : null,
    inputs.campaignObjective ? `Tujuan campaign terkait: ${inputs.campaignObjective}` : null,
    inputs.existingChannels && inputs.existingChannels.length > 0
      ? `Channel yang sudah dipilih/direkomendasikan untuk campaign ini sebelumnya: ${inputs.existingChannels.join(", ")} — boleh jadi pertimbangan, tapi tetap evaluasi ulang channel discovery yang paling relevan untuk bisnis ini.`
      : null,
    inputs.whatsappNumber
      ? `Kontak WhatsApp bisnis tersedia (${inputs.whatsappNumber}) — gunakan sebagai tujuan CTA, bukan sebagai target SEO/website.`
      : "Belum ada kontak WhatsApp yang diketahui — buat CTA generik ke \"kontak/pesan langsung\" tanpa mengarang nomor.",
    "Hasilkan: kata kunci utama, kata kunci pendukung, saran optimasi nama/username profil, saran bio/deskripsi singkat, ide konten/caption (dengan alasan singkat kenapa relevan dicari target pelanggan), hashtag relevan bila sesuai (array kosong jika memang tidak relevan — jangan dilewatkan), CTA menuju WhatsApp/kontak/link produk (bukan janji hasil), dan rekomendasi platform discovery (Instagram/Facebook/TikTok/marketplace — jangan sertakan WhatsApp di sini, WhatsApp adalah tujuan CTA bukan platform untuk ditemukan) beserta alasan sederhana berdasarkan jenis bisnis dan target audiens.",
    "PENTING — jangan pernah menjanjikan ranking pencarian tertentu, jumlah follower tertentu, jumlah views tertentu, atau penjualan tertentu. Gunakan bahasa sederhana yang mudah dipahami pemilik UMKM, hindari istilah teknis SEO berlebihan.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export interface AnalyticsInsightInputs {
  channelMetrics: { channel: string; spend: number; impressions: number; clicks: number; reach: number }[];
  conversions: { eventType: string; currency: string; value: number; count: number }[];
  /** Per currency — never a single blind sum across currencies (product spec §13). */
  totalConversionValueByCurrency: { currency: string; total: number }[];
}

export function buildAnalyticsInsightPrompt(inputs: AnalyticsInsightInputs): string {
  const metricsLines = inputs.channelMetrics.map(
    (m) =>
      `- ${m.channel}: spend ${m.spend}, impressions ${m.impressions}, clicks ${m.clicks}, reach ${m.reach}`,
  );
  const conversionLines = inputs.conversions.map(
    (c) => `- ${c.eventType} (${c.currency}): ${c.count} kejadian, total nilai ${c.value} ${c.currency}`,
  );
  const totalLines = inputs.totalConversionValueByCurrency.map((t) => `- ${t.total} ${t.currency}`);

  return [
    "Analisis data marketing tenant ini dan buat ringkasan performa.",
    "Data spend/impressions/clicks/reach per channel (hanya channel yang tercantum di sini yang punya data — jangan menyebut channel lain):",
    metricsLines.length > 0 ? metricsLines.join("\n") : "(tidak ada data spend/impressions untuk channel manapun)",
    "Data konversi (per mata uang asli — jangan pernah menjumlahkan nilai lintas mata uang berbeda):",
    conversionLines.length > 0 ? conversionLines.join("\n") : "(tidak ada data konversi)",
    "Total nilai konversi tercatat, per mata uang:",
    totalLines.length > 0 ? totalLines.join("\n") : "(tidak ada)",
    "PENTING: Hanya gunakan angka dan channel yang benar-benar ada di data di atas. Jangan mengarang angka, channel, atau tren yang tidak didukung data ini. Jangan pernah menjumlahkan nilai dari mata uang yang berbeda menjadi satu angka. Jika data terlalu sedikit untuk menyimpulkan sesuatu, katakan itu di summary atau risks, jangan dipaksakan.",
    "Hasilkan summary, daftar tren (metric, observasi, arah UP/DOWN/FLAT), channel terbaik (atau null jika tidak bisa ditentukan), channel yang kurang optimal, dan risiko/catatan kualitas data.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export interface OptimizationChannelPerformance {
  channel: string;
  status: string;
  dailyBudget: number | null;
  spend: number;
  conversionCount: number;
  conversionValue: number;
  estimatedContribution: number | null;
}

export interface OptimizationRecommendationInputs {
  campaignName: string;
  channels: OptimizationChannelPerformance[];
}

export function buildOptimizationRecommendationPrompt(inputs: OptimizationRecommendationInputs): string {
  const lines = inputs.channels.map((c) => {
    const roas = c.spend > 0 ? (c.conversionValue / c.spend).toFixed(2) : "tidak ada spend";
    const contribution =
      c.estimatedContribution !== null
        ? `estimasi kontribusi marketing ${c.estimatedContribution}`
        : "estimasi kontribusi marketing tidak dapat dihitung (HPP produk belum diisi)";
    return `- ${c.channel} (status ${c.status}): budget harian ${c.dailyBudget ?? "belum diatur"}, spend tercatat ${c.spend}, ${c.conversionCount} konversi senilai ${c.conversionValue} (ROAS ~${roas}), ${contribution}`;
  });

  return [
    `Bandingkan performa channel pada campaign "${inputs.campaignName}" berikut, dan berikan rekomendasi optimasi per channel.`,
    lines.join("\n"),
    "PENTING — pertimbangkan profitabilitas (estimasi kontribusi marketing = pendapatan − HPP − biaya iklan), bukan hanya ROAS. Sebuah channel dengan ROAS tinggi tapi estimasi kontribusi marketing rendah/negatif TIDAK boleh otomatis direkomendasikan untuk dinaikkan budgetnya — jelaskan alasan ini di rationale jika relevan. 'Estimasi kontribusi marketing' bukan laba bersih (belum termasuk biaya operasional lain) — jangan menyebutnya laba bersih.",
    "Hanya gunakan channel dan angka yang benar-benar tercantum di atas — jangan mengarang channel lain atau data yang tidak ada.",
    "Untuk setiap channel yang tercantum, hasilkan satu rekomendasi: action_type (INCREASE_BUDGET/DECREASE_BUDGET/PAUSE_CHANNEL/NO_ACTION), rationale, suggested_daily_budget (hanya untuk INCREASE_BUDGET/DECREASE_BUDGET, selain itu null), dan risk_level (LOW/MEDIUM/HIGH — seberapa besar risiko jika rekomendasi ini salah/perlu ditinjau lebih hati-hati).",
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
