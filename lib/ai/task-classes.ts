import type { AiJobType } from "@/types/database";

/**
 * Routing categories the Tanyopo AI Router (lib/ai/router.ts) uses to pick
 * a provider/model per workload, instead of every feature hard-coding one
 * provider. See docs/AI_SYSTEM.md "AI Router".
 *
 * - FAST: cheap, low-latency generation (not used by any job type yet —
 *   reserved for future caption/hashtag/CTA-variant style calls).
 * - STANDARD: everyday content generation and reporting.
 * - STRATEGY: campaign/marketing strategy reasoning.
 * - CRITICAL: recommendations that can change ad spend — routed through
 *   the same class regardless, but execution still always goes through
 *   Budget Guard + the Approval Center (lib/autopilot-policy.ts,
 *   features/approvals/actions.ts). A task class never grants an AI
 *   response the authority to bypass those.
 */
export type AITaskClass = "FAST" | "STANDARD" | "STRATEGY" | "CRITICAL";

export type AIProviderName = "openai" | "anthropic";

export function isKnownProviderName(value: string | undefined): value is AIProviderName {
  return value === "openai" || value === "anthropic";
}

/** Every prompter_ai_jobs.job_type routed through the AI Router. */
export const TASK_CLASS_BY_JOB_TYPE: Record<AiJobType, AITaskClass> = {
  MARKETING_BLUEPRINT: "STRATEGY",
  CAMPAIGN_PROPOSAL: "STRATEGY",
  CONTENT_GENERATION: "STANDARD",
  SEO_RECOMMENDATIONS: "STRATEGY",
  ANALYTICS_INSIGHT: "STANDARD",
  OPTIMIZATION_RECOMMENDATION: "CRITICAL",
};
