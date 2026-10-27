import { add, isPositive, zero, type Money } from "@/lib/finance/money";
import type { OperatingExpense } from "@/lib/finance/types";
import type { FiscalAdjustment } from "@/lib/accounting/fiscal";

/**
 * Fiscal review of operating expenses. The review is a SEPARATE record about an expense: it never
 * edits the expense, the ledger, a date or an amount. An expense counts as deductible only when
 * every required fact is present AND a named person verified it.
 */
export type FiscalTreatment = "DAPAT_DIKURANGKAN" | "TIDAK_DAPAT_DIKURANGKAN" | "BELUM_DITENTUKAN";

export interface ExpenseFiscalReview {
  readonly expenseId: string;
  /** Why this cost belongs to earning, collecting or maintaining income (the "3M" principle). */
  readonly businessPurpose: string | null;
  /** Chart-of-accounts code the cost is booked to. */
  readonly accountingAccount: string | null;
  readonly treatment: FiscalTreatment;
  /** Required when the treatment is TIDAK_DAPAT_DIKURANGKAN: the legal reason (article). */
  readonly legalBasis: string | null;
  readonly verifiedBy: string | null;
  readonly verifiedAt: string | null;
}

export type ExpenseStatus =
  | "TERVERIFIKASI_DAPAT_DIKURANGKAN"
  | "TERVERIFIKASI_TIDAK_DAPAT_DIKURANGKAN"
  | "PERLU_DILENGKAPI"
  | "DUGAAN_GANDA"
  | "DIBATALKAN";

export type MissingFact = "BUKTI_TRANSAKSI" | "KAITAN_USAHA" | "KLASIFIKASI_AKUNTANSI" | "PERLAKUAN_FISKAL" | "DASAR_HUKUM" | "VERIFIKASI";

export const MISSING_LABEL: Record<MissingFact, string> = {
  BUKTI_TRANSAKSI: "bukti transaksi",
  KAITAN_USAHA: "kaitan dengan kegiatan usaha",
  KLASIFIKASI_AKUNTANSI: "klasifikasi akuntansi",
  PERLAKUAN_FISKAL: "perlakuan fiskal",
  DASAR_HUKUM: "dasar hukum nondeductible",
  VERIFIKASI: "verifikasi akuntan",
};

export interface ExpenseFinding {
  readonly expenseId: string;
  readonly date: string;
  readonly category: string;
  readonly vendor: string | null;
  readonly amount: Money;
  readonly status: ExpenseStatus;
  readonly missing: readonly MissingFact[];
  readonly duplicateOf: string | null;
  /** A hint only (never applied): how this kind of cost is usually looked at. */
  readonly hint: string;
}

export interface ExpenseReview {
  readonly findings: readonly ExpenseFinding[];
  /** Verified, complete, non-duplicate, deductible. */
  readonly deductibleVerified: Money;
  /** Verified nondeductible: becomes a positive fiscal correction. */
  readonly nonDeductibleVerified: Money;
  /** Amount still lacking something: at risk if examined. */
  readonly needsAttention: Money;
  readonly duplicateSuspect: Money;
  readonly counts: Readonly<Record<ExpenseStatus, number>>;
}

const HINTS: Record<string, string> = {
  hosting: "Biaya jasa/administrasi usaha (Pasal 6 ayat (1)); bila dibayar di muka untuk lebih dari 1 tahun, perlakuan amortisasi perlu dicek.",
  "api ai": "Biaya jasa untuk menghasilkan penghasilan (Pasal 6 ayat (1)); perlu bukti tagihan atas nama PT.",
  iklan: "Biaya promosi dan penjualan (Pasal 6 ayat (1)).",
  pemasaran: "Biaya promosi dan penjualan (Pasal 6 ayat (1)).",
  domain: "Biaya administrasi/jasa; perangkat lunak berumur manfaat lebih dari 1 tahun mungkin harus diamortisasi.",
  perangkat: "Perangkat lunak/berwujud berumur manfaat lebih dari 1 tahun: penyusutan atau amortisasi.",
  bank: "Biaya administrasi (Pasal 6 ayat (1)); bukti berupa rekening koran.",
  gaji: "Upah/gaji termasuk biaya pekerjaan (Pasal 6 ayat (1)); perlu bukti pemotongan PPh 21.",
  "lain-lain": "Tidak ada petunjuk: jelaskan kaitannya dengan usaha atau perlakukan sebagai belum diketahui.",
};

function hintFor(category: string): string {
  const k = category.trim().toLowerCase();
  for (const key of Object.keys(HINTS)) if (k.includes(key)) return HINTS[key];
  return "Belum ada petunjuk untuk kategori ini: tentukan kaitan usaha dan perlakuan fiskal bersama akuntan.";
}

const filled = (s: string | null | undefined): boolean => Boolean(s && s.trim().length > 0);

