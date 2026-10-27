import { can, type AdminPrincipal } from "@/lib/admin/permissions";
import { validateSchemeSelection, type SchemeId } from "./schemes";
import type { FigureState } from "./figure";

/**
 * Founder approval of a final recommendation.
 *
 * Everything here is a RULE CHECK that runs on the server before the database call; the database
 * (migration 20261027130000) enforces the same rules again, so a bug here cannot write a bad row.
 * The decider is ALWAYS taken from the server session, never from the request. A decision is an
 * internal record: it does not verify any figure, does not replace accountant verification and
 * does not make a return ready to file.
 */
export type RecommendationType = "SCHEME_SELECTION" | "COST_TREATMENT" | "CREDIT_CLAIM" | "NOTICE_RESPONSE";
export type DecisionKind = "APPROVED" | "REJECTED" | "REVOKED";

export interface DecisionRequest {
  readonly requestId: string;
  readonly recommendationType: RecommendationType;
  readonly taxYear: string;
  /** Scheme ids for SCHEME_SELECTION, or other short ids for the other types. */
  readonly items: readonly string[];
  readonly decision: DecisionKind;
  readonly reason: string;
  /** What the Founder saw on screen. */
  readonly viewed: { readonly calcHash: string; readonly rulesVersion: string };
  /** Recomputed on the server just now. */
  readonly current: { readonly calcHash: string; readonly rulesVersion: string; readonly figureStates: readonly FigureState[]; readonly openItems: number };
  readonly evidenceRefs: readonly string[];
  readonly accountantVerificationRef: string | null;
  /** Number of events already recorded for this subject when the Founder looked. */
  readonly expectedSeq: number;
}

export interface RpcArgs {
  readonly p_actor: string;
  readonly p_request_id: string;
  readonly p_subject_key: string;
  readonly p_recommendation_type: RecommendationType;
  readonly p_tax_year: string;
  readonly p_decision: DecisionKind;
  readonly p_reason: string;
  readonly p_rules_version: string;
  readonly p_viewed_rules_version: string;
  readonly p_calc_hash: string;
  readonly p_viewed_calc_hash: string;
  readonly p_figure_states: readonly FigureState[];
  readonly p_open_items: number;
  readonly p_evidence_refs: readonly string[];
  readonly p_accountant_ref: string | null;
  readonly p_expected_seq: number;
}

