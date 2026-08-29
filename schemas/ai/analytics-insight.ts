import { z } from "zod";

/**
 * Structured output contract for AI performance-insight generation
 * (product spec's AnalyticsAgent, Phase 7). The model only ever sees a
 * summarized version of the tenant's real prompter_marketing_metrics/
 * prompter_conversions rows (see lib/ai/prompts.ts#buildAnalyticsInsightPrompt)
 * and is explicitly instructed not to reference a channel or number that
 * wasn't given to it — this schema constrains the shape, not the honesty
 * of the content, so the prompt-side instruction still matters.
 */
export const AnalyticsInsightSchema = z.object({
  summary: z.string().describe("2-4 sentence plain-language summary of current marketing performance"),
  trends: z
    .array(
      z.object({
        metric: z.string().describe("e.g. 'Spend Facebook', 'Konversi Purchase'"),
        observation: z.string(),
        direction: z.enum(["UP", "DOWN", "FLAT"]),
      }),
    )
    .min(1)
    .max(6),
  top_channel: z.string().nullable().describe("Best-performing channel by the data given, or null if not determinable"),
  underperforming_channels: z.array(z.string()).max(5),
  risks: z.array(z.string()).max(5).describe("Data quality caveats or concerning patterns worth flagging"),
});

export type AnalyticsInsight = z.infer<typeof AnalyticsInsightSchema>;
