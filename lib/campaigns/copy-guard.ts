import { createHash } from "node:crypto";
import { evaluateCampaignQuality, formatBlockingIssuesMessage, scanRawProposalCopy } from "@/lib/ai/campaign-quality-gate";
import { CampaignProposalSchema, findActiveCopyProblems, findCopyLengthViolations } from "@/schemas/ai/campaign-proposal";

/**
 * ONE validator for the ad copy that is submitted for approval AND launched (FIX-195-LAUNCH-GUARD). Submit
 * (features/campaigns/actions.ts) and launch (features/campaigns/launch-actions.ts) both call
 * `evaluateCopyGuard`; there is no second copy of any rule, so the two can never decide differently.
 *
 * Levels:
 *  - FULL:    the proposal parses against the schema and the FULL Quality Gate (active copy) found nothing blocking.
 *  - REDUCED: the proposal does not parse (legacy shape), so the full gate did NOT run. Required copy, length limits
 *             and every blocking text rule on the active copy strings passed. This is NOT a Quality Gate pass.
 *  - REJECT:  refused; `message` is Indonesian and says how to recover.
 *
 * Pure apart from the injected `loadContext` (product name and facts, read-only), which is called only when the
 * FULL gate needs it.
 */

export type CopyGuardAction = "SUBMIT" | "LAUNCH";

export interface CopyGuardContext {
  productName: string | null;
  knownFacts: string | null;
}

export type CopyGuardResult =
  | { ok: true; level: "FULL" | "REDUCED"; message: null }
  | { ok: false; level: "REJECT"; reason: "INCOMPLETE" | "TOO_LONG" | "BLOCKED" | "CONTEXT_UNREADABLE"; message: string };

const RECOVERY = 'Lengkapi lewat editor di bagian Konten Iklan atau buat ulang strategi dengan tombol "Buat Ulang dengan AI"';

function reject(reason: "INCOMPLETE" | "TOO_LONG" | "BLOCKED" | "CONTEXT_UNREADABLE", message: string): CopyGuardResult {
  return { ok: false, level: "REJECT", reason, message };
}

export async function evaluateCopyGuard(
  rawProposal: unknown,
  options: { action: CopyGuardAction; loadContext: () => Promise<CopyGuardContext | null> },
): Promise<CopyGuardResult> {
  const launch = options.action === "LAUNCH";
  const lead = launch ? "Peluncuran dibatalkan" : "Campaign belum bisa diajukan";
  const tail = launch ? "Tidak ada yang dikirim ke platform." : "Tidak ada pengajuan yang dibuat.";
  const then = launch ? "lalu ajukan ulang untuk persetujuan" : "lalu ajukan lagi";

  const problems = findActiveCopyProblems(rawProposal);
  if (problems.length > 0) {
    return reject("INCOMPLETE", `${lead}: teks iklan belum lengkap (${problems.join("; ")}). ${RECOVERY}, ${then}. ${tail}`);
  }

  const parsed = CampaignProposalSchema.safeParse(rawProposal);
  if (parsed.success) {
    const context = await options.loadContext();
    if (!context) {
      return reject(
        "CONTEXT_UNREADABLE",
        launch
          ? "Gagal membaca data produk untuk pemeriksaan kualitas. Peluncuran dibatalkan, coba lagi."
          : "Gagal membaca data produk untuk pemeriksaan kualitas. Pengajuan tidak dibuat, coba lagi.",
      );
    }
    const blocking = formatBlockingIssuesMessage(
      evaluateCampaignQuality(parsed.data, { productName: context.productName, knownFacts: context.knownFacts, copyScope: "active" }),
    );
    return blocking ? reject("BLOCKED", launch ? `Peluncuran dibatalkan. ${blocking}` : blocking) : { ok: true, level: "FULL", message: null };
  }

  // Reduced check: the full gate does not run for a proposal the schema does not accept.
  const lengthViolations = findCopyLengthViolations(rawProposal);
  if (lengthViolations.length > 0) {
    return reject(
      "TOO_LONG",
      `${lead}: teks iklan melebihi batas panjang (${lengthViolations.join(", ")}). Persingkat teks lewat editor di bagian Konten Iklan atau buat ulang strategi dengan "Buat Ulang dengan AI", ${then}.`,
    );
  }
  const blocking = formatBlockingIssuesMessage({ issues: scanRawProposalCopy(rawProposal) });
  if (blocking) return reject("BLOCKED", launch ? `Peluncuran dibatalkan. ${blocking}` : blocking);
  return { ok: true, level: "REDUCED", message: null };
}

/** Shown when a launch is asked for a proposal that only passed the reduced check (full Quality Gate never ran). */
export const REDUCED_LAUNCH_MESSAGE =
  'Peluncuran dibatalkan: strategi campaign ini berformat lama, sehingga Quality Gate penuh tidak bisa dijalankan dan copy-nya tidak bisa dinyatakan lolos. Buat ulang strategi dengan tombol "Buat Ulang dengan AI", lalu ajukan ulang untuk persetujuan. Tidak ada yang dikirim ke platform.';

// ---------------------------------------------------------------------------
// Copy fingerprint: the copy the Owner approved is the copy that is launched.
// ---------------------------------------------------------------------------

export const COPY_SNAPSHOT_KEY = "copy_snapshot";

export interface CopySnapshot {
  version: 1;
  algorithm: "sha256";
  hash: string;
}

/** Exact strings (no trimming, no normalisation): any edit of headline, primary_text or cta changes the hash. */
export function copyFingerprint(rawProposal: unknown): string | null {
  if (rawProposal === null || typeof rawProposal !== "object" || Array.isArray(rawProposal)) return null;
  const p = rawProposal as Record<string, unknown>;
  const { headline, primary_text: primaryText, cta } = p;
  if (typeof headline !== "string" || typeof primaryText !== "string" || typeof cta !== "string") return null;
  return createHash("sha256").update(JSON.stringify([headline, primaryText, cta])).digest("hex");
}

export function buildCopySnapshot(rawProposal: unknown): CopySnapshot | null {
  const hash = copyFingerprint(rawProposal);
  return hash ? { version: 1, algorithm: "sha256", hash } : null;
}

export const COPY_CHANGED_MESSAGE =
  "Peluncuran dibatalkan: copy iklan berbeda dari yang disetujui Owner, atau persetujuan ini dibuat sebelum copy dicatat. Ajukan ulang campaign (Kembalikan ke Draft bila perlu) agar Owner menyetujui copy yang sekarang. Tidak ada yang dikirim ke platform.";

/** Compares the approval's recorded copy fingerprint with the proposal that would be launched. Missing = refused. */
export function checkApprovalCopySnapshot(approvalContext: unknown, rawProposal: unknown): { ok: true } | { ok: false; message: string } {
  const raw =
    approvalContext !== null && typeof approvalContext === "object" && !Array.isArray(approvalContext)
      ? (approvalContext as Record<string, unknown>)[COPY_SNAPSHOT_KEY]
      : undefined;
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, message: COPY_CHANGED_MESSAGE };
  const snap = raw as Record<string, unknown>;
  const current = copyFingerprint(rawProposal);
  if (snap.version !== 1 || snap.algorithm !== "sha256" || typeof snap.hash !== "string" || current === null || snap.hash !== current) {
    return { ok: false, message: COPY_CHANGED_MESSAGE };
  }
  return { ok: true };
}
