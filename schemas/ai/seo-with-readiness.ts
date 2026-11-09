import { SeoRecommendationsSchema } from "@/schemas/ai/seo-recommendations";
import { DiscoveryRecommendationsSchema } from "@/schemas/ai/discovery-recommendations";
import { AiSearchReadinessSchema } from "@/schemas/ai/ai-search-readiness";

/**
 * Output job SEO_RECOMMENDATIONS terbaru = skema lama + ai_search_readiness
 * (satu panggilan AI, satu kuota). Skema lama tetap utuh agar data lama dan
 * tesnya kompatibel.
 */
export const SeoWithReadinessSchema = SeoRecommendationsSchema.extend({
  ai_search_readiness: AiSearchReadinessSchema,
});

export const DiscoveryWithReadinessSchema = DiscoveryRecommendationsSchema.extend({
  ai_search_readiness: AiSearchReadinessSchema,
});
