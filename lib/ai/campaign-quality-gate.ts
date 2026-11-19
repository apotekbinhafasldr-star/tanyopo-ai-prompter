import type { CampaignProposal } from "@/schemas/ai/campaign-proposal";

/**
 * Deterministic, rule-based quality gate for an AI campaign proposal.
 *
 * - Pure: no I/O, no model call, so it costs nothing and cannot hang.
 * - Advisory: it never blocks saving or approval by itself. It tells the
 *   reviewer WHAT to look at before publishing. It is not legal/ad-policy
 *   compliance and never claims to be (see GATE_DISCLAIMER).
 * - Honest about its limits: it only knows the rules below. A PASS means
 *   "none of these rules fired", not "this is a good or compliant ad".
 *
 * A proof/claim term is not flagged when the same term appears in
 * `knownFacts` (the product description the user entered), because then it
 * is a stated fact, not something the model made up. The two rules marked
 * `ignoreKnownFacts` (FINANCIAL_CLAIM, SPECIAL_CATEGORY) are the exception:
 * a financial promise or a special ad category is not made acceptable by the
 * user having written it in the product description.
 *
 * "Advisory" is about THIS module: it only reports. Enforcement is a separate
 * decision made by the caller. `submitForApprovalAction` (features/campaigns/
 * actions.ts) refuses to create an approval while `hasBlockingIssue()` is
 * true; the campaign page still just displays the result.
 */

export type QualityDimensionId =
  | "relevance"
  | "differentiation"
  | "benefit_clarity"
  | "hook_strength"
  | "audience_fit"
  | "cta_strength"
  | "ad_policy"
  | "claim_risk";

export type QualityStatus = "PASS" | "REVIEW" | "FAIL";

export interface QualityIssue {
  readonly code: string;
  readonly dimension: QualityDimensionId;
  /** "block" = should not be published as-is; "warn" = reviewer must decide. */
  readonly severity: "block" | "warn";
  readonly message: string;
  /** The exact text fragment that triggered the rule, when there is one. */
  readonly excerpt?: string;
}

export interface QualityDimensionResult {
  readonly id: QualityDimensionId;
  readonly label: string;
  readonly status: QualityStatus;
  /** 0-100. 100 minus a fixed deduction per issue (block 40, warn 15), floored at 0. */
  readonly score: number;
}

export interface QualityGateResult {
  readonly status: QualityStatus;
  /**
   * 0-100 rubric score: mean of the dimension scores, capped at 59 when any
   * issue is a "block" and at 89 when any issue needs review. A rule-based
   * measure for comparing proposals over time (regression), NOT a prediction
   * of sales or ad performance.
   */
  readonly score: number;
  readonly dimensions: readonly QualityDimensionResult[];
  readonly issues: readonly QualityIssue[];
}

export interface QualityGateContext {
  /** Product name, used to check the copy is actually about this product. */
  readonly productName?: string | null;
  /** Free text the user entered about the product. Terms found here are facts. */
  readonly knownFacts?: string | null;
  /**
   * True for a simulated product that must never be offered as real or lead
   * to a transaction (no purchase CTA, no price).
   */
  readonly isSimulation?: boolean;
}

export const GATE_DISCLAIMER =
  "Pemeriksaan otomatis berbasis aturan sederhana. Ini bukan jaminan kepatuhan kebijakan iklan atau hukum; tinjau sendiri sebelum menerbitkan.";

export const DIMENSION_LABELS: Record<QualityDimensionId, string> = {
  relevance: "Relevansi produk",
  differentiation: "Diferensiasi",
  benefit_clarity: "Kejelasan manfaat",
  hook_strength: "Kekuatan hook",
  audience_fit: "Kejelasan audiens",
  cta_strength: "Kekuatan ajakan (CTA)",
  ad_policy: "Kepatuhan format iklan",
  claim_risk: "Risiko klaim",
};

const DIMENSION_ORDER: readonly QualityDimensionId[] = [
  "relevance",
  "differentiation",
  "benefit_clarity",
  "hook_strength",
  "audience_fit",
  "cta_strength",
  "ad_policy",
  "claim_risk",
];

