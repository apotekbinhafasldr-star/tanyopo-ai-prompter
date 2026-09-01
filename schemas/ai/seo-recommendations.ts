import { z } from "zod";

/**
 * Structured output contract for AI SEO recommendation generation
 * (product spec's SEO module). The AI provider must return data matching
 * this shape exactly — see docs/AI_SYSTEM.md "Structured output only".
 * This is a set of suggestions to review, not something this app applies
 * to a website automatically — there is no site-editing integration.
 */
export const SeoRecommendationsSchema = z.object({
  summary: z.string().describe("2-3 sentence summary of the site's current SEO opportunity"),
  target_keywords: z
    .array(
      z.object({
        keyword: z.string(),
        intent: z.string().describe("Search intent, e.g. 'informational', 'transactional'"),
        rationale: z.string(),
      }),
    )
    .min(1)
    .max(10),
  on_page_recommendations: z
    .array(
      z.object({
        issue: z.string().describe("What's likely missing or weak, e.g. 'no meta description'"),
        recommendation: z.string(),
        priority: z.enum(["HIGH", "MEDIUM", "LOW"]),
      }),
    )
    .min(1)
    .max(10),
  content_plan: z
    .array(
      z.object({
        title: z.string().describe("Suggested article/blog title"),
        target_keyword: z.string(),
        content_type: z.enum(["BLOG", "LANDING_PAGE", "FAQ", "GUIDE"]),
        angle: z.string().describe("One-sentence angle/hook for the piece"),
      }),
    )
    .min(1)
    .max(8),
});

export type SeoRecommendations = z.infer<typeof SeoRecommendationsSchema>;
