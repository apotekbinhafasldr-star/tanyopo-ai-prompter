import { add, zero, type Money } from "@/lib/finance/money";

/**
 * Tax credits (kredit pajak, Pasal 28 UU PPh) and payments. A credit counts only when it has proof,
 * is verified, is creditable by its nature, is not a duplicate, and has not already been claimed.
 * Final taxes are never creditable.
 */
export type CreditKind = "PPH21" | "PPH22" | "PPH23" | "PPH24" | "PPH25" | "PPH26" | "PPH_FINAL" | "LAINNYA";

export interface TaxCreditRecord {
  readonly id: string;
  readonly kind: CreditKind;
  readonly taxYear: string;
  readonly date: string;
  readonly amount: Money;
  /** Bukti potong/pungut number or payment proof (NTPN). Required. */
  readonly evidenceRef: string;
  /** Who withheld (name or NPWP), for withholding slips. */
  readonly counterparty: string | null;
  /** Id of the claim (e.g. an SPT) that already used this credit; null when unclaimed. */
  readonly claimedIn: string | null;
  readonly verifiedBy: string | null;
  readonly verifiedAt: string | null;
}

export type CreditStatus =
  | "DAPAT_DIKREDITKAN"
  | "BUKAN_KREDIT_PAJAK_FINAL"
  | "PERLU_VERIFIKASI_KHUSUS"
  | "BELUM_DIVERIFIKASI"
  | "BUKTI_KOSONG"
  | "BUKTI_GANDA"
  | "DUGAAN_PEMBAYARAN_GANDA"
  | "SUDAH_DIKLAIM"
  | "BEDA_TAHUN_PAJAK";

export interface CreditFinding {
  readonly id: string;
  readonly kind: CreditKind;
  readonly amount: Money;
  readonly status: CreditStatus;
  readonly note: string;
}

export interface CreditReview {
  readonly findings: readonly CreditFinding[];
  /** Everything with proof that was verified and is not a duplicate, final taxes included (a payment, not a credit). */
  readonly paidVerified: Money;
  /** Creditable total for this claim. */
  readonly creditableVerified: Money;
  readonly flagged: number;
}

const filled = (s: string | null | undefined): boolean => Boolean(s && s.trim());
const NOTE: Record<CreditStatus, string> = {
  DAPAT_DIKREDITKAN: "Terverifikasi, ada bukti, belum diklaim.",
  BUKAN_KREDIT_PAJAK_FINAL: "Pajak final tidak dapat dikreditkan.",
  PERLU_VERIFIKASI_KHUSUS: "Kredit ini ada batasnya menurut ketentuan: perlu perhitungan akuntan, tidak dihitung otomatis.",
  BELUM_DIVERIFIKASI: "Belum diverifikasi: tidak dihitung.",
  BUKTI_KOSONG: "Tanpa bukti: tidak dicatat.",
  BUKTI_GANDA: "Nomor bukti sudah dipakai catatan lain: tidak dihitung dua kali.",
  DUGAAN_PEMBAYARAN_GANDA: "Jenis, tanggal, jumlah, dan pihak sama dengan catatan lain: kemungkinan pembayaran ganda, diperiksa dulu.",
  SUDAH_DIKLAIM: "Sudah dipakai pada klaim lain: tidak boleh diklaim lagi.",
  BEDA_TAHUN_PAJAK: "Bukan untuk tahun pajak ini.",
};

export function reviewCredits(records: readonly TaxCreditRecord[], taxYear: string, claimId: string, currency: string): CreditReview {
  const seenIds = new Set<string>();
  const proofFirst = new Map<string, string>();
  const tripleFirst = new Map<string, string>();
  let paid = zero(currency);
  let credit = zero(currency);
  let flagged = 0;
  const findings: CreditFinding[] = [];

  for (const r of records) {
    if (seenIds.has(r.id)) throw new Error(`Duplicate credit record ${r.id}`);
    seenIds.add(r.id);
    const proof = r.evidenceRef.trim().toLowerCase();
    const triple = `${r.kind}|${r.date}|${r.amount.minor.toString()}|${(r.counterparty ?? "").trim().toLowerCase()}`;
    let status: CreditStatus;
    if (!proof) status = "BUKTI_KOSONG";
    else if (r.taxYear !== taxYear) status = "BEDA_TAHUN_PAJAK";
    else if (proofFirst.has(proof)) status = "BUKTI_GANDA";
    else if (tripleFirst.has(triple)) status = "DUGAAN_PEMBAYARAN_GANDA";
    else if (!filled(r.verifiedBy) || !filled(r.verifiedAt)) status = "BELUM_DIVERIFIKASI";
    else if (filled(r.claimedIn) && r.claimedIn !== claimId) status = "SUDAH_DIKLAIM";
    else if (r.kind === "PPH_FINAL") status = "BUKAN_KREDIT_PAJAK_FINAL";
    else if (r.kind === "PPH24" || r.kind === "PPH26" || r.kind === "LAINNYA") status = "PERLU_VERIFIKASI_KHUSUS";
    else status = "DAPAT_DIKREDITKAN";

    if (proof && !proofFirst.has(proof)) proofFirst.set(proof, r.id);
    if (!tripleFirst.has(triple)) tripleFirst.set(triple, r.id);

    const countsAsPayment = status === "DAPAT_DIKREDITKAN" || status === "BUKAN_KREDIT_PAJAK_FINAL" || status === "PERLU_VERIFIKASI_KHUSUS" || status === "SUDAH_DIKLAIM";
    if (countsAsPayment) paid = add(paid, r.amount);
    if (status === "DAPAT_DIKREDITKAN") credit = add(credit, r.amount);
    if (status !== "DAPAT_DIKREDITKAN" && status !== "BUKAN_KREDIT_PAJAK_FINAL") flagged += 1;
    findings.push({ id: r.id, kind: r.kind, amount: r.amount, status, note: NOTE[status] });
  }
  return { findings, paidVerified: paid, creditableVerified: credit, flagged };
}

/**
 * Marks credits as used by one claim. Refuses if any is already used by another claim, flagged, or
 * unknown, so a credit can never be claimed twice. Returns new records; the input is not changed.
 */
export function claimCredits(
  records: readonly TaxCreditRecord[],
  ids: readonly string[],
  claimId: string,
  taxYear: string,
  currency: string,
): { ok: true; records: TaxCreditRecord[] } | { ok: false; reason: string } {
  const review = reviewCredits(records, taxYear, claimId, currency);
  const status = new Map(review.findings.map((f) => [f.id, f.status] as const));
  for (const id of ids) {
    const s = status.get(id);
    if (!s) return { ok: false, reason: `Kredit ${id} tidak ditemukan.` };
    if (s !== "DAPAT_DIKREDITKAN") return { ok: false, reason: `Kredit ${id} tidak dapat diklaim: ${NOTE[s]}` };
  }
  const pick = new Set(ids);
  return { ok: true, records: records.map((r) => (pick.has(r.id) ? { ...r, claimedIn: claimId } : r)) };
}