interface TextRule {
  readonly code: string;
  readonly dimension: QualityDimensionId;
  readonly severity: "block" | "warn";
  readonly pattern: RegExp;
  readonly message: string;
  /** True: a match is reported even when the same text is in `knownFacts`. */
  readonly ignoreKnownFacts?: boolean;
}

/** Separator between the words of a phrase: tolerates extra spaces, hyphens, dots, commas, slashes and underscores. */
const SEP = "[\\s\\-_.,/]+";
/** Joins phrase words with SEP so "cepat kaya", "cepat-kaya" and "cepat   kaya" all match. */
const phrase = (...words: string[]): string => words.join(SEP);

const SPECIAL_CATEGORY_MESSAGE =
  "Kategori iklan khusus (special_ad_categories). Meta mewajibkan deklarasi kategori ini dan LINOE belum mendukungnya, sehingga iklan Meta untuk kategori ini diblokir sampai ada dukungan. Ubah copy atau jangan promosikan kategori ini lewat LINOE.";

// Patterns are intentionally narrow: a false alarm only costs the reviewer a
// glance, but a rule that fires on ordinary copy would train people to ignore
// the gate.
const TEXT_RULES: readonly TextRule[] = [
  {
    code: "GUARANTEED_RESULT",
    dimension: "claim_risk",
    severity: "block",
    pattern:
      /\b(?:dijamin|garansi\s+(?:laris|untung|terjual|hasil|sembuh)|pasti\s+(?:laris|untung|terjual|berhasil|sembuh|naik)|100\s*%\s*(?:aman|berhasil|manjur|sembuh|ampuh)|tanpa\s+risiko|guaranteed?|risk[- ]free)\b/i,
    message: "Menjanjikan hasil pasti. Hapus atau ganti dengan manfaat yang bisa dibuktikan.",
  },
  {
    code: "NUMERIC_RESULT_PROMISE",
    dimension: "claim_risk",
    severity: "block",
    pattern: /\b(?:omzet|penjualan|profit|untung|pembeli)\s+(?:naik|meningkat|bertambah)\s+(?:hingga\s+)?\d/i,
    message: "Menjanjikan angka hasil penjualan. Tidak boleh tanpa bukti nyata.",
  },
  {
    code: "MEDICAL_CLAIM",
    dimension: "claim_risk",
    severity: "warn",
    pattern: /\b(?:menyembuhkan|sembuhkan|obat\s+ajaib|mengobati|cures?|treats?\s+(?:disease|cancer|diabetes))\b/i,
    message: "Klaim kesehatan/pengobatan. Wajib punya dasar dan izin sebelum dipakai di iklan.",
  },
  {
    code: "FALSE_URGENCY",
    dimension: "claim_risk",
    severity: "warn",
    pattern:
      /\b(?:hanya\s+hari\s+ini|stok\s+terbatas|(?:tinggal|sisa)\s+\d+|segera\s+habis|promo\s+berakhir|last\s+chance|limited\s+(?:time|stock)|only\s+\d+\s+left)\b/i,
    message: "Kesan urgensi/kelangkaan. Pakai hanya jika memang benar.",
  },
  {
    code: "UNVERIFIED_PROOF",
    dimension: "claim_risk",
    severity: "warn",
    pattern:
      /\b(?:\d[\d.,]*\s*\+?\s*(?:pelanggan|pembeli|customers?|ulasan|reviews?)|ribuan\s+(?:pelanggan|pembeli)|terlaris|best\s*seller|nomor\s*(?:1|satu)|no\.?\s*1|bintang\s*5|rating\s+\d|testimoni|bersertifikat|certified|award|penghargaan)\b/i,
    message: "Bukti sosial/sertifikasi yang tidak ada di deskripsi produk. Pastikan benar atau hapus.",
  },
  {
    code: "URL_IN_COPY",
    dimension: "ad_policy",
    severity: "block",
    pattern: /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|id|co\.id|net|org|shop|store)\b/i,
    message: "Ada tautan/domain di teks iklan. Tautan resmi dipasang sistem saat peluncuran.",
  },
  {
    code: "PHONE_IN_COPY",
    dimension: "ad_policy",
    severity: "block",
    pattern: /(?:\+62|\b0)8\d[\d\s-]{7,}/,
    message: "Ada nomor telepon/WhatsApp di teks iklan. Tidak boleh ditulis di teks.",
  },
  {
    code: "FINANCIAL_CLAIM",
    dimension: "claim_risk",
    severity: "block",
    ignoreKnownFacts: true,
    pattern: new RegExp(
      "\\b(?:" +
        [
          // quick loans / credit
          phrase("pinjaman", "(?:cepat|online|instan|kilat|tanpa\\s+(?:agunan|jaminan|bi\\s+checking))"),
          phrase("kredit", "(?:cepat|instan|kilat|tanpa\\s+(?:agunan|jaminan))"),
          "pinjol",
          phrase("dana", "(?:cair|segar)", "(?:cepat|hari\\s+ini|instan)"),
          phrase("(?:fast|quick|instant|easy|payday|cash)", "loans?"),
          // investment
          "invest(?:asi|asikan|ing|ment|ments|or|ors)?",
          "berinvestasi",
          "saham",
          "reksa\\s*dana",
          "(?:kripto|crypto|bitcoin|forex)",
          phrase("(?:binary|opsi)", "(?:options?|biner)"),
          // get rich / passive income
          phrase("cepat", "kaya"),
          phrase("kaya", "(?:mendadak|raya)"),
          phrase("get", "rich", "(?:quick|fast)"),
          phrase("(?:jadi|menjadi)", "(?:miliarder|milyarder|jutawan|sultan)"),
          phrase("(?:become|be)", "(?:a\\s+)?(?:millionaire|billionaire)"),
          phrase("passive", "income"),
          phrase("(?:penghasilan|pendapatan)", "pasif"),
          phrase("financial", "freedom"),
          phrase("(?:kebebasan|bebas)", "finansial"),
          // no-risk money promises
          phrase("(?:bebas|tanpa)", "riba"),
          phrase("modal", "(?:kecil|minim|receh|sedikit|tipis)", "(?:[^\\s]+\\s+){0,3}?(?:untung|cuan|profit|laba|hasil)", "(?:besar|banyak|berlipat|ganda|maksimal)"),
          phrase("(?:small|low)", "(?:capital|investment)", "(?:[^\\s]+\\s+){0,3}?(?:big|high|huge)", "(?:profits?|returns?|gains?)"),
          phrase("balik", "modal", "(?:cepat|instan|dalam\\s+\\d+)"),
          phrase("pasti", "(?:cuan|profit|kaya)"),
          phrase("(?:cuan|profit|untung|laba|return|imbal\\s+hasil)", "(?:dijamin|pasti|tetap\\s+dijamin)"),
          phrase("cuan", "(?:jutaan|berlipat|harian|tiap\\s+hari|setiap\\s+hari|terus|besar|ratusan)"),
          phrase("(?:guaranteed|sure|assured)", "(?:profits?|returns?|income|gains?|money)"),
        ].join("|") +
        ")\\b",
      "i",
    ),
    message:
      "Janji/penawaran keuangan (pinjaman, investasi, cepat kaya, passive income, atau untung pasti). Iklan seperti ini berisiko ditolak platform dan menyesatkan; hapus atau ganti dengan manfaat produk yang nyata.",
  },
  {
    code: "SPECIAL_CATEGORY",
    dimension: "ad_policy",
    severity: "block",
    ignoreKnownFacts: true,
    // Credit / loans / leasing.
    pattern: new RegExp(
      "\\b(?:" +
        [
          phrase("kartu", "kredit"),
          phrase("kredit", "(?:motor|mobil|rumah|usaha|kendaraan|multiguna|konsumer|konsumen|online|syariah|pemilikan|tanpa\\s+(?:agunan|jaminan))"),
          "pinjaman",
          phrase("pinjam", "uang"),
          "pinjol",
          "leasing",
          "kpr",
          phrase("pembiayaan", "(?:kendaraan|motor|mobil|multiguna|konsumen|konsumer|rumah)"),
          "multi\\s*finance",
          "loans?",
          "mortgages?",
          phrase("credit", "cards?"),
          phrase("(?:auto|car|home|personal|payday|student|business)", "financing"),
        ].join("|") +
        ")\\b",
      "i",
    ),
    message: `Kategori kredit/pinjaman/leasing. ${SPECIAL_CATEGORY_MESSAGE}`,
  },
  {
    code: "SPECIAL_CATEGORY",
    dimension: "ad_policy",
    severity: "block",
    ignoreKnownFacts: true,
    // Employment / recruitment.
    pattern: new RegExp(
      "\\b(?:" +
        [
          phrase("(?:lowongan|loker)", "(?:kerja|pekerjaan|karir|karier|magang)"),
          "rekrutmen",
          "merekrut",
          "(?:open|buka)\\s+recruitment",
          phrase("(?:membuka|dibuka)", "lowongan"),
          phrase("penerimaan", "(?:karyawan|pegawai|staf|staff)"),
          phrase("(?:cari|dicari|dibutuhkan)", "(?:karyawan|pegawai|staf|staff)"),
          phrase("melamar", "(?:kerja|pekerjaan)"),
          phrase("(?:we(?:'re|\\s+are)|now)", "hiring"),
          phrase("job", "(?:openings?|vacanc(?:y|ies)|opportunit(?:y|ies))"),
          "recruitment",
          "recruiting",
        ].join("|") +
        ")\\b",
      "i",
    ),
    message: `Kategori lowongan kerja/rekrutmen. ${SPECIAL_CATEGORY_MESSAGE}`,
  },
  {
    code: "SPECIAL_CATEGORY",
    dimension: "ad_policy",
    severity: "block",
    ignoreKnownFacts: true,
    // Housing: rentals, listings, mortgages.
    pattern: new RegExp(
      "\\b(?:" +
        [
          "kpr",
          "perumahan",
          phrase("properti", "(?:sewa|disewakan|dijual|subsidi|syariah|strategis|baru)"),
          phrase("(?:sewa|jual\\s+beli|agen|bisnis|investasi)", "properti"),
          phrase("sewa", "(?:rumah|apartemen|apartment|kost|kos|kontrakan|ruko|tanah|kamar|kavling)"),
          phrase("(?:rumah|apartemen|apartment|kost|kos|kontrakan|ruko|kamar|tanah|kavling)", "(?:disewakan|dijual|dikontrakkan)"),
          "disewakan",
          "dikontrakkan",
          phrase("real", "estate"),
          phrase("(?:house|home|apartment|apartments|room|property|condo)", "for", "(?:rent|sale)"),
          phrase("for", "rent"),
          phrase("rental", "propert(?:y|ies)"),
        ].join("|") +
        ")\\b",
      "i",
    ),
    message: `Kategori properti sewa/KPR/perumahan. ${SPECIAL_CATEGORY_MESSAGE}`,
  },
  {
    code: "SPECIAL_CATEGORY",
    dimension: "ad_policy",
    severity: "block",
    ignoreKnownFacts: true,
    // Social issues, elections, politics.
    pattern: new RegExp(
      "\\b(?:" +
        [
          "pemilu",
          "pilkada",
          "pilpres",
          "pileg",
          "caleg",
          "capres",
          "cawapres",
          "paslon",
          "pencoblosan",
          phrase("calon", "(?:presiden|legislatif|bupati|gubernur|walikota|wali\\s+kota|anggota\\s+dewan)"),
          phrase("(?:kampanye|iklan)", "(?:politik|pemilu|pilkada|pilpres|capres|caleg)"),
          phrase("partai", "politik"),
          phrase("isu", "(?:sosial|politik)"),
          phrase("nomor", "urut", "\\d+", "(?:pilih|coblos)"),
          "politik",
          "politisi",
          "political",
          "elections?",
          phrase("vote", "(?:for|now)"),
          "referendum",
          "pemungutan\\s+suara",
        ].join("|") +
        ")\\b",
      "i",
    ),
    message: `Kategori isu sosial/politik/pemilu. ${SPECIAL_CATEGORY_MESSAGE}`,
  },
  {
    code: "GENERIC_FILLER",
    dimension: "relevance",
    severity: "warn",
    pattern: /\b(?:solusi\s+terbaik|produk\s+terbaik|kualitas\s+terbaik|terbaik\s+untuk\s+anda|best\s+solution)\b/i,
    message: "Kalimat generik yang bisa dipakai produk apa pun. Ganti dengan detail produk ini.",
  },
];

