import { z } from "zod";

/**
 * Structured output contract for AI cross-channel optimization
 * suggestions (product spec's OptimizationAgent, Phase 7). Scoped to one
 * campaign's own channels — a well-defined comparison, not a fuzzy
 * tenant-wide one across unrelated campaigns. A recommendation is a
 * suggestion for human (or, policy-gated, system) review via the
 * Approval Center — this schema has no execution semantics of its own;
 * see features/campaigns/optimization-actions.ts for what happens next.
 */
export const OptimizationRecommendationSchema = z.object({
  summary: z.string().describe("2-4 sentence summary comparing this campaign's channels"),
  recommendations: z
    .array(
      z.object({
        channel: z.enum(["FACEBOOK", "INSTAGRAM", "TIKTOK", "X"]),
        action_type: z.enum(["INCREASE_BUDGET", "DECREASE_BUDGET", "PAUSE_CHANNEL", "NO_ACTION"]),
        rationale: z
          .string()
          .describe("Must reason about contribution margin/profitability, not ROAS alone — a high-ROAS channel with poor contribution margin should not be recommended for scaling"),
        suggested_daily_budget: z
          .number()
          .min(0)
          .nullable()
          .describe("Only set for INCREASE_BUDGET/DECREASE_BUDGET; null otherwise"),
        risk_level: z.enum(["LOW", "MEDIUM", "HIGH"]),
      }),
    )
    .min(1)
    .max(6),
});

export type OptimizationRecommendation = z.infer<typeof OptimizationRecommendationSchema>;
