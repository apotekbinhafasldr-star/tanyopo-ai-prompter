/**
 * Objective values the AI may RECOMMEND in a campaign proposal
 * (`objective_recommendation`). A recommendation is advice only: it never
 * changes the campaign's own `objective` and does not mean the objective can
 * be launched on Meta.
 *
 * Hard-coded on purpose (no import from lib/campaigns/meta-objective-contracts,
 * so the proposal schema and the prompt stay free of launch-side modules).
 * Reference: the keys of META_OBJECTIVE_CONTRACTS (supported) followed by the
 * keys of META_UNSUPPORTED_OBJECTIVES. tests/unit/schemas/campaign-proposal-additions.test.ts
 * fails when the two drift apart, so update both together.
 */
export const PROPOSAL_OBJECTIVE_VALUES = [
  "BRAND_AWARENESS",
  "WEBSITE_TRAFFIC",
  "INCREASE_SALES",
  "GET_LEADS",
  "INCREASE_FOLLOWERS",
  "PROMOTE_APP",
] as const;

export type ProposalObjectiveValue = (typeof PROPOSAL_OBJECTIVE_VALUES)[number];
