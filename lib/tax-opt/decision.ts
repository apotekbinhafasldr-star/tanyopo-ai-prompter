import { can, type AdminPrincipal } from "@/lib/admin/permissions";
import { validateSchemeSelection, type SchemeId } from "./schemes";
import type { FigureState } from "./figure";

/**
 * The Founder approves the FINAL recommendation. This is a pure rule check that returns the audit
 * event to be written; nothing is stored here (storage needs its own approved security design).
 * The engine itself never selects a scheme.
 */
export interface Recommendation {
  readonly id: string;
  readonly taxYear: string;
  readonly schemeIds: readonly SchemeId[];
  readonly rationale: string;
  readonly preparedBy: string;
  /** States of the figures the recommendation rests on. */
  readonly figureStates: readonly FigureState[];
}

export interface TaxOptimizationAuditEvent {
  readonly action: "TAX_OPTIMIZATION_APPROVED";
  readonly actorId: string;
  readonly at: string;
  readonly recommendationId: string;
  readonly taxYear: string;
  readonly schemeIds: readonly SchemeId[];
  readonly rationale: string;
  readonly note: "Persetujuan internal. Bukan pelaporan dan bukan bukti ke DJP.";
}

export type DecisionResult =
  | { readonly ok: true; readonly event: TaxOptimizationAuditEvent }
  | { readonly ok: false; readonly code: "FORBIDDEN" | "INVALID_SELECTION" | "NO_RATIONALE" | "NOT_VERIFIED"; readonly message: string };

export function approveRecommendation(principal: AdminPrincipal, rec: Recommendation, nowIso: string): DecisionResult {
  if (!can(principal, "tax.optimization.approve")) {
    return { ok: false, code: "FORBIDDEN", message: "Hanya Founder yang dapat menyetujui rekomendasi final." };
  }
  const sel = validateSchemeSelection(rec.schemeIds);
  if (!sel.ok) return { ok: false, code: "INVALID_SELECTION", message: sel.reason };
  if (!rec.rationale.trim()) return { ok: false, code: "NO_RATIONALE", message: "Alasan pemilihan wajib diisi." };
  if (rec.figureStates.length === 0 || rec.figureStates.some((s) => s !== "TERVERIFIKASI")) {
    return { ok: false, code: "NOT_VERIFIED", message: "Rekomendasi hanya dapat disetujui jika semua angka dasarnya TERVERIFIKASI. Simulasi, data belum lengkap, dan perkara hukum belum dapat disetujui." };
  }
  return {
    ok: true,
    event: {
      action: "TAX_OPTIMIZATION_APPROVED",
      actorId: principal.userId,
      at: nowIso,
      recommendationId: rec.id,
      taxYear: rec.taxYear,
      schemeIds: rec.schemeIds,
      rationale: rec.rationale.trim(),
      note: "Persetujuan internal. Bukan pelaporan dan bukan bukti ke DJP.",
    },
  };
}
