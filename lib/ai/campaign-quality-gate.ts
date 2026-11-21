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
 * is a stated fact, not something the model made up. Rules marked
 * `ignoreKnownFacts` (guaranteed/numeric results, income, weight-loss, medical cure, before-after on bodies,
 * personal attributes, gambling, FINANCIAL_CLAIM, SPECIAL_CATEGORY, ...) are the exception: a result promise,
 * financial promise or special ad category is not made acceptable by the user having written it in the product
 * description.
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
  /**
   * Which copy is scanned. "all" (default, what the campaign page shows as advice): the three candidates and the
   * active copy. "active": only the copy that is actually launched (top-level hook/headline/primary_text/cta).
   * Enforcement at submit uses "active": the owner can edit the active copy but not the alternative candidates,
   * so a problem confined to an alternative candidate must not lock the campaign.
   */
  readonly copyScope?: "all" | "active";
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
  /** Skip this (weaker) rule for a field in which a rule with this code already matched. */
  readonly suppressedByBlockCode?: string;
}

/** Separator between the words of a phrase: tolerates extra spaces, hyphens, dots, commas, slashes and underscores. */
const SEP = "[\\s\\-_.,/]+";
/** Joins phrase words with SEP so "cepat kaya", "cepat-kaya" and "cepat   kaya" all match. */
const phrase = (...words: string[]): string => words.join(SEP);

const SPECIAL_CATEGORY_MESSAGE =
  "Kategori iklan khusus (special_ad_categories). Banyak platform iklan mewajibkan deklarasi kategori ini (Meta salah satunya) dan LINOE belum mendukungnya, sehingga iklan untuk kategori ini diblokir sampai ada dukungan. Ubah copy atau jangan promosikan kategori ini lewat LINOE.";

