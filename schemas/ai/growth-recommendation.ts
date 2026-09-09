import { z } from "zod";

/**
 * Batch B6 — Growth Automation Readiness. Deliberately reuses the
 * ANALYTICS_INSIGHT job_type for AI Router routing/bookkeeping (see
 * features/growth/actions.ts) rather than adding a new
 * prompter_ai_jobs.job_type — that column is a Postgres CHECK constraint,
 * and a new value would need a migration this batch doesn't need. The
 * result itself is never persisted to prompter_analytics_insights (that
 * table already belongs to the Analytics feature, one row per tenant) —
 * it's shown ephemerally in the UI, regenerated on demand.
 */
export const GrowthRecommendationSchema = z.object({
  summary: z
    .string()
    .max(400)
    .describe(
      "1-2 short sentences directly answering 'what should I do next for growth', grounded only in the context actually given",
    ),
  next_actions: z
    .array(z.string().max(200))
    .min(1)
    .max(4)
    .describe(
      "Concrete, short steps the owner can actually take right now in this app (e.g. buat konten, hubungkan channel, atur target, promosikan produk) — never generic advice with nothing to act on",
    ),
});

export type GrowthRecommendation = z.infer<typeof GrowthRecommendationSchema>;
