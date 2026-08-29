import { z } from "zod";

/**
 * Structured output contract for the Promote Wizard's "Let AI build your
 * campaign" step (product spec §15 step 7). Budget allocation percentages
 * must sum to ~100 across the channels the user selected — the provider
 * enforces the channel list, not this schema, since only it knows which
 * channels were selected.
 */
export const CampaignProposalSchema = z.object({
  positioning: z.string(),
  audience_summary: z.string().describe("Who this campaign targets, in plain language"),
  marketing_angle: z.string(),
  headline: z.string().max(120),
  primary_text: z.string().max(600),
  cta: z.string().max(40).describe("Short call-to-action label, e.g. 'Belanja Sekarang'"),
  creative_concept: z.string().describe("Brief description of the visual/creative direction"),
  recommended_channels: z.array(z.enum(["FACEBOOK", "INSTAGRAM", "TIKTOK", "X", "SEO"])).min(1),
  budget_allocation: z
    .array(
      z.object({
        channel: z.enum(["FACEBOOK", "INSTAGRAM", "TIKTOK", "X", "SEO"]),
        percentage: z.number().min(0).max(100),
      }),
    )
    .min(1),
});

export type CampaignProposal = z.infer<typeof CampaignProposalSchema>;