// Patterns are intentionally narrow: a false alarm only costs the reviewer a
// glance, but a rule that fires on ordinary copy would train people to ignore
// the gate.
const TEXT_RULES: readonly TextRule[] = [
  {
    code: "GUARANTEED_RESULT",
    dimension: "claim_risk",
    severity: "block",
    pattern:
      /\b(?:dijamin(?!\s+(?:segar|asli|original|ori|fresh|halal|bersih|higienis|baru|enak|nikmat|awet|puas|murah|tepat|lembut|aman|berkualitas|kualitas|ongkir|sampai)\b)|garansi\s+(?:laris|untung|terjual|hasil|sembuh)|pasti\s+(?:laris|untung|terjual|berhasil|sembuh|naik)|100\s*%\s*(?:aman|berhasil|manjur|sembuh|ampuh)|dijamin\s+(?:\S+\s+){0,3}?(?:sembuh|laris|untung|kurus|langsing|viral|cuan|berhasil|ampuh|manjur|terjual|sukses)(?![-\w])|tanpa\s+risiko|guaranteed?|risk[- ]free)\b/i,
    ignoreKnownFacts: true,
    message: "Menjanjikan hasil pasti. Hapus atau ganti dengan manfaat yang bisa dibuktikan.",
  },
  {
    // Context-aware: "dijamin segar/asli" assures a product attribute the seller can verify (Meta bans guaranteed
    // RESULTS, not product-quality statements), so it is a warn. "dijamin laris/sembuh/kurus/..." stays a block above.
    code: "GUARANTEED_QUALITY",
    dimension: "claim_risk",
    severity: "warn",
    pattern: /\bdijamin\s+(?:segar|asli|original|ori|fresh|halal|bersih|higienis|baru|enak|nikmat|awet|puas|murah|tepat|lembut|aman|berkualitas|kualitas|ongkir|sampai)\b/i,
    message: "Jaminan kualitas produk. Pakai hanya jika benar-benar bisa dipenuhi dan dibuktikan (mis. kebijakan retur).",
  },
  {
    code: "NUMERIC_RESULT_PROMISE",
    dimension: "claim_risk",
    severity: "block",
    pattern: /\b(?:omzet|penjualan|profit|untung|pembeli)\s+(?:naik|meningkat|bertambah|melonjak|meroket)\s+(?:hingga\s+|sampai\s+|drastis\s+)?\d/i,
    ignoreKnownFacts: true,
    message: "Menjanjikan angka hasil penjualan. Tidak boleh tanpa bukti nyata.",
  },
  {
    code: "INCOME_CLAIM",
    dimension: "claim_risk",
    severity: "block",
    ignoreKnownFacts: true,
    // Earning context + amount. Price-per-period copy ("Langganan Rp99.000 per bulan", "Kost 1,5 juta per bulan") has no
    // earning word and is NOT matched here; "Untung banget, cuma Rp18.000" is excluded by the lookahead.
    pattern:
      /\b(?:penghasilan|pendapatan|gaji|income|omzet|cuan|profit|untung(?!\s+(?:banget|bgt|sekali|deh|dong|nih)\b))\b[^.!?\n]{0,30}?(?:Rp\s?\d|\d[\d.,]*\s*(?:juta|jt|ribu|rb)\b)|\b(?:dapat|dapatkan|raih|hasilkan|menghasilkan)\b(?=(?:\.(?=\d)|[^.!?\n]){0,40}?\b(?:penghasilan|cuan|passive\s+income|dari\s+rumah|tanpa\s+modal|kerja\s+\d|jadi\s+reseller|uang)\b)(?:\.(?=\d)|[^.!?\n]){0,40}?(?:Rp\s?\d[\d.,]*|\d[\d.,]*\s*(?:juta|jt|ribu|rb))\s*(?:juta|jt|ribu|rb)?\s*(?:\/\s*|per\s*|se|tiap\s+|setiap\s+)(?:hari|minggu|bulan|bln)\b(?!\s+ini)|\b(?:dibayar|komisi|bonus)\b[^.!?\n]{0,25}?(?:Rp\s?\d|\d[\d.,]*\s*(?:juta|jt|ribu|rb)\b)|\b(?:dapat|dapet|dapatkan|bisa\s+dapat|raih|hasilkan|menghasilkan)\s+(?:Rp\s?)?\d[\d.,]*\s*(?:juta|jt|ribu|rb)\s*(?:\/\s*|per\s*|se|tiap\s+|setiap\s+)(?:hari|minggu|bulan|bln)\b(?!\s+ini)|\b(?:dapat|dapet|dapatkan|bisa\s+dapat|raih|hasilkan|menghasilkan)\s+Rp\s?\d{1,3}(?:\.\d{3}){2,}\s*(?:\/\s*|per\s*|se|tiap\s+|setiap\s+)(?:hari|minggu|bulan|bln)\b|\bpenghasilan\s+(?:jutaan|puluhan\s+juta|ratusan\s+juta)\b/i,
    message: "Janji penghasilan/untung dalam angka. Tidak boleh tanpa bukti nyata dan berisiko ditolak platform.",
  },
  {
    code: "BEFORE_AFTER_PERSONAL",
    dimension: "ad_policy",
    severity: "block",
    ignoreKnownFacts: true,
    pattern:
      /\b(?:before\s*(?:[\/&-]|and|dan)?\s*after|sebelum\s*(?:[\/&-]|dan)\s*sesudah|foto\s+(?:sebelum|before))\b[^.!?\n]{0,40}?\b(?:berat|badan|kulit|wajah|jerawat|flek|lemak|perut|rambut|botak|gigi|payudara|bentuk\s+tubuh|weight|skin|face|acne|hair|body|belly)\b|\b(?:berat|badan|kulit|wajah|jerawat|flek|lemak|perut|rambut|weight|skin|face|acne|hair|body|belly)\b[^.!?\n]{0,40}?\b(?:before\s*(?:[\/&-]|and|dan)?\s*after|sebelum\s*(?:[\/&-]|dan)\s*sesudah)\b/i,
    message: "Perbandingan sebelum/sesudah pada tubuh, kulit, atau berat badan. Dilarang oleh kebijakan iklan Meta.",
  },
  {
    code: "BEFORE_AFTER",
    dimension: "ad_policy",
    severity: "warn",
    suppressedByBlockCode: "BEFORE_AFTER_PERSONAL",
    pattern: /\b(?:before\s*(?:[\/&-]|and|dan)?\s*after|sebelum\s*(?:[\/&-]|dan)\s*sesudah)\b/i,
    message: "Perbandingan sebelum/sesudah. Boleh untuk produk non-personal (mis. pembersih), dilarang untuk tubuh/kesehatan.",
  },
  {
    code: "PERSONAL_ATTRIBUTE",
    dimension: "ad_policy",
    severity: "block",
    ignoreKnownFacts: true,
    pattern:
      /\b(?:kamu|anda|kau|lo|you|your)\b\s+(?:\S+\s+){0,3}?(?:gemuk|obesitas|diabetes|depresi|botak|jerawatan|bangkrut|berhutang|mengidap|menderita|overweight|fat|depressed|bankrupt|in\s+debt)\b/i,
    message: "Teks menyiratkan kondisi pribadi pembaca (kesehatan, berat badan, keuangan). Dilarang oleh kebijakan iklan Meta.",
  },
  {
    code: "WEIGHT_LOSS_CLAIM",
    dimension: "claim_risk",
    severity: "block",
    ignoreKnownFacts: true,
    pattern:
      /\b(?:turun(?!\s+harga)|menurunkan|kurus|langsing|melangsingkan|lose)\s*(?:(?!harga\b)\S+\s+){0,2}?\d+\s*(?:kg|kilo|kilogram|lbs?|pounds?)\b/i,
    message: "Janji penurunan berat badan dalam angka. Dilarang oleh kebijakan iklan Meta.",
  },
  {
    code: "MEDICAL_CURE",
    dimension: "claim_risk",
    severity: "block",
    ignoreKnownFacts: true,
    pattern:
      /\b(?:menyembuhkan|sembuhkan|mengobati|obat|cures?|heals?|treats?)\s+(?:\S+\s+){0,3}?(?:kanker|tumor|diabetes|kencing\s+manis|hipertensi|darah\s+tinggi|asam\s+urat|kolesterol|jantung|stroke|covid|corona|hiv|aids|asma|ginjal|hepatitis|tbc|cancer|arthritis|alzheimer)\b/i,
    message: "Klaim menyembuhkan penyakit tertentu. Dilarang tanpa izin edar dan bukti; ditolak platform.",
  },
  {
    code: "CLINICAL_CLAIM",
    dimension: "claim_risk",
    severity: "warn",
    pattern:
      /\b(?:terbukti\s+(?:secara\s+)?(?:klinis|ilmiah|khasiat|manjur|ampuh)|teruji\s+klinis|clinically\s+(?:proven|tested)|(?:direkomendasikan|rekomendasi)\s+dokter|detox|detoks|pelangsing|pembakar\s+lemak|fat\s*burner)\b/i,
    message: "Klaim klinis/kesehatan (terbukti klinis, detox, pelangsing, rekomendasi dokter). Wajib ada bukti dan izin (mis. BPOM).",
  },
  {
    code: "SUPERLATIVE_CLAIM",
    dimension: "claim_risk",
    severity: "warn",
    pattern:
      /(?:^|\s)#\s?1\b|\bpaling\s+(?:murah|enak|laris|ampuh|bagus|manjur|aman|cepat)\b|\bterbaik\s+(?:se|di)\s*(?:indonesia|dunia|asia)\b|\b(?:the\s+)?(?:best|cheapest|#1)\s+in\s+(?:indonesia|the\s+world)\b/i,
    message: "Klaim superlatif (#1, paling ...). Pakai hanya jika ada bukti yang bisa ditunjukkan.",
  },
  {
    code: "MONEY_BACK_GUARANTEE",
    dimension: "claim_risk",
    severity: "warn",
    pattern: /\b(?:uang\s+kembali|garansi\s+(?:uang|kembali)|money[- ]back|refund\s+(?:100|penuh))\b/i,
    message: "Jaminan uang kembali. Pakai hanya jika kebijakan retur memang ada dan bisa dipenuhi.",
  },
  {
    code: "GAMBLING",
    dimension: "ad_policy",
    severity: "block",
    ignoreKnownFacts: true,
    pattern: /\b(?:judi|judol|slot\s+(?:gacor|online)|togel|casino|kasino|taruhan|betting|poker\s+online|sportsbook|bandar\s+(?:bola|judi))\b/i,
    message: "Perjudian. Memerlukan izin khusus platform dan tidak didukung LINOE.",
  },
  {
    code: "ALCOHOL",
    dimension: "ad_policy",
    severity: "warn",
    pattern: /\b(?:miras|minuman\s+keras|beer|wine|vodka|whisky|whiskey|soju|tuak|arak|cocktail)\b|(?<!bebas\s)(?<!tanpa\s)\balkohol\b/i,
    message: "Alkohol. Iklan dibatasi (usia, hukum setempat) oleh platform; tinjau sebelum menerbitkan.",
  },
  {
    code: "MEDICAL_CLAIM",
    dimension: "claim_risk",
    severity: "warn",
    suppressedByBlockCode: "MEDICAL_CURE",
    pattern: /\b(?:menyembuhkan|sembuhkan|obat\s+ajaib|mengobati|cures?|treats?\s+(?:disease|cancer|diabetes))\b/i,
    ignoreKnownFacts: true,
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
    pattern:
      /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|id|co\.id|web\.id|my\.id|net|org|shop|store|me|io|co|ly|ee|link|app|xyz|site|online|bio|info|biz|tv|ink)\b/i,
    message: "Ada tautan/domain di teks iklan. Tautan resmi dipasang sistem saat peluncuran.",
  },
  {
    code: "PHONE_IN_COPY",
    dimension: "ad_policy",
    severity: "block",
    // 08xx, +62 8xx, 62 8xx, 0812-3456-7890, 0812.3456.7890 (separators: space, dot, dash).
    pattern: /(?:\+\s?62|\b62|\b0)[\s.\-()]*8\d(?:[\s.\-]*\d){7,11}/,
    message: "Ada nomor telepon/WhatsApp di teks iklan. Tidak boleh ditulis di teks.",
  },
  {
    code: "FINANCIAL_CLAIM",
    dimension: "claim_risk",
    severity: "block",
    ignoreKnownFacts: true,
    // Offer / promise phrases only. A bare "investasi", "saham" or "invest" is NOT enough: "investasi jangka
    // panjang" on a wall paint or "beli saham cokelat" must pass (see the PR-5 false-positive tests).
    pattern: new RegExp(
      "\\b(?:" +
        [
          // quick loans / credit offers
          phrase("pinjaman", "(?:cepat|online|instan|kilat|tanpa\\s+(?:agunan|jaminan|bi\\s+checking))"),
          phrase("kredit", "(?:cepat|instan|kilat|tanpa\\s+(?:agunan|jaminan))"),
          "pinjol",
          phrase("dana", "(?:cair|segar)", "(?:cepat|hari\\s+ini|instan)"),
          phrase("(?:fast|quick|instant|easy|payday|cash)", "loans?"),
          // investment offers / promises
          phrase("investasi", "(?:\\S+\\s+){0,2}?(?:pasti|dijamin|untung|cuan|profit|return|imbal|bunga|berlipat|menguntungkan|bebas\\s+risiko|tanpa\\s+risiko)"),
          phrase("(?:untung|cuan|profit|return|imbal\\s+hasil|bunga)", "(?:\\S+\\s+){0,2}?investasi"),
          phrase("(?:mulai|ayo|yuk|ajakan|peluang|produk|platform|paket)", "(?:berinvestasi|investasi)"),
          phrase("investasi", "(?:kripto|crypto|bitcoin|forex|saham|reksa\\s*dana|emas\\s+digital|online|bodong)"),
          phrase("invest", "(?:now|and\\s+earn|with\\s+us|in\\s+(?:crypto|stocks|forex|bitcoin))"),
          phrase("investment", "(?:opportunit(?:y|ies)|plan|platform|returns?)"),
          phrase("(?:guaranteed|high|big|huge)", "returns?"),
          phrase("(?:trading|trade)", "(?:crypto|kripto|forex|saham|bitcoin|stocks?)"),
          phrase("(?:beli|jual)", "(?:crypto|kripto|bitcoin|forex)"),
          phrase("saham", "(?:pasti|dijamin|cuan|profit|untung|gorengan)"),
          phrase("(?:kripto|crypto|bitcoin|forex)", "(?:signal|sinyal|pasti|cuan|profit|untung)"),
          phrase("reksa\\s*dana", "(?:pasti|dijamin|cuan|profit|untung)"),
          phrase("(?:binary|opsi)", "(?:options?|biner)"),
          // get rich / passive income
          phrase("cepat", "kaya"),
          phrase("kaya", "(?:mendadak|raya)"),
          phrase("get", "rich", "(?:quick|fast)"),
          phrase("(?:jadi|menjadi)", "(?:miliarder|milyarder|jutawan)"),
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
  // Special ad categories. Offer phrases are "block"; a bare ambiguous word is only a "warn" (SPECIAL_CATEGORY_HINT).
  {
    code: "SPECIAL_CATEGORY",
    dimension: "ad_policy",
    severity: "block",
    ignoreKnownFacts: true,
    // Credit / loans / leasing offers.
    pattern: new RegExp(
      "\\b(?:" +
        [
          phrase("kartu", "kredit"),
          phrase("kredit", "(?:motor|mobil|rumah|usaha|kendaraan|multiguna|konsumer|konsumen|syariah|pemilikan|online|tanpa\\s+(?:agunan|jaminan))"),
          phrase("pinjaman", "(?:uang|dana|usaha|online|tunai|modal|kilat|cepat|instan|pribadi|bank|multiguna|kendaraan|rumah|mobil|motor|tanpa|berbunga)"),
          phrase("(?:ajukan|ajukan\\s+sekarang|apply\\s+for\\s+an?)", "(?:pinjaman|kredit|kpr|leasing|loan)"),
          "pinjol",
          phrase("pinjam", "uang"),
          phrase("leasing", "(?:motor|mobil|kendaraan|alat|rumah)"),
          "kpr",
          phrase("pembiayaan", "(?:kendaraan|motor|mobil|multiguna|konsumen|konsumer|rumah)"),
          "multi\\s*finance",
          phrase("(?:home|auto|car|personal|payday|student|business|fast|quick|instant)", "loans?"),
          phrase("mortgages?", "(?:rates?|offers?|loans?)"),
          phrase("credit", "cards?"),
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
    // Employment / recruitment offers.
    pattern: new RegExp(
      "\\b(?:" +
        [
          phrase("(?:lowongan|loker)", "(?:kerja|pekerjaan|karir|karier|magang)"),
          phrase("(?:membuka|dibuka|buka)", "(?:lowongan|rekrutmen|recruitment)"),
          phrase("(?:sedang|kami|segera)", "(?:merekrut|mencari\\s+(?:karyawan|pegawai|staf|staff|barista|kasir))"),
          phrase("rekrutmen", "(?:terbuka|karyawan|pegawai|staf|staff|tenaga)"),
          phrase("open", "(?:recruitment|hiring)"),
          phrase("penerimaan", "(?:karyawan|pegawai|staf|staff)"),
          phrase("(?:dicari|dibutuhkan|cari)", "(?:karyawan|pegawai|staf|staff|barista|kasir)"),
          phrase("(?:melamar|lamar)", "(?:kerja|pekerjaan)(?!\\s*sama)"),
          "we(?:['’]re|\\s+are)\\s+(?:hiring|recruiting)",
          phrase("now", "hiring"),
          phrase("job", "(?:openings?|vacanc(?:y|ies))"),
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
    // Housing offers: rentals, listings, mortgages.
    pattern: new RegExp(
      "\\b(?:" +
        [
          "kpr",
          phrase("properti", "(?:sewa|disewakan|dijual|subsidi|syariah)"),
          phrase("(?:jual\\s+beli|agen|sewa)", "properti"),
          phrase("sewa", "(?:rumah|apartemen|apartment|kost|kos|kontrakan|ruko|tanah|kamar|kavling)"),
          phrase("(?:rumah|apartemen|apartment|kost|kontrakan|ruko|kamar|tanah|kavling)", "(?:disewakan|dijual|dikontrakkan)"),
          phrase("perumahan", "(?:baru|subsidi|murah|syariah|cluster|dijual|tanpa\\s+dp)"),
          phrase("(?:rumah|cluster)", "(?:subsidi|cluster|perumahan)"),
          phrase("(?:house|home|apartment|apartments|room|property|condo)", "for", "(?:rent|sale)"),
          phrase("real", "estate", "(?:listings?|agents?|for)"),
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
    // Elections / political campaigning / social issues.
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
          phrase("coblos", "(?:nomor|no)", "\\d+"),
          phrase("(?:dukung|pilih)", "(?:paslon|capres|caleg|calon)"),
          phrase("vote", "for", "(?:the\\s+)?(?:candidate|president|mayor|senator|governor|party|proposition)"),
          phrase("(?:political|election)", "(?:campaigns?|ads?|party|candidates?)"),
          phrase("elections?", "(?:day|20\\d\\d)"),
          "pemungutan\\s+suara",
        ].join("|") +
        ")\\b",
      "i",
    ),
    message: `Kategori isu sosial/politik/pemilu. ${SPECIAL_CATEGORY_MESSAGE}`,
  },
  {
    code: "SPECIAL_CATEGORY_HINT",
    dimension: "ad_policy",
    severity: "warn",
    suppressedByBlockCode: "SPECIAL_CATEGORY",
    // Single words that MAY signal a special ad category but are ordinary words too ("Pinjaman buku gratis",
    // "Perumahan sehat dengan tanaman hias", "acara politik tradisi"). A reviewer decides.
    pattern: /\b(?:pinjaman|leasing|perumahan|properti|rekrutmen|merekrut|politik|politisi|political|elections?|loans?|mortgages?|disewakan|dikontrakkan|for\s+rent)\b/i,
    message:
      "Kata ini bisa menandakan kategori iklan khusus (kredit, lowongan kerja, properti, isu sosial/politik). Jika iklan ini menawarkan salah satunya, ubah copy: LINOE belum mendukung deklarasi kategori khusus.",
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

interface CopyField {
  readonly source: string;
  readonly text: string;
}

/**
 * The copy the launch really sends: `features/campaigns/launch-actions.ts` reads proposal.headline,
 * proposal.primary_text and proposal.cta; the preview also shows proposal.hook. These top-level fields are what
 * updateCampaignCopyAction writes. Alternative candidates are never sent unless the owner swaps one in
 * (selectCandidate), which rewrites these same fields.
 */
function activeCopyOf(proposal: Pick<CampaignProposal, "hook" | "headline" | "cta" | "primary_text">): CopyField[] {
  return [
    { source: "Hook aktif", text: proposal.hook },
    { source: "Judul aktif", text: proposal.headline },
    { source: "CTA aktif", text: proposal.cta },
    { source: "Teks utama", text: proposal.primary_text },
  ];
}

function copyOf(proposal: CampaignProposal, scope: "all" | "active" = "all"): CopyField[] {
  if (scope === "active") return activeCopyOf(proposal);
  const fields: CopyField[] = [];
  proposal.candidates.forEach((c, i) => {
    const n = i + 1;
    fields.push({ source: `Kandidat ${n} · hook`, text: c.hook });
    fields.push({ source: `Kandidat ${n} · judul`, text: c.headline });
    fields.push({ source: `Kandidat ${n} · CTA`, text: c.cta });
    fields.push({ source: `Kandidat ${n} · teks utama`, text: c.primary_text });
  });
  // The active copy is checked too, so an owner edit cannot slip past the gate. When it equals candidates[0]
  // the (rule, excerpt) de-duplication reports nothing new.
  fields.push(...activeCopyOf(proposal));
  return fields;
}

/** Runs TEXT_RULES over `fields`, de-duplicating by (rule, excerpt). Shared by the full gate and the raw fallback. */
function textRuleIssues(
  fields: readonly CopyField[],
  facts: string,
  rules: readonly TextRule[],
  seen: Set<string> = new Set<string>(),
): QualityIssue[] {
  const issues: QualityIssue[] = [];
  for (const field of fields) {
    const matchedHere = new Set<string>();
    for (const rule of rules) {
      if (rule.suppressedByBlockCode && matchedHere.has(rule.suppressedByBlockCode)) continue;
      const match = rule.pattern.exec(field.text);
      if (!match) continue;
      matchedHere.add(rule.code);
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
  return issues;
}

const RAW_FALLBACK_CODES: readonly string[] = ["FINANCIAL_CLAIM", "SPECIAL_CATEGORY"];

/**
 * Fallback for a stored proposal that does NOT parse against the schema (legacy shapes), so the full gate cannot
 * run. Scans only the known active copy strings (hook, headline, cta, primary_text) for the two blocking rules
 * FINANCIAL_CLAIM and SPECIAL_CATEGORY. Anything that is not an object, or has no such string, yields no issues:
 * the proposal stays "cannot be assessed". Candidates are deliberately not scanned: the owner cannot edit them.
 */
export function scanRawProposalCopy(raw: unknown): QualityIssue[] {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return [];
  const record = raw as Record<string, unknown>;
  const labels: Record<string, string> = { hook: "Hook aktif", headline: "Judul aktif", cta: "CTA aktif", primary_text: "Teks utama" };
  const fields: CopyField[] = [];
  for (const [key, source] of Object.entries(labels)) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) fields.push({ source, text: value });
  }
  if (fields.length === 0) return [];
  return textRuleIssues(
    fields,
    "",
    TEXT_RULES.filter((rule) => RAW_FALLBACK_CODES.includes(rule.code)),
  );
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

  const scope = context.copyScope ?? "all";
  issues.push(...textRuleIssues(copyOf(proposal, scope), facts, TEXT_RULES, seen));

  // Facts: a specification or certification in the copy that is not in the
  // product data the user entered is treated as invented until proven otherwise.
  const specSeen = new Set<string>();
  for (const field of copyOf(proposal, scope)) {
    for (const m of field.text.matchAll(SPEC_PATTERN)) {
      // "Rp18.000." at the end of a sentence must match the fact "Rp18.000": drop trailing . and , only.
      const excerpt = m[0].trim().replace(/[.,]+$/, "");
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
    for (const field of copyOf(proposal, scope)) {
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
