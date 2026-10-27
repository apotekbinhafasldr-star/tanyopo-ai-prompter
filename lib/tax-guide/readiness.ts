import type { ReturnKind } from "./sources";

/**
 * Is the data ready to report? Pure. The answer is "BELUM SIAP LAPOR" unless every blocker is gone.
 * Fail closed: anything unknown counts as not ready. Being ready never means "filed": reporting is a
 * human act in Coretax and only the official proof (Bukti Penerimaan Elektronik) shows it happened.
 */
export interface ReadinessInput {
  readonly kind: Exclude<ReturnKind, "LAINNYA">;
  readonly demo: boolean;
  /** Cross-checks from the dashboard model (balance sheet balances, cash flow ties, ...). */
  readonly checks: readonly { readonly label: string; readonly ok: boolean }[];
  readonly bankFinal: boolean;
  /** The whole-PT books were supplied and verified (not just the LINOE segment). */
  readonly entityComplete: boolean;
  /** An accountant/officer approved the statements. No mechanism exists yet, so this is false. */
  readonly statementsApproved: boolean;
  readonly taxRateVerified: boolean;
  readonly pendingAdjustments: number;
  readonly pkpVerified: boolean;
  /** Faktur Pajak data is held by LINOE. It is not (yet). */
  readonly invoiceDataAvailable: boolean;
}

export interface Blocker {
  readonly code: string;
  readonly text: string;
  /** Step ids where the reader should look. */
  readonly stepIds: readonly string[];
}

export interface Readiness {
  readonly status: "SIAP_LAPOR" | "BELUM_SIAP_LAPOR";
  readonly label: "SIAP LAPOR" | "BELUM SIAP LAPOR";
  readonly blockers: readonly Blocker[];
  readonly note: string;
}

export function assessReadiness(i: ReadinessInput): Readiness {
  const b: Blocker[] = [];
  if (i.demo) b.push({ code: "DEMO_DATA", text: "Data masih DEMO (contoh fiktif), bukan pembukuan nyata.", stepIds: ["pembukuan"] });
  if (!i.pkpVerified && i.kind === "PPN") b.push({ code: "PKP_NOT_VERIFIED", text: "Status PKP belum diverifikasi. SPT Masa PPN tidak diasumsikan berlaku.", stepIds: ["identitas"] });
  if (!i.entityComplete) b.push({ code: "ENTITY_INCOMPLETE", text: "Aktivitas PT selain LINOE belum dimasukkan dan diverifikasi. Data LINOE hanya satu segmen.", stepIds: ["pembukuan"] });
  for (const c of i.checks) if (!c.ok) b.push({ code: "CHECK_FAILED", text: `Pemeriksaan belum lulus: ${c.label}.`, stepIds: ["pembukuan"] });
  if (!i.bankFinal) b.push({ code: "BANK_NOT_FINAL", text: "Rekonsiliasi bank belum selisih nol dan disahkan.", stepIds: ["pembukuan"] });
  if (i.kind === "PPH_BADAN") {
    if (!i.statementsApproved) b.push({ code: "STATEMENTS_DRAFT", text: "Laba rugi dan neraca masih draf; belum disahkan pengurus atau akuntan.", stepIds: ["laporan"] });
    if (i.pendingAdjustments > 0) b.push({ code: "ADJ_PENDING", text: `${i.pendingAdjustments} koreksi fiskal belum diverifikasi akuntan.`, stepIds: ["fiskal"] });
    if (!i.taxRateVerified) b.push({ code: "RATE_NOT_VERIFIED", text: "Tarif pajak badan belum dikonfigurasi dan diverifikasi akuntan.", stepIds: ["hitung"] });
  } else if (!i.invoiceDataAvailable) {
    b.push({ code: "INVOICE_DATA_MISSING", text: "Data Faktur Pajak belum ada di LINOE; pencocokan dilakukan manual di Coretax.", stepIds: ["faktur"] });
  }
  const ready = b.length === 0;
  return {
    status: ready ? "SIAP_LAPOR" : "BELUM_SIAP_LAPOR",
    label: ready ? "SIAP LAPOR" : "BELUM SIAP LAPOR",
    blockers: b,
    note: ready
      ? "Data pendukung lengkap. Pelaporan tetap dilakukan manusia di Coretax; bukti resminya Bukti Penerimaan Elektronik."
      : "Selesaikan hal di atas dulu. Anda tetap boleh membaca panduan dan menyiapkan paket sebagai draf.",
  };
}

/** Completion needs both official proofs to have been looked at. Local note only, never proof. */
export function canMarkDone(proof: { readonly statusDilaporkan: boolean; readonly bpeChecked: boolean }): boolean {
  return proof.statusDilaporkan === true && proof.bpeChecked === true;
}

/** Other periodic obligations are listed only when a human verified them. None exist yet. */
export interface VerifiedObligation {
  readonly name: string;
  readonly verifiedBy: string;
  readonly verifiedAt: string;
}
export function usableObligations(list: readonly (Partial<VerifiedObligation> & { name: string })[]): VerifiedObligation[] {
  return list.filter((o): o is VerifiedObligation => Boolean(o.verifiedBy?.trim() && o.verifiedAt?.trim()));
}

export function parseReturnKind(raw: string | string[] | undefined): ReturnKind | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "pph-badan") return "PPH_BADAN";
  if (v === "ppn") return "PPN";
  if (v === "lainnya") return "LAINNYA";
  return null;
}
export const kindSlug = (k: ReturnKind): string => (k === "PPH_BADAN" ? "pph-badan" : k === "PPN" ? "ppn" : "lainnya");
export function parseGuideYear(raw: string | string[] | undefined, allowed: readonly string[]): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && allowed.includes(v) ? v : allowed[allowed.length - 1];
}

/** ?langkah=N : only a plain 1-2 digit number is accepted; anything else is ignored. */
export function parseStepParam(raw: string | string[] | undefined): number | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || !/^\d{1,2}$/.test(v)) return undefined;
  const n = Number(v);
  return n >= 1 ? n : undefined;
}