export function reviewExpenses(expenses: readonly OperatingExpense[], reviews: readonly ExpenseFiscalReview[], currency: string): ExpenseReview {
  const byId = new Map<string, ExpenseFiscalReview>();
  for (const r of reviews) {
    if (byId.has(r.expenseId)) throw new Error(`Duplicate fiscal review for expense ${r.expenseId}`);
    byId.set(r.expenseId, r);
  }
  // Suspected double entry: the same proof document, or the same vendor/date/amount, used twice.
  const firstByProof = new Map<string, string>();
  const firstByTriple = new Map<string, string>();
  const dupOf = new Map<string, string>();
  for (const e of expenses) {
    if (e.isVoid) continue;
    const proof = e.receiptRef?.trim().toLowerCase();
    const triple = `${(e.vendor ?? "").trim().toLowerCase()}|${e.date}|${e.amount.minor.toString()}`;
    const prior = (proof && firstByProof.get(proof)) || firstByTriple.get(triple);
    if (prior) dupOf.set(e.id, prior);
    if (proof && !firstByProof.has(proof)) firstByProof.set(proof, e.id);
    if (!firstByTriple.has(triple)) firstByTriple.set(triple, e.id);
  }

  const counts: Record<ExpenseStatus, number> = {
    TERVERIFIKASI_DAPAT_DIKURANGKAN: 0,
    TERVERIFIKASI_TIDAK_DAPAT_DIKURANGKAN: 0,
    PERLU_DILENGKAPI: 0,
    DUGAAN_GANDA: 0,
    DIBATALKAN: 0,
  };
  let ded = zero(currency);
  let non = zero(currency);
  let attention = zero(currency);
  let dup = zero(currency);
  const findings: ExpenseFinding[] = [];

  for (const e of expenses) {
    const base = { expenseId: e.id, date: e.date, category: e.category, vendor: e.vendor, amount: e.amount, hint: hintFor(e.category) };
    if (e.isVoid) {
      counts.DIBATALKAN += 1;
      findings.push({ ...base, status: "DIBATALKAN", missing: [], duplicateOf: null });
      continue;
    }
    const r = byId.get(e.id);
    const missing: MissingFact[] = [];
    if (!filled(e.receiptRef)) missing.push("BUKTI_TRANSAKSI");
    if (!r || !filled(r.businessPurpose)) missing.push("KAITAN_USAHA");
    if (!r || !filled(r.accountingAccount)) missing.push("KLASIFIKASI_AKUNTANSI");
    if (!r || r.treatment === "BELUM_DITENTUKAN") missing.push("PERLAKUAN_FISKAL");
    if (r && r.treatment === "TIDAK_DAPAT_DIKURANGKAN" && !filled(r.legalBasis)) missing.push("DASAR_HUKUM");
    if (!r || !filled(r.verifiedBy) || !filled(r.verifiedAt)) missing.push("VERIFIKASI");

    const dupe = dupOf.get(e.id);
    let status: ExpenseStatus;
    if (dupe) {
      status = "DUGAAN_GANDA";
      dup = add(dup, e.amount);
    } else if (missing.length > 0) {
      status = "PERLU_DILENGKAPI";
      attention = add(attention, e.amount);
    } else if (r && r.treatment === "DAPAT_DIKURANGKAN") {
      status = "TERVERIFIKASI_DAPAT_DIKURANGKAN";
      ded = add(ded, e.amount);
    } else {
      status = "TERVERIFIKASI_TIDAK_DAPAT_DIKURANGKAN";
      non = add(non, e.amount);
    }
    counts[status] += 1;
    findings.push({ ...base, status, missing, duplicateOf: dupe ?? null });
  }
  return { findings, deductibleVerified: ded, nonDeductibleVerified: non, needsAttention: attention, duplicateSuspect: dup, counts };
}

/**
 * Verified nondeductible costs become POSITIVE fiscal corrections in the fiscal reconciliation. They
 * are separate records with their own ids and evidence, so the ledger and the books stay exactly as
 * they were: tax is never reduced by editing the accounting.
 */
export function expenseAdjustments(expenses: readonly OperatingExpense[], reviews: readonly ExpenseFiscalReview[], currency: string): FiscalAdjustment[] {
  const review = reviewExpenses(expenses, reviews, currency);
  const byId = new Map(reviews.map((r) => [r.expenseId, r] as const));
  const out: FiscalAdjustment[] = [];
  for (const f of review.findings) {
    if (f.status !== "TERVERIFIKASI_TIDAK_DAPAT_DIKURANGKAN" || !isPositive(f.amount)) continue;
    const r = byId.get(f.expenseId) as ExpenseFiscalReview;
    const e = expenses.find((x) => x.id === f.expenseId) as OperatingExpense;
    out.push({
      id: `opt|expense|${f.expenseId}`,
      description: `Biaya nondeductible: ${f.category} (${f.vendor}) — ${r.legalBasis}`,
      direction: "POSITIVE",
      nature: "PERMANENT",
      amount: f.amount,
      evidenceRef: e.receiptRef,
      verifiedBy: r.verifiedBy,
      verifiedAt: r.verifiedAt,
    });
  }
  return out;
}
