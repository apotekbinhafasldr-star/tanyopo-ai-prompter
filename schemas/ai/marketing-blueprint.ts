import { z } from "zod";

/**
 * Structured output contract for AI Marketing Blueprint generation
 * (product spec §18-19). The AI provider must return data matching this
 * shape exactly — see docs/AI_SYSTEM.md "Structured output only".
 */
export const MarketingBlueprintSchema = z.object({
  summary: z.string().describe("2-3 sentence summary of the product and its market position"),
  usp: z.string().describe("The single clearest unique selling point"),
  benefits: z.array(z.string()).min(1).max(6),
  pain_points: z.array(z.string()).min(1).max(6).describe("Customer pain points this product solves"),
  target_personas: z
    .array(
      z.object({
        name: z.string().describe("Short persona label, e.g. 'Ibu rumah tangga usia 30-45'"),
        description: z.string(),
      }),
    )
    .min(1)
    .max(4),
  positioning: z.string().describe("One-sentence market positioning statement"),
  marketing_angles: z.array(z.string()).min(1).max(5),
  recommended_channels: z
    .array(z.enum(["FACEBOOK", "INSTAGRAM", "TIKTOK", "X", "SEO"]))
    .min(1),
  content_ideas: z.array(z.string()).min(1).max(8),
  risks: z.array(z.string()).describe("Compliance/policy/claim risks to review before publishing"),
  disclaimers: z
    .string()
    .describe("Any required disclaimer text, empty string if none apply"),
});

export type MarketingBlueprint = z.infer<typeof MarketingBlueprintSchema>;
