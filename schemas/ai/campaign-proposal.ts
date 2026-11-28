import { z } from "zod";
import { PROPOSAL_OBJECTIVE_VALUES } from "@/schemas/ai/proposal-objectives";

const channelEnum = z.enum(["FACEBOOK", "INSTAGRAM", "TIKTOK", "X", "SEO"]);

/**
 * Length limits of the active ad copy. One source of truth for the schema below AND for the server-side check in
 * updateCampaignCopyAction / the submit gate (the HTML maxLength on the editor is only a convenience, not a guard).
 */
export const COPY_LIMITS = { hook: 200, headline: 120, primary_text: 600, cta: 40 } as const;

const COPY_LIMIT_LABELS: Record<keyof typeof COPY_LIMITS, string> = {
  hook: "Hook",
  headline: "Judul",
  primary_text: "Teks utama",
  cta: "CTA",
};

/**
 * Problems with the ACTIVE copy that the launch actually sends, found on an unparsed value. The launch
 * (features/campaigns/launch-actions.ts, createCreative) sends `headline`, `primary_text` and `cta` and substitutes
 * a fallback when one is missing (campaign name / empty text / "Pelajari Lebih Lanjut"), so an approval for a
 * proposal without them would approve something other than what is shown. `hook` is shown and gate-scanned but not
 * sent; it may be absent, but if present it must be a string. Empty and whitespace-only strings count as missing.
 */
export function findActiveCopyProblems(raw: unknown): string[] {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return ["strategi iklan belum ada atau bentuknya tidak dikenali"];
  }
  const record = raw as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of ["headline", "primary_text", "cta"] as const) {
    const value = record[key];
    if (typeof value !== "string" || value.trim().length === 0) problems.push(`${COPY_LIMIT_LABELS[key]} kosong atau bukan teks`);
  }
  const hook = record.hook;
  if (hook !== undefined && hook !== null && typeof hook !== "string") problems.push("Hook bukan teks");
  return problems;
}

/**
 * Names every active copy field whose string is longer than COPY_LIMITS. Works on an unparsed value, so it also
 * covers a stored proposal that the schema rejected. Non-string fields are ignored here (the schema owns types).
 */
export function findCopyLengthViolations(raw: unknown): string[] {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return [];
  const record = raw as Record<string, unknown>;
  const violations: string[] = [];
  for (const key of Object.keys(COPY_LIMITS) as (keyof typeof COPY_LIMITS)[]) {
    const value = record[key];
    if (typeof value === "string" && value.length > COPY_LIMITS[key]) {
      violations.push(`${COPY_LIMIT_LABELS[key]} ${value.length}/${COPY_LIMITS[key]} karakter`);
    }
  }
  return violations;
}

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
    .max(COPY_LIMITS.hook)
    .describe(
      "Attention-grabbing opening line addressing a specific customer pain or desired outcome for this exact product — never generic filler like 'solusi terbaik untuk bisnis Anda'",
    ),
  headline: z.string().max(COPY_LIMITS.headline),
  cta: z
    .string()
    .max(COPY_LIMITS.cta)
    .describe(
      "Action-oriented CTA matching the objective, funnel stage, and product type — not the same generic CTA for every product, and never implying a capability (e.g. a demo, a free trial) that wasn't stated as available",
    ),
  primary_text: z
    .string()
    .max(COPY_LIMITS.primary_text)
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
const campaignProposalBaseShape = {
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
  hook: z.string().max(COPY_LIMITS.hook).describe("Must equal candidates[0].hook"),
  headline: z.string().max(COPY_LIMITS.headline).describe("Must equal candidates[0].headline"),
  primary_text: z
    .string()
    .max(COPY_LIMITS.primary_text)
    .describe("Benefit-led body copy expanding on the top-ranked candidate: problem, consequence, solution, key benefit, reason to act"),
  cta: z.string().max(COPY_LIMITS.cta).describe("Must equal candidates[0].cta"),
  creative_concept: z.string().describe("Brief description of the recommended visual/video concept"),
  budget_allocation: z
    .array(
      z.object({
        channel: channelEnum,
        percentage: z.number().min(0).max(100),
        reason: z
          .string()
          .max(200)
          .describe(
            "One short, plain-language sentence on why this specific channel fits THIS campaign — grounded in product type/category, objective, audience, market, and marketing_angle. No jargon, never generic",
          ),
      }),
    )
    .min(1)
    .describe(
      "Only channels actually worth recommending (percentage > 0) — never every available channel just because it was offered. Percentages of the recommended channels must sum to exactly 100. When the budget is small, concentrate it on the 2-3 strongest-fit channels rather than spreading it thin across all of them",
    ),
  excluded_channels: z
    .array(
      z.object({
        channel: channelEnum,
        reason: z
          .string()
          .max(200)
          .describe("One short, plain-language sentence on why this channel's contribution is judged lower for THIS campaign specifically — not generic"),
      }),
    )
    .describe(
      "Channels that were considered from the available list but not recommended (0% — do not also list them in budget_allocation). Empty array only if every available channel was genuinely worth recommending",
    ),
  recommended_channels: z.array(channelEnum).min(1).describe("Must equal the channels listed in budget_allocation"),
};

