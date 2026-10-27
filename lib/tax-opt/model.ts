import { formatRupiah } from "@/lib/admin/format";
import type { Money } from "@/lib/finance/money";
import { STATE_LABEL, type Figure, type FigureState } from "./figure";
import { lawById } from "./law";
import { evaluateSchemes, type SchemeEvaluation, type SchemeInput } from "./schemes";
import { reviewExpenses, MISSING_LABEL, type ExpenseFiscalReview, type ExpenseReview } from "./expenses";
import { reviewCredits, type CreditReview, type TaxCreditRecord } from "./credits";
import { reviewPpn, type FakturRecord, type PpnReview } from "./ppn";
import { checkNotice, type NoticeCheck, type TaxNotice } from "./notices";
import { simulate, type Simulation } from "./simulation";
import type { OperatingExpense } from "@/lib/finance/types";

export interface FigureView {
  readonly state: FigureState;
  readonly stateLabel: string;
  /** Rupiah text, or null when the engine refuses to give a number. */
  readonly text: string | null;
  readonly reasons: readonly string[];
  readonly assumptions: readonly string[];
  readonly sources: readonly { readonly id: string; readonly label: string }[];
}

export function figureView(f: Figure): FigureView {
  return {
    state: f.state,
    stateLabel: STATE_LABEL[f.state],
    text: f.amount ? formatRupiah(f.amount) : null,
    reasons: f.reasons,
    assumptions: f.assumptions,
    sources: f.sourceIds.map((id) => {
      const s = lawById(id);
      return { id, label: s ? `${s.regulation} — ${s.articles}` : id };
    }),
  };
}

export interface OptimizationInput {
  readonly currency: string;
  readonly taxYear: string;
  readonly schemeInput: SchemeInput;
  /** Entity-level profit used as the "before adjustments" base; null = unknown. */
  readonly profitBeforeAdjustments: Money | null;
  readonly expenses: readonly OperatingExpense[];
  readonly expenseReviews: readonly ExpenseFiscalReview[];
  readonly credits: readonly TaxCreditRecord[];
  readonly pkpVerified: boolean;
  readonly fakturs: readonly FakturRecord[];
  readonly notices: readonly TaxNotice[];
  /** Fiscal reconciliation facts from Phase C. */
  readonly pendingAdjustments: number;
  readonly entityComplete: boolean;
  readonly demo: boolean;
}

export interface OptimizationResult {
  readonly schemes: SchemeEvaluation;
  readonly expenses: ExpenseReview;
  readonly credits: CreditReview;
  readonly ppn: PpnReview;
  readonly notices: readonly NoticeCheck[];
  readonly simulation: Simulation;
  readonly findings: readonly { readonly level: "bad" | "warn" | "info"; readonly text: string }[];
  /** Items that stop the optimization result from being used in a filing. */
  readonly openItems: readonly string[];
  readonly readyToUse: boolean;
}

export function runOptimization(i: OptimizationInput): OptimizationResult {
  const schemes = evaluateSchemes(i.schemeInput);
  const expenses = reviewExpenses(i.expenses, i.expenseReviews, i.currency);
  const credits = reviewCredits(i.credits, i.taxYear, "SPT-TAHUNAN", i.currency);
  const ppn = reviewPpn({ pkpVerified: i.pkpVerified, fakturs: i.fakturs, currency: i.currency });
  const notices = i.notices.map((n) => checkNotice(n, i.currency));
  const inputsVerified = i.entityComplete && i.pendingAdjustments === 0 && i.schemeInput.taxableIncomeVerified;
  const simulation = simulate({
    currency: i.currency,
    legal: i.schemeInput.legal,
    profitBeforeAdjustments: i.profitBeforeAdjustments,
    inputsVerified,
    schemes,
    credits,
    creditRecordCount: i.credits.length,
  });

  const findings: { level: "bad" | "warn" | "info"; text: string }[] = [];
  const attention = expenses.findings.filter((f) => f.status === "PERLU_DILENGKAPI");
  for (const f of attention) findings.push({ level: "warn", text: `Biaya ${f.category} (${f.vendor}) belum lengkap: ${f.missing.map((m) => MISSING_LABEL[m]).join(", ")}.` });
  for (const f of expenses.findings.filter((x) => x.status === "DUGAAN_GANDA")) findings.push({ level: "bad", text: `Biaya ${f.category} (${f.vendor}) diduga ganda dengan ${f.duplicateOf ?? "catatan lain"}: tidak dihitung dua kali.` });
  for (const f of credits.findings.filter((x) => x.status !== "DAPAT_DIKREDITKAN")) findings.push({ level: f.status === "BUKAN_KREDIT_PAJAK_FINAL" ? "info" : "bad", text: `Kredit ${f.kind} ${f.id}: ${f.note}` });
  for (const c of notices) for (const w of c.warnings.slice(1)) findings.push({ level: "warn", text: w });
  if (i.pendingAdjustments > 0) findings.push({ level: "warn", text: `${i.pendingAdjustments} penyesuaian fiskal belum diverifikasi dan tidak dihitung.` });
  if (!i.entityComplete) findings.push({ level: "warn", text: "Aktivitas PT selain LINOE belum dimasukkan: omzet gabungan seluruh PT belum dapat dipastikan." });
  if (!ppn.active) findings.push({ level: "info", text: `PPN tidak aktif: ${ppn.reason}` });

  const open: string[] = [];
  if (i.demo) open.push("Masih data DEMO.");
  if (!i.entityComplete) open.push("Data seluruh PT belum lengkap.");
  if (i.pendingAdjustments > 0) open.push("Ada penyesuaian fiskal belum diverifikasi.");
  if (!i.schemeInput.legal) open.push(`Ketentuan tahun pajak ${i.taxYear} belum diverifikasi.`);
  else if (!i.schemeInput.legal.verifiedBy) open.push("Parameter hukum belum diverifikasi akuntan/konsultan pajak.");
  if (simulation.lines.some((l) => l.figure.state !== "TERVERIFIKASI")) open.push("Ada angka simulasi atau belum dapat dihitung.");
  if (attention.length > 0) open.push(`${attention.length} biaya belum lengkap.`);
  if (i.credits.length === 0) open.push("Belum ada catatan kredit pajak.");

  return { schemes, expenses, credits, ppn, notices, simulation, findings, openItems: Array.from(new Set(open)), readyToUse: open.length === 0 };
}
