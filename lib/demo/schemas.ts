import { z } from "zod";

/**
 * Deliberately smaller than the real production schemas
 * (schemas/ai/marketing-blueprint.ts, schemas/ai/content-generation.ts)
 * — fewer fields means a shorter completion, which is itself part of the
 * demo's cost-ceiling story (Founder requirement #3), on top of the hard
 * cap in lib/demo/ai-usage.ts. A demo visitor sees a genuine, live model
 * response, just a smaller one.
 */
export const DemoBlueprintSchema = z.object({
  summary: z.string().describe("2-3 sentence summary of the product's market position, in Indonesian"),
  usp: z.string().describe("The single clearest unique selling point, in Indonesian"),
  benefits: z.array(z.string()).min(2).max(4),
  targetPersona: z.string().describe("One short persona label, in Indonesian"),
  recommendedChannel: z.enum(["INSTAGRAM", "TIKTOK"]),
});

export const DemoContentSchema = z.object({
  caption: z.string().describe("A short social caption in Indonesian, under 280 characters"),
  hashtags: z.array(z.string()).min(3).max(6),
});
