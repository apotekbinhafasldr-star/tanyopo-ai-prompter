/**
 * Where a number or sentence on the campaign page comes from. Pure, no I/O.
 * Never labels something as platform data unless it was read from the platform.
 */
export type EvidenceKind = "AI" | "RULE" | "HEURISTIC" | "PLATFORM";

export const EVIDENCE_TEXT: Record<EvidenceKind, { label: string; hint: string }> = {
  AI: { label: "Usulan AI", hint: "Ditulis AI dan belum diverifikasi. Periksa sebelum dipakai." },
  RULE: { label: "Aturan deterministik", hint: "Dihitung dengan aturan tetap, bukan penilaian AI." },
  HEURISTIC: { label: "Perkiraan (heuristik)", hint: "Perkiraan LINOE, bukan data dari platform iklan." },
  PLATFORM: { label: "Data platform", hint: "Dibaca dari platform iklan yang terhubung." },
};

/** True when no rupiah budget is set, so percentages cannot be shown as money. */
export function isBudgetMissing(budget: { daily_budget: number | null; total_budget: number | null }): boolean {
  return budget.daily_budget === null && budget.total_budget === null;
}

export const BUDGET_MISSING_NOTE = "Budget belum diisi — angka ini proporsi (%), bukan nominal rupiah.";