// Specifications and certifications a model is tempted to invent. A hit is
// only a problem when the SAME text is not in the product facts the user gave.
const SPEC_PATTERN =
  /(?:\bRp\s?\d[\d.,]*|\b\d[\d.,]*\s*(?:(?:gram|gr|kg|ml|liter|mdpl|meter|persen|hari|jam|bulan|tahun|pcs|sachet|bungkus)\b|%)|\bgrade\s+\w+|\bsingle\s*origin\b|\borganik\b|\bfair\s*trade\b|\bhalal\b|\bbpom\b|\bbebas\s+(?:pestisida|gula|pengawet)\b|\btanpa\s+(?:pengawet|gula|bahan\s+kimia)\b)/gi;

const BROAD_AUDIENCE = /\b(?:semua\s+(?:orang|kalangan|usia|golongan)|siapa\s*saja|seluruh\s+masyarakat|umum)\b/i;
const TRANSACTION_PATTERN = /\b(?:beli|pesan|order|checkout|bayar|transfer|buy\s+now|order\s+now)\b/i;

const WEAK_CTA = /^(?:klik\s+(?:di\s+)?sini|click\s+here|selengkapnya|more|lihat|ok)$/i;

function copyOf(proposal: CampaignProposal): { source: string; text: string }[] {
  const fields: { source: string; text: string }[] = [];
  proposal.candidates.forEach((c, i) => {
    const n = i + 1;
    fields.push({ source: `Kandidat ${n} · hook`, text: c.hook });
    fields.push({ source: `Kandidat ${n} · judul`, text: c.headline });
    fields.push({ source: `Kandidat ${n} · CTA`, text: c.cta });
    fields.push({ source: `Kandidat ${n} · teks utama`, text: c.primary_text });
  });
  fields.push({ source: "Teks utama", text: proposal.primary_text });
  // The top-level hook/headline/cta are what the launch actually sends, and the owner can edit them
  // (updateCampaignCopyAction) without touching candidates[]. They are checked too, so an edit cannot
  // slip past the gate. When they equal candidates[0] the (rule, excerpt) de-duplication reports nothing new.
  fields.push({ source: "Hook aktif", text: proposal.hook });
  fields.push({ source: "Judul aktif", text: proposal.headline });
  fields.push({ source: "CTA aktif", text: proposal.cta });
  return fields;
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9À-ɏ]+/)
      .filter((t) => t.length >= 4),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function squash(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

function foundInFacts(excerpt: string, facts: string): boolean {
  if (!facts) return false;
  return squash(facts).includes(squash(excerpt));
}

export function evaluateCampaignQuality(
  proposal: CampaignProposal,
  context: QualityGateContext = {},
): QualityGateResult {
  const issues: QualityIssue[] = [];
  const facts = (context.knownFacts ?? "").trim();
  const seen = new Set<string>();

  for (const field of copyOf(proposal)) {
    for (const rule of TEXT_RULES) {
      const match = rule.pattern.exec(field.text);
      if (!match) continue;
      const excerpt = match[0].trim();
      // A term the user wrote in the product facts is a fact, not an invention.
      // Rules marked ignoreKnownFacts (financial promises, special ad categories) are never excused by it.
      if (!rule.ignoreKnownFacts && rule.dimension === "claim_risk" && foundInFacts(excerpt, facts)) continue;
      // Report each (rule, excerpt) once, not once per candidate that repeats it.
      const key = `${rule.code}:${excerpt.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({
        code: rule.code,
        dimension: rule.dimension,
        severity: rule.severity,
        message: `${rule.message} (${field.source})`,
        excerpt,
      });
    }
  }

  // Facts: a specification or certification in the copy that is not in the
  // product data the user entered is treated as invented until proven otherwise.
  const specSeen = new Set<string>();
  for (const field of copyOf(proposal)) {
    for (const m of field.text.matchAll(SPEC_PATTERN)) {
      const excerpt = m[0].trim();
      const key = squash(excerpt);
      if (specSeen.has(key) || foundInFacts(excerpt, facts)) continue;
      specSeen.add(key);
      issues.push({
        code: "UNSUPPORTED_SPEC",
        dimension: "claim_risk",
        severity: "warn",
        message: `Spesifikasi/fakta ini tidak ada di data produk yang Anda isi. Pastikan benar atau hapus. (${field.source})`,
        excerpt,
      });
    }
  }

  // Simulation: a simulated product must never push toward a transaction.
  if (context.isSimulation) {
    const txSeen = new Set<string>();
    for (const field of copyOf(proposal)) {
      const m = TRANSACTION_PATTERN.exec(field.text);
      if (!m) continue;
      const key = m[0].toLowerCase();
      if (txSeen.has(key)) continue;
      txSeen.add(key);
      issues.push({
        code: "TRANSACTION_IN_SIMULATION",
        dimension: "ad_policy",
        severity: "block",
        message: `Produk simulasi tidak boleh diarahkan ke transaksi. (${field.source})`,
        excerpt: m[0],
      });
    }
  }

  // Differentiation: the three candidates must be different angles, not rewordings.
  const sets = proposal.candidates.map((c) => tokens(`${c.hook} ${c.primary_text}`));
  let mostSimilar = 0;
  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i + 1; j < sets.length; j += 1) {
      mostSimilar = Math.max(mostSimilar, jaccard(sets[i], sets[j]));
    }
  }
  if (mostSimilar >= 0.6) {
    issues.push({
      code: "CANDIDATES_TOO_SIMILAR",
      dimension: "differentiation",
      severity: "warn",
      message: "Tiga kandidat terlalu mirip, bukan sudut pandang yang berbeda. Buat ulang atau pilih yang terkuat saja.",
    });
  }

  // Benefit clarity: body copy must say something, and a value proposition must exist.
  const top = proposal.candidates[0];
  if (top.primary_text.trim().length < 60) {
    issues.push({
      code: "THIN_BODY_COPY",
      dimension: "benefit_clarity",
      severity: "warn",
      message: "Teks utama kandidat terbaik terlalu pendek untuk menjelaskan masalah, solusi, dan manfaat.",
    });
  }
  if (proposal.value_proposition.trim().length < 20) {
    issues.push({
      code: "NO_VALUE_PROPOSITION",
      dimension: "benefit_clarity",
      severity: "warn",
      message: "Nilai jual produk belum jelas.",
    });
  }

  // Hook strength: a hook must be specific to THIS product/problem, not a slogan.
  const specific = new Set([
    ...tokens(`${context.productName ?? ""} ${proposal.customer_pain} ${proposal.value_proposition} ${proposal.positioning}`),
  ]);
  for (const [i, c] of proposal.candidates.entries()) {
    const hook = c.hook.trim();
    const same = hook.length > 0 && hook.toLowerCase() === c.headline.trim().toLowerCase();
    const short = hook.length < 15;
    const shares = [...tokens(hook)].some((t) => specific.has(t));
    if (short || same || !shares) {
      issues.push({
        code: "WEAK_HOOK",
        dimension: "hook_strength",
        severity: "warn",
        message: `Hook kandidat ${i + 1} ${
          short ? "terlalu pendek" : same ? "sama dengan judul" : "tidak terkait masalah atau produk"
        }. Hook harus spesifik dan menyentuh masalah pembeli.`,
        excerpt: hook || undefined,
      });
    }
  }

  // Audience: who it is for must be stated, and not "everyone".
  const audience = proposal.audience_summary.trim();
  if (audience.length < 20 || BROAD_AUDIENCE.test(audience)) {
    issues.push({
      code: "AUDIENCE_TOO_BROAD",
      dimension: "audience_fit",
      severity: "warn",
      message: "Audiens belum jelas atau terlalu luas (mis. \"semua orang\"). Sebutkan siapa yang paling cocok dan situasinya.",
      excerpt: audience || undefined,
    });
  }

  // CTA strength.
  for (const [i, c] of proposal.candidates.entries()) {
    const cta = c.cta.trim();
    if (cta.length < 3 || WEAK_CTA.test(cta)) {
      issues.push({
        code: "WEAK_CTA",
        dimension: "cta_strength",
        severity: "warn",
        message: `CTA kandidat ${i + 1} lemah atau kosong ("${cta || "kosong"}"). Gunakan ajakan yang jelas dan sesuai tujuan.`,
        excerpt: cta || undefined,
      });
    }
  }

  // Relevance: the copy should actually be about this product.
  const name = (context.productName ?? "").trim();
  if (name) {
    const wanted = [...tokens(name)];
    if (wanted.length > 0) {
      const haystack = `${proposal.value_proposition} ${proposal.positioning} ${proposal.candidates
        .map((c) => `${c.hook} ${c.headline} ${c.primary_text}`)
        .join(" ")}`.toLowerCase();
      if (!wanted.some((t) => haystack.includes(t))) {
        issues.push({
          code: "PRODUCT_NOT_MENTIONED",
          dimension: "relevance",
          severity: "warn",
          message: "Teks strategi tidak menyebut produk ini sama sekali. Periksa apakah isinya benar-benar tentang produk Anda.",
        });
      }
    }
  }

  // Channel split sanity (budget allocation is a recommendation, but must add up).
  const total = proposal.budget_allocation.reduce((sum, b) => sum + b.percentage, 0);
  if (total < 95 || total > 105) {
    issues.push({
      code: "ALLOCATION_NOT_100",
      dimension: "relevance",
      severity: "warn",
      message: `Pembagian budget antar-channel berjumlah ${Math.round(total)}%, bukan sekitar 100%.`,
    });
  }

  const dimensions: QualityDimensionResult[] = DIMENSION_ORDER.map((id) => {
    const own = issues.filter((i) => i.dimension === id);
    const status: QualityStatus = own.some((i) => i.severity === "block") ? "FAIL" : own.length > 0 ? "REVIEW" : "PASS";
    const deduction = own.reduce((sum, i) => sum + (i.severity === "block" ? 40 : 15), 0);
    return { id, label: DIMENSION_LABELS[id], status, score: Math.max(0, 100 - deduction) };
  });

  const overall: QualityStatus = dimensions.some((d) => d.status === "FAIL")
    ? "FAIL"
    : dimensions.some((d) => d.status === "REVIEW")
      ? "REVIEW"
      : "PASS";

  const mean = dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length;
  const capped = overall === "FAIL" ? Math.min(mean, 59) : overall === "REVIEW" ? Math.min(mean, 89) : mean;

  return { status: overall, score: Math.round(capped), dimensions, issues };
}


/** True when at least one issue has severity "block" (must be fixed before the campaign is submitted). */
export function hasBlockingIssue(result: Pick<QualityGateResult, "issues">): boolean {
  return result.issues.some((issue) => issue.severity === "block");
}

/** The issues with severity "block", in the order the gate reported them. */
export function blockingIssues(result: Pick<QualityGateResult, "issues">): QualityIssue[] {
  return result.issues.filter((issue) => issue.severity === "block");
}

const MAX_ISSUES_IN_MESSAGE = 3;

/**
 * Indonesian, actionable refusal text for a result that has blocking issues
 * (used by submitForApprovalAction). Returns null when nothing blocks.
 */
export function formatBlockingIssuesMessage(result: Pick<QualityGateResult, "issues">): string | null {
  const blocking = blockingIssues(result);
  if (blocking.length === 0) return null;
  const shown = blocking.slice(0, MAX_ISSUES_IN_MESSAGE).map((issue, i) => {
    const quote = issue.excerpt ? ` Kutipan: "${issue.excerpt}".` : "";
    return `${i + 1}) ${issue.message}${quote}`;
  });
  const rest = blocking.length - shown.length;
  return [
    "Campaign belum bisa diajukan: teks iklan memuat hal yang diblokir oleh pemeriksaan kualitas.",
    shown.join(" "),
    rest > 0 ? `Masih ada ${rest} masalah lain.` : null,
    "Revisi copy di halaman campaign atau buat ulang strategi, lalu ajukan lagi. Tidak ada pengajuan yang dibuat.",
  ]
    .filter(Boolean)
    .join(" ");
}