export type DecisionCode = "FORBIDDEN" | "INVALID" | "STALE" | "NOT_VERIFIED" | "CONFLICT" | "UNAVAILABLE" | "DEMO";
export type Prepared = { readonly ok: true; readonly rpc: RpcArgs } | { readonly ok: false; readonly code: DecisionCode; readonly message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const REF = /^[A-Za-z0-9._:/#-]{3,120}$/;
const ITEM = /^[A-Z0-9_]{1,40}$/;

/** Evidence references are short ids, never links or paths. */
export function validEvidenceRef(r: string): boolean {
  return REF.test(r) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(r) && !r.startsWith("/") && !r.includes("..");
}

export const subjectKey = (type: RecommendationType, taxYear: string, items: readonly string[]): string =>
  `${type}:${taxYear}:${[...items].sort().join(",")}`;

const no = (code: DecisionCode, message: string): Prepared => ({ ok: false, code, message });

export function prepareDecision(principal: AdminPrincipal | null, req: DecisionRequest): Prepared {
  if (!principal || !can(principal, "tax.optimization.approve")) return no("FORBIDDEN", "Hanya Founder (Super Admin yang sah) yang dapat memutuskan rekomendasi final.");
  if (!UUID.test(req.requestId)) return no("INVALID", "ID permintaan tidak valid.");
  if (!/^\d{4}$/.test(req.taxYear)) return no("INVALID", "Tahun pajak tidak valid.");
  if (req.items.length === 0 || req.items.some((i) => !ITEM.test(i))) return no("INVALID", "Daftar item rekomendasi kosong atau tidak valid.");
  if (req.recommendationType === "SCHEME_SELECTION") {
    const sel = validateSchemeSelection(req.items as readonly SchemeId[]);
    if (!sel.ok) return no("INVALID", sel.reason);
  }
  const reason = req.reason.trim();
  if (reason.length < 10 || reason.length > 2000) return no("INVALID", "Alasan wajib diisi (10 sampai 2000 karakter).");
  if (!HASH.test(req.viewed.calcHash) || !HASH.test(req.current.calcHash)) return no("INVALID", "Hash perhitungan tidak valid.");
  if (req.viewed.calcHash !== req.current.calcHash) return no("STALE", "Perhitungan berubah sejak ditinjau. Tinjau ulang sebelum memutuskan.");
  if (req.viewed.rulesVersion !== req.current.rulesVersion) return no("STALE", "Versi aturan berubah sejak ditinjau. Tinjau ulang sebelum memutuskan.");
  if (!Number.isInteger(req.expectedSeq) || req.expectedSeq < 0) return no("INVALID", "Urutan keputusan tidak valid.");
  if (req.evidenceRefs.length > 50 || req.evidenceRefs.some((r) => !validEvidenceRef(r))) return no("INVALID", "Referensi bukti harus berupa kode pendek, bukan tautan atau jalur berkas.");
  if (req.accountantVerificationRef !== null && !/^.{3,200}$/.test(req.accountantVerificationRef)) return no("INVALID", "Referensi verifikasi akuntan tidak valid.");
  if (req.decision === "APPROVED") {
    if (req.current.figureStates.length === 0 || req.current.figureStates.some((s) => s !== "TERVERIFIKASI") || req.current.openItems > 0) {
      return no("NOT_VERIFIED", "Persetujuan hanya untuk angka TERVERIFIKASI tanpa butir terbuka. Simulasi, data belum lengkap, dan perkara hukum belum dapat disetujui.");
    }
  }
  return {
    ok: true,
    rpc: {
      p_actor: principal.userId,
      p_request_id: req.requestId.toLowerCase(),
      p_subject_key: subjectKey(req.recommendationType, req.taxYear, req.items),
      p_recommendation_type: req.recommendationType,
      p_tax_year: req.taxYear,
      p_decision: req.decision,
      p_reason: reason,
      p_rules_version: req.current.rulesVersion,
      p_viewed_rules_version: req.viewed.rulesVersion,
      p_calc_hash: req.current.calcHash,
      p_viewed_calc_hash: req.viewed.calcHash,
      p_figure_states: req.current.figureStates,
      p_open_items: req.current.openItems,
      p_evidence_refs: req.evidenceRefs,
      p_accountant_ref: req.accountantVerificationRef,
      p_expected_seq: req.expectedSeq,
    },
  };
}

/** What the storage layer may answer. UNAVAILABLE covers a missing table, missing key, or any error: fail closed. */
export type StoreResult = { readonly ok: true; readonly id: string } | { readonly ok: false; readonly code: "FORBIDDEN" | "CONFLICT" | "STALE" | "INVALID" | "UNAVAILABLE" };
export interface DecisionStore {
  record(args: RpcArgs): Promise<StoreResult>;
}

const STORE_MESSAGE: Record<string, string> = {
  FORBIDDEN: "Hanya Super Admin yang sah yang dapat mencatat keputusan.",
  CONFLICT: "Keputusan lain sudah tercatat lebih dulu atau perhitungan ini sudah disetujui. Muat ulang dan tinjau.",
  STALE: "Perhitungan atau versi aturan berubah sejak ditinjau. Tinjau ulang.",
  INVALID: "Data keputusan ditolak penyimpanan.",
  UNAVAILABLE: "Penyimpanan persetujuan belum tersedia. Tidak ada yang disimpan.",
};

export async function decide(principal: AdminPrincipal | null, req: DecisionRequest, store: DecisionStore): Promise<{ ok: true; id: string } | { ok: false; code: DecisionCode; message: string }> {
  const prepared = prepareDecision(principal, req);
  if (!prepared.ok) return prepared;
  let res: StoreResult;
  try {
    res = await store.record(prepared.rpc);
  } catch {
    res = { ok: false, code: "UNAVAILABLE" };
  }
  if (res.ok) return res;
  return { ok: false, code: res.code, message: STORE_MESSAGE[res.code] };
}
