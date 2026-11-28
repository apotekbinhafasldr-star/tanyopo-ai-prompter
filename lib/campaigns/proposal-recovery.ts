/**
 * What the campaign page shows when the stored AI proposal cannot be used (null, not an object, or without the
 * copy the launch sends), and who may repair it. PURE: no I/O, no AI call, no clock.
 *
 * The guards mirror the actions that do the repair, read from their code:
 *  - regenerateCampaignProposalAction and updateCampaignCopyAction both require status DRAFT (and, for the write,
 *    RLS "Owner/marketing kelola campaign": role owner or marketing only).
 * Nothing here ever runs the AI: the repair is offered as a button the user must press.
 */

export type StoredProposalShape = "OK" | "MISSING" | "MALFORMED" | "INCOMPLETE";

const REQUIRED_COPY = ["headline", "primary_text", "cta"] as const;

export function classifyStoredProposal(raw: unknown): StoredProposalShape {
  if (raw === null || raw === undefined) return "MISSING";
  if (typeof raw !== "object" || Array.isArray(raw)) return "MALFORMED";
  const record = raw as Record<string, unknown>;
  const complete = REQUIRED_COPY.every((key) => typeof record[key] === "string" && (record[key] as string).trim().length > 0);
  return complete ? "OK" : "INCOMPLETE";
}

export type RecoveryAccess = { allowed: true } | { allowed: false; reason: string };

export function proposalRecoveryAccess(role: string | null | undefined, status: string): RecoveryAccess {
  if (role !== "owner" && role !== "marketing") {
    return { allowed: false, reason: "Hanya Owner atau Marketing yang bisa membuat ulang atau mengubah strategi. Minta Owner atau Marketing untuk memperbaikinya." };
  }
  if (status === "DRAFT") return { allowed: true };
  if (status === "AWAITING_APPROVAL") {
    return { allowed: false, reason: "Campaign sedang menunggu keputusan Owner, jadi strategi tidak bisa diubah. Batalkan pengajuan dulu, lalu perbaiki." };
  }
  if (status === "SCHEDULED") {
    return { allowed: false, reason: "Campaign sudah disetujui, jadi strategi tidak bisa diubah. Pilih Kembalikan ke Draft dulu, lalu perbaiki dan ajukan ulang." };
  }
  return { allowed: false, reason: "Strategi hanya bisa dibuat ulang selama campaign masih berstatus Draft." };
}
