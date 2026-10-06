/**
 * Phase-1 gate for the simplified Quick Promote review (PR-A).
 *
 * The simplified "Rencana Promosi Anda Siap" view applies ONLY when the
 * campaign is still a DRAFT *and* the user just arrived from Quick Promote
 * (`?from=quick-promote`). Every other case — AWAITING_APPROVAL, SCHEDULED,
 * ACTIVE, a DRAFT opened from the campaign list, or one from Advanced mode —
 * keeps the full existing page unchanged.
 *
 * A campaign with no AI proposal has nothing to summarise, so it also falls
 * back to the full page (which already explains "Belum ada proposal AI").
 */
export function isQuickReview(
  from: string | undefined,
  status: string,
  hasProposal: boolean,
): boolean {
  return status === "DRAFT" && from === "quick-promote" && hasProposal;
}
