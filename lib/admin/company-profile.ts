import { money, zero, type Money } from "@/lib/finance/money";
import type { EntityProfile, TurnoverInput } from "@/lib/tax-opt";
import type { OperatingExpense } from "@/lib/finance/types";

/**
 * PT Tanyopo Future Technology as the Founder stated it. EVERY fact here is waiting for document
 * verification (akta, SK Kemenkumham, bukti NPWP, rekening koran). Nothing is verified, so the tax engine
 * returns BELUM DAPAT DIHITUNG for anything that depends on it.
 *
 * This is configuration only: it is not read from or written to any database, creates no journal and posts
 * no transaction. It holds no NPWP number, no address and no personal identity data.
 */
export const COMPANY_STATUS = "MENUNGGU_VERIFIKASI_DOKUMEN" as const;
export const COMPANY_AS_OF = "2026-10-27";

export interface CompanyPending {
  readonly name: string;
  readonly legalForm: "PT_PERORANGAN";
  /** Year of establishment as stated. The exact akta date is NOT known and is never inferred from the NPWP date. */
  readonly foundedYear: string;
  /** Date registered as taxpayer (NPWP). A different fact from the establishment date. */
  readonly npwpRegisteredOn: string;
  readonly pkpStatus: "NON_PKP";
  readonly status: typeof COMPANY_STATUS;
  readonly documentsNeeded: readonly string[];
}

export const COMPANY: CompanyPending = {
  name: "PT Tanyopo Future Technology",
  legalForm: "PT_PERORANGAN",
  foundedYear: "2026",
  npwpRegisteredOn: "2026-09-17",
  pkpStatus: "NON_PKP",
  status: COMPANY_STATUS,
  documentsNeeded: [
    "Akta pendirian dan pengesahan (tanggal pendirian, pemilik tunggal, anggaran dasar)",
    "Bukti pendaftaran NPWP badan (hanya tanggal yang dicatat, bukan nomor)",
    "Bukti status Non-PKP",
    "Rekening koran dan buku besar sampai 27 Oktober 2026 untuk memastikan peredaran bruto Rp0 dari seluruh kegiatan PT",
    "Daftar usaha lain pemilik dan perseroan perorangan lainnya (untuk batas gabungan Rp4,8 miliar)",
    "Bukti dan klasifikasi pengeluaran awal yang ditalangi Founder",
  ],
};

/** Gross turnover stated by the Founder through 27 Oct 2026. Not verified, so not "complete". */
export function pendingTurnover(): TurnoverInput {
  return { amount: money("0", "IDR"), complete: false, verifiedBy: null, verifiedAt: null };
}

/** Facts about the entity that the engine needs but nobody has confirmed are left null (unknown), never guessed. */
export function pendingProfile(): EntityProfile {
  return {
    legalForm: COMPANY.legalForm,
    registeredOn: COMPANY.npwpRegisteredOn,
    isPublicListed: null,
    hasOtherIncomeTaxFacility: null,
    isPermanentEstablishment: null,
    electedNormalRate: null,
    providesFreeProfessionServices: null,
    verifiedBy: null,
    verifiedAt: null,
  };
}

/**
 * Initial recap of money the Founder spent personally for the company (Rp4.279.425). It is a first tally, not a final
 * figure, and it is NOT assumed to be a deductible company cost: it may be capital contributed, a shareholder loan,
 * a pre-operating cost or a purely personal spend. Classification needs documents and an accountant.
 */
export const FOUNDER_SPEND_RECAP: Money = money("4279425", "IDR");
export const FOUNDER_SPEND_STATUS = "REKAP_AWAL_BELUM_DIKLASIFIKASI" as const;

export function founderSpendRecord(): OperatingExpense {
  return {
    id: "REKAP-AWAL-FOUNDER",
    date: COMPANY_AS_OF,
    category: "Pengeluaran Founder (rekap awal)",
    vendor: null,
    amount: FOUNDER_SPEND_RECAP,
    taxAmount: zero("IDR"),
    receiptRef: "",
    isVoid: false,
  };
}