/**
 * PR-5 additions. All of them are advice for the reviewer, never launch input:
 * nothing here is sent to an ad platform. In particular there is NO field for
 * a Meta interest/behavior ID — `interest_suggestions_text` is plain keyword
 * text, and every object below is strict so an unknown key (e.g. `interest_ids`)
 * is rejected instead of silently stored.
 */
const objectiveRecommendationField = z
  .enum(PROPOSAL_OBJECTIVE_VALUES)
  .describe(
    "Recommended objective, chosen ONLY from the listed values. Advice only: it does not change the campaign objective and does not mean the objective is supported for launch",
  );

export const ProposalAudienceSchema = z
  .strictObject({
    countries: z
      .array(z.string().length(2))
      .max(10)
      .describe("Target countries as ISO 3166-1 alpha-2 codes in capitals (e.g. ID), only countries given in the context"),
    age_min: z.number().int().min(13).max(65).describe("Lowest suggested age"),
    age_max: z.number().int().min(13).max(65).describe("Highest suggested age; 65 means 65 and older"),
    advantage_plus: z.boolean().describe("Whether broad automated (Advantage+) audience is suggested"),
    interest_suggestions_text: z
      .array(
        z
          .string()
          .max(60)
          .refine((value) => !/^\d+$/.test(value.trim()), { message: "Interest suggestions are plain keywords, never numeric IDs" }),
      )
      .max(10)
      .describe("Plain keyword text ONLY, for the owner to search for by hand. Never a Meta interest or behavior ID"),
  })
  .refine((audience) => audience.age_min <= audience.age_max, { message: "age_min must not be greater than age_max" });

export type ProposalAudience = z.infer<typeof ProposalAudienceSchema>;

/**
 * The audience as the AI is asked to produce it: NO refinements and no numeric/length bounds, so a slightly off
 * answer (ages swapped, a country name, a numeric "interest") cannot fail the whole proposal generation.
 * normalizeProposalAdditions() repairs it in code before anything is saved, and the stored schema above stays strict.
 */
export const ProposalAudienceGenerationSchema = z.strictObject({
  countries: z.array(z.string()).describe("Target countries as ISO 3166-1 alpha-2 codes in capitals (e.g. ID), only countries given in the context"),
  age_min: z.number().int().describe("Lowest suggested age (13-65)"),
  age_max: z.number().int().describe("Highest suggested age (13-65); 65 means 65 and older"),
  advantage_plus: z.boolean().describe("Whether broad automated (Advantage+) audience is suggested"),
  interest_suggestions_text: z
    .array(z.string())
    .describe("Plain keyword text ONLY, for the owner to search for by hand. Never a Meta interest or behavior ID or a number"),
});

export const ProposalTestPlanSchema = z.strictObject({
  recommended_variants: z
    .array(z.number().int().min(1).max(3))
    .min(1)
    .max(3)
    .describe("Which copy candidates (1-3, as ordered in candidates) to run against each other"),
  min_duration_days: z.number().int().min(1).max(60).describe("Minimum number of days to let the test run before judging it"),
  rationale: z
    .string()
    .max(200)
    .describe("One short sentence on how to compare the variants. No performance numbers, no promised results"),
});

export type ProposalTestPlan = z.infer<typeof ProposalTestPlanSchema>;

const missingFactsDescription =
  "Facts that were NOT given but would be needed (price, stock, proof, destination, ...). Never invent them; leave empty when nothing is missing";
