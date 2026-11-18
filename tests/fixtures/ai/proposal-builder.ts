import type { CampaignProposal } from "@/schemas/ai/campaign-proposal";

type Candidate = CampaignProposal["candidates"][number];

/** Builds a schema-shaped proposal whose top-level copy mirrors candidate 1. */
export function buildProposal(parts: {
  value_proposition: string;
  positioning: string;
  customer_pain: string;
  desired_outcome: string;
  audience_summary: string;
  marketing_angle: string;
  creative_concept: string;
  candidates: [Candidate, Candidate, Candidate];
  budget_allocation: { channel: "INSTAGRAM" | "FACEBOOK" | "TIKTOK" | "X"; percentage: number; reason: string }[];
}): CampaignProposal {
  const top = parts.candidates[0];
  return {
    customer_pain: parts.customer_pain,
    desired_outcome: parts.desired_outcome,
    value_proposition: parts.value_proposition,
    positioning: parts.positioning,
    audience_summary: parts.audience_summary,
    marketing_angle: parts.marketing_angle,
    candidates: parts.candidates,
    hook: top.hook,
    headline: top.headline,
    primary_text: top.primary_text,
    cta: top.cta,
    creative_concept: parts.creative_concept,
    budget_allocation: parts.budget_allocation,
    excluded_channels: [],
    recommended_channels: parts.budget_allocation.map((b) => b.channel),
  } as unknown as CampaignProposal;
}
