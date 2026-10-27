import { money, zero } from "@/lib/finance/money";
import type { OperatingExpense } from "@/lib/finance/types";
import { legalParametersFor, type ExpenseFiscalReview, type OptimizationInput, type TaxCreditRecord, type TaxNotice } from "@/lib/tax-opt";
import { buildDemoAccounting, buildDemoFiscal, DEMO_YEAR } from "./demo-accounting";

const idr = (v: string) => money(v, "IDR");

export type DemoScenario = "nyata" | "contoh";

/** Only these two values are accepted from the URL; anything else is the real demo state. */
export function parseScenario(raw: string | string[] | undefined): DemoScenario {
  return raw === "contoh" ? "contoh" : "nyata";
}

const EXPENSES: OperatingExpense[] = [
  { id: "DEMO-E1", date: "2026-03-05", category: "Hosting", vendor: "Vendor Hosting (fiktif)", amount: idr("12000000"), taxAmount: zero("IDR"), receiptRef: "DEMO-INV-001", isVoid: false },
  { id: "DEMO-E2", date: "2026-04-10", category: "API AI", vendor: "Penyedia API (fiktif)", amount: idr("30000000"), taxAmount: zero("IDR"), receiptRef: "DEMO-INV-002", isVoid: false },
  { id: "DEMO-E3", date: "2026-05-02", category: "Iklan", vendor: "Platform Iklan (fiktif)", amount: idr("8000000"), taxAmount: zero("IDR"), receiptRef: "", isVoid: false },
  { id: "DEMO-E4", date: "2026-06-15", category: "Lain-lain", vendor: "Jamuan (fiktif)", amount: idr("2000000"), taxAmount: zero("IDR"), receiptRef: "DEMO-INV-004", isVoid: false },
];

const V = { verifiedBy: "Akuntan Demo (fiktif)", verifiedAt: "2026-12-01T00:00:00Z" };
const REVIEWS: ExpenseFiscalReview[] = [
  { expenseId: "DEMO-E1", businessPurpose: "Menjalankan layanan LINOE", accountingAccount: "6101", treatment: "DAPAT_DIKURANGKAN", legalBasis: null, ...V },
  { expenseId: "DEMO-E2", businessPurpose: "Biaya produksi layanan", accountingAccount: "5101", treatment: "DAPAT_DIKURANGKAN", legalBasis: null, ...V },
  { expenseId: "DEMO-E4", businessPurpose: "Jamuan tanpa daftar nominatif", accountingAccount: "6199", treatment: "TIDAK_DAPAT_DIKURANGKAN", legalBasis: "Contoh dasar (fiktif): konfirmasi akuntan", ...V },
];

const CREDITS: TaxCreditRecord[] = [
  { id: "DEMO-C1", kind: "PPH23", taxYear: DEMO_YEAR, date: "2026-05-10", amount: idr("1500000"), evidenceRef: "DEMO-BP-001", counterparty: "Klien Demo (fiktif)", claimedIn: null, ...V },
  { id: "DEMO-C2", kind: "PPH23", taxYear: DEMO_YEAR, date: "2026-05-10", amount: idr("1500000"), evidenceRef: "DEMO-BP-002", counterparty: "Klien Demo (fiktif)", claimedIn: null, ...V },
  { id: "DEMO-C3", kind: "PPH_FINAL", taxYear: DEMO_YEAR, date: "2026-06-10", amount: idr("500000"), evidenceRef: "DEMO-NTPN-003", counterparty: null, claimedIn: null, ...V },
];

const NOTICES: TaxNotice[] = [
  {
    id: "DEMO-N1", type: "STP", number: "DEMO-STP-001", taxType: "PPh Pasal 25", period: "2026-05", issuedOn: "2026-09-01", sentOn: "2026-09-03",
    assessed: idr("750000"), ourComputation: null, sanctionAmount: idr("150000"), legalBasisOnNotice: null, evidence: [],
  },
];

/**
 * "nyata": the real demo state from Phase C: the entity view is INCOMPLETE, so most figures are
 * BELUM DAPAT DIHITUNG. "contoh": a clearly fictional, fully-supplied scenario to show what a
 * complete result looks like. It is never presented as the company's data.
 */
export function buildDemoOptimization(scenario: DemoScenario): OptimizationInput {
  const demo = buildDemoAccounting();
  const fiscal = buildDemoFiscal(demo.ledger);
  const base = {
    currency: "IDR", taxYear: DEMO_YEAR, expenses: EXPENSES, expenseReviews: REVIEWS, credits: CREDITS,
    fakturs: [], notices: NOTICES, demo: true as const,
  };
  if (scenario === "contoh") {
    const v = { verifiedBy: "Akuntan Contoh (fiktif)", verifiedAt: "2026-12-01T00:00:00Z" };
    return {
      ...base,
      schemeInput: {
        taxYear: DEMO_YEAR,
        profile: { legalForm: "PT", registeredOn: "2024-02-01", isPublicListed: false, hasOtherIncomeTaxFacility: false, isPermanentEstablishment: false, electedNormalRate: false, providesFreeProfessionServices: false, ...v },
        turnover: { amount: idr("1000000000"), complete: true, ...v },
        taxableIncome: idr("200000000"),
        taxableIncomeVerified: true,
        legal: legalParametersFor(DEMO_YEAR, v),
      },
      profitBeforeAdjustments: idr("200000000"),
      pkpVerified: false,
      pendingAdjustments: 0,
      entityComplete: true,
    };
  }
  return {
    ...base,
    schemeInput: {
      taxYear: DEMO_YEAR,
      profile: null,
      turnover: { amount: null, complete: false, verifiedBy: null, verifiedAt: null },
      taxableIncome: null,
      taxableIncomeVerified: false,
      legal: legalParametersFor(DEMO_YEAR),
    },
    profitBeforeAdjustments: null,
    pkpVerified: false,
    pendingAdjustments: fiscal.pendingAdjustments.length,
    entityComplete: fiscal.entity.status === "COMPLETE",
  };
}
