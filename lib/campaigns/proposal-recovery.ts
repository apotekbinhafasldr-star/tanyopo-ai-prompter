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

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isAbsent = (v: unknown) => v === null || v === undefined;
/** Fields the page prints as text: a present value that is an object or array would crash React (a number or boolean only prints oddly, and copy of the wrong type is caught as INCOMPLETE below). */
const TEXT_FIELDS = ["hook", "headline", "primary_text", "cta", "customer_pain", "desired_outcome", "value_proposition", "positioning", "audience_summary", "marketing_angle", "creative_concept"] as const;
const isUnrenderable = (v: unknown) => typeof v === "object" && v !== null;
const CANDIDATE_TEXT = ["hook", "headline", "cta", "primary_text", "rationale"] as const;

/** True when a nested part of an otherwise-object proposal has a shape the page would crash on. */
function hasMalformedNesting(record: Record<string, unknown>): boolean {
  if (TEXT_FIELDS.some((k) => isUnrenderable(record[k]))) return true;
  const { candidates, budget_allocation: allocation, excluded_channels: excluded } = record;
  if (!isAbsent(candidates)) {
    if (!Array.isArray(candidates)) return true;
    if (candidates.some((c) => !isPlainObject(c) || CANDIDATE_TEXT.some((k) => isUnrenderable(c[k])))) return true;
  }
  if (!isAbsent(allocation)) {
    if (!Array.isArray(allocation)) return true;
    if (allocation.some((b) => !isPlainObject(b) || typeof b.channel !== "string" || typeof b.percentage !== "number")) return true;
  }
  if (!isAbsent(excluded)) {
    if (!Array.isArray(excluded)) return true;
    if (excluded.some((e) => !isPlainObject(e) || typeof e.channel !== "string")) return true;
  }
  return false;
}

export function classifyStoredProposal(raw: unknown): StoredProposalShape {
  if (raw === null || raw === undefined) return "MISSING";
  if (!isPlainObject(raw)) return "MALFORMED";
  const record = raw;
  if (hasMalformedNesting(record)) return "MALFORMED";
  const complete = REQUIRED_COPY.every((key) => typeof record[key] === "string" && (record[key] as string).trim().length > 0);
  return complete ? "OK" : "INCOMPLETE";
}

export type RecoveryAccess = { allowed: true } | { allowed: false; reason: string };

/**
 * COPY of CAMPAIGN_EDIT_ROLES from the server (lib/campaigns/campaign-roles.ts, PR #195). Deliberately NOT imported so
 * this PR does not depend on #195; tests/unit/features/proposal-recovery-card.test.tsx pins the literal list, and the
 * same literal is pinned in #195, so a change on one side without the other fails CI there.
 */
export const RECOVERY_EDIT_ROLES = ["owner", "marketing"] as const;

export function proposalRecoveryAccess(role: string | null | undefined, status: string): RecoveryAccess {
  if (typeof role !== "string" || !(RECOVERY_EDIT_ROLES as readonly string[]).includes(role)) {
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