const missingFactsField = z.array(z.string().max(200)).max(8).describe(missingFactsDescription);

/**
 * What is STORED in `ai_proposal` and read back by the campaign page, the quality gate and submit.
 * The PR-5 fields are optional (and nullable), so every proposal saved before PR-5 stays valid.
 */
export const CampaignProposalSchema = z.object({
  ...campaignProposalBaseShape,
  objective_recommendation: objectiveRecommendationField.nullish(),
  audience: ProposalAudienceSchema.nullish(),
  missing_facts: missingFactsField.nullish(),
  test_plan: ProposalTestPlanSchema.nullish(),
});

/**
 * What the AI is asked to produce (passed to runAiJob). Same shape, but the
 * PR-5 fields are REQUIRED-and-nullable instead of optional: the providers'
 * structured-output APIs reject `.optional()` (see
 * tests/unit/schemas/ai-discovery-recommendations.test.ts). A model that has
 * nothing to say returns null / [] for them. Its output is assignable to
 * CampaignProposal.
 */
export const CampaignProposalGenerationSchema = z.object({
  ...campaignProposalBaseShape,
  objective_recommendation: objectiveRecommendationField.nullable(),
  audience: ProposalAudienceGenerationSchema.nullable(),
  missing_facts: z.array(z.string()).describe(missingFactsDescription),
  test_plan: ProposalTestPlanSchema.nullable(),
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

/**
 * Batch B2 — Smart Channel Selection. Deterministically drops any
 * non-positive-percentage entry the model left in budget_allocation
 * despite the prompt instruction to put those in excluded_channels
 * instead, and derives recommended_channels from what's left — the same
 * "never trust the model to keep two representations in sync on its own"
 * pattern as withPrimaryCandidate(). Falls back to the proposal's own
 * values when budget_allocation is empty after filtering (shouldn't
 * happen given the schema's .min(1), but never leaves the campaign with
 * zero channels).
 */
export function withRecommendedChannels(proposal: CampaignProposal): CampaignProposal {
  const activeAllocation = proposal.budget_allocation.filter((b) => b.percentage > 0);
  if (activeAllocation.length === 0) {
    return proposal;
  }
  return {
    ...proposal,
    budget_allocation: activeAllocation,
    recommended_channels: activeAllocation.map((b) => b.channel),
  };
}

/**
 * Repairs the PR-5 fields of a freshly generated proposal so that it satisfies the STRICT stored schema, instead of
 * rejecting the whole generation over a cosmetic slip: swaps age_min/age_max when inverted, clamps ages to 13-65,
 * keeps only two-letter country codes (upper-cased, at most 10), keeps only text interests (drops numeric-only or
 * empty strings, trims, truncates to 60 characters, de-duplicates, at most 10), and trims missing_facts to
 * non-empty strings of at most 200 characters (at most 8). Pure; returns a new object.
 */
export function normalizeProposalAdditions<T extends CampaignProposal>(proposal: T): T {
  const next: CampaignProposal = { ...proposal };
  const audience = proposal.audience;
  if (audience) {
    const clampAge = (n: number) => Math.min(65, Math.max(13, Math.round(Number.isFinite(n) ? n : 13)));
    const [lo, hi] = [clampAge(audience.age_min), clampAge(audience.age_max)].sort((a, b) => a - b);
    const countries = [
      ...new Set(
        (audience.countries as unknown[])
          .filter((c): c is string => typeof c === "string")
          .map((c) => c.trim().toUpperCase())
          .filter((c) => /^[A-Z]{2}$/.test(c)),
      ),
    ].slice(0, 10);
    const interests = [
      ...new Set(
        (audience.interest_suggestions_text as unknown[])
          .filter((i): i is string => typeof i === "string")
          .map((i) => i.trim().slice(0, 60).trim())
          .filter((i) => i.length > 0 && !/^\d+$/.test(i)),
      ),
    ].slice(0, 10);
    next.audience = {
      countries,
      age_min: lo,
      age_max: hi,
      advantage_plus: audience.advantage_plus === true,
      interest_suggestions_text: interests,
    };
  }
  if (proposal.missing_facts) {
    next.missing_facts = proposal.missing_facts
      .filter((f): f is string => typeof f === "string")
      .map((f) => f.trim().slice(0, 200))
      .filter((f) => f.length > 0)
      .slice(0, 8);
  }
  return next as T;
}
