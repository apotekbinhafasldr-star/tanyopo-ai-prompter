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
 * is a stated fact, not something the model made up.
 */

export type QualityDimensionId =
  | "relevance"
  | "differentiation"
  | "benefit_clarity"
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
  cta_strength: "Kekuatan ajakan (CTA)",
  ad_policy: "Kepatuhan format iklan",
  claim_risk: "Risiko klaim",
};

const DIMENSION_ORDER: readonly QualityDimensionId[] = [
  "relevance",
  "differentiation",
  "benefit_clarity",
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
}

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
      if (rule.dimension === "claim_risk" && foundInFacts(excerpt, facts)) continue;
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
