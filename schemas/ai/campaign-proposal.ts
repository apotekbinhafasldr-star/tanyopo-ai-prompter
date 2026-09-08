import { z } from "zod";

const channelEnum = z.enum(["FACEBOOK", "INSTAGRAM", "TIKTOK", "X", "SEO"]);

/**
 * One ranked hook/headline/CTA direction (Batch B1 — persuasive
 * intelligence). candidates[0] is always the recommended pick — enforced
 * deterministically in code via withPrimaryCandidate() below, never left
 * to the model to keep in sync with the top-level hook/headline/cta
 * fields on CampaignProposalSchema.
 */
export const CreativeCandidateSchema = z.object({
  hook: z
    .string()
    .max(200)
    .describe(
      "Attention-grabbing opening line addressing a specific customer pain or desired outcome for this exact product — never generic filler like 'solusi terbaik untuk bisnis Anda'",
    ),
  headline: z.string().max(120),
  cta: z
    .string()
    .max(40)
    .describe(
      "Action-oriented CTA matching the objective, funnel stage, and product type — not the same generic CTA for every product, and never implying a capability (e.g. a demo, a free trial) that wasn't stated as available",
    ),
  primary_text: z
    .string()
    .max(600)
    .describe(
      "Benefit-led body copy for THIS candidate's own angle specifically — problem, consequence, solution, key benefit, reason to act. Must stay consistent with this candidate's hook/headline, not a shared generic paragraph reused across all 3",
    ),
  rationale: z
    .string()
    .max(200)
    .describe("One short, plain-language sentence on why this angle fits the objective and audience — no jargon"),
});

export type CreativeCandidate = z.infer<typeof CreativeCandidateSchema>;

/**
 * Structured output contract for the Promote Wizard's "Let AI build your
 * campaign" step (product spec §15 step 7; upgraded for Batch B1 —
 * persuasive marketing intelligence). Shared by the Advanced wizard, Quick
 * Promote, and campaign regeneration — all three already funnel through
 * the same buildCampaignProposalPrompt/runAiJob call, so this contract
 * intentionally isn't forked per flow. Budget allocation percentages must
 * sum to ~100 across the channels the user selected — the provider
 * enforces the channel list, not this schema, since only it knows which
 * channels were selected.
 */
export const CampaignProposalSchema = z.object({
  customer_pain: z
    .string()
    .max(300)
    .describe(
      "The specific problem or frustration this customer segment experiences — grounded in the actual product/category given, not a generic pain statement",
    ),
  desired_outcome: z.string().max(300).describe("The result the customer wants instead of that pain"),
  value_proposition: z
    .string()
    .max(300)
    .describe(
      "Why this product is the relevant answer — grounded only in the product attributes actually given as context, never an invented capability",
    ),
  positioning: z.string(),
  audience_summary: z.string().describe("Who this campaign targets, in plain language"),
  marketing_angle: z
    .string()
    .describe("The single strongest marketing angle chosen for this objective, and why it beats the alternatives"),
  candidates: z
    .array(CreativeCandidateSchema)
    .length(3)
    .describe(
      "Exactly 3 distinct hook/headline/CTA/primary_text directions for this campaign (different angles, not wording variants of the same angle), ordered strongest first. Rank by relevance to customer_pain, clarity, specificity, strength of benefit, fit with the objective/product type/funnel stage, natural language, CTA actionability, and truthfulness — never by which one simply sounds more aggressive or salesy",
    ),
  hook: z.string().max(200).describe("Must equal candidates[0].hook"),
  headline: z.string().max(120).describe("Must equal candidates[0].headline"),
  primary_text: z
    .string()
    .max(600)
    .describe("Benefit-led body copy expanding on the top-ranked candidate: problem, consequence, solution, key benefit, reason to act"),
  cta: z.string().max(40).describe("Must equal candidates[0].cta"),
  creative_concept: z.string().describe("Brief description of the recommended visual/video concept"),
  recommended_channels: z.array(channelEnum).min(1),
  budget_allocation: z
    .array(
      z.object({
        channel: channelEnum,
        percentage: z.number().min(0).max(100),
      }),
    )
    .min(1),
});

export type CampaignProposal = z.infer<typeof CampaignProposalSchema>;

/**
 * Deterministically syncs the top-level hook/headline/cta/primary_text —
 * read directly by the campaign detail page, CampaignCopyEditor, and the
 * ad connectors — with the model's own top-ranked candidate. Called once
 * right after a successful generation, never trusting the model to keep
 * two representations of the same "primary pick" consistent on its own.
 * primary_text falls back to the proposal's own value when reading a
 * candidate generated before that field existed (older stored data).
 */
export function withPrimaryCandidate(proposal: CampaignProposal): CampaignProposal {
  const primary = proposal.candidates[0];
  return {
    ...proposal,
    hook: primary.hook,
    headline: primary.headline,
    cta: primary.cta,
    primary_text: primary.primary_text ?? proposal.primary_text,
  };
}

/**
 * Batch B1 correction #1 — "Gunakan Ini": lets the Owner swap which
 * already-generated candidate is the active recommendation, without a
 * second AI call and without creating a second campaign. Swaps the
 * chosen candidate into position 0 and the previous primary into the
 * vacated slot (so it becomes one of the alternatives, per the founder's
 * "previous selection becomes an alternative" requirement), then reuses
 * withPrimaryCandidate so hook/headline/cta/primary_text all move
 * together — never just the headline while the body copy stays written
 * for the old angle. Out-of-range index is a no-op, not a throw, since
 * this always originates from a fixed set of rendered "Gunakan Ini"
 * buttons.
 */
export function selectCandidate(proposal: CampaignProposal, index: number): CampaignProposal {
  if (!Number.isInteger(index) || index <= 0 || index >= proposal.candidates.length) {
    return proposal;
  }
  const candidates = [...proposal.candidates];
  [candidates[0], candidates[index]] = [candidates[index], candidates[0]];
  return withPrimaryCandidate({ ...proposal, candidates });
}
