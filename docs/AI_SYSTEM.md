# AI System

## Provider abstraction

Business logic must never call a specific model vendor's SDK directly. The planned shape (Phase 1):

```ts
interface AIProvider {
  generateText(input): Promise<...>;
  generateStructured<T>(input, schema: ZodSchema<T>): Promise<T>;
  analyzeImage?(input): Promise<...>; // only if the provider supports it
}
```

`serverEnv.aiProviderName` / `serverEnv.aiProviderApiKey` (see `lib/env.ts`) select and configure the active implementation. Swapping providers should never require touching a feature's business logic — only the provider implementation.

## Structured output only

AI responses that drive the product (marketing blueprints, campaign proposals, generated content, analytics insights, optimization recommendations) are validated against Zod schemas before anything downstream trusts them. Free-text parsing of AI output is not an acceptable pattern here — an AI response that doesn't validate is a failed job, not a best-effort guess.

Planned schemas (Phase 1+): `MarketingBlueprintSchema`, `CampaignProposalSchema`, `ContentGenerationSchema`, `AnalyticsInsightSchema`, `OptimizationRecommendationSchema`.

## Agent architecture (deterministic, not an autonomous loop)

The product spec names eleven agent roles (`MarketingOrchestrator`, `ProductIntelligenceAgent`, `StrategyAgent`, `CopywriterAgent`, `CreativeAgent`, `SocialAgent`, `AdsAgent`, `SEOAgent`, `AnalyticsAgent`, `OptimizationAgent`, `GrowthAgent`). For the MVP these are **deterministic workflows with structured outputs and explicit tool boundaries** — not a single autonomous LLM given open-ended tool access. Each agent has a defined input, a defined output schema, and a defined set of things it's allowed to touch for that tenant only.

## AI jobs

Planned table `ai_jobs` (Phase 1+) tracks every generation request: `job_type`, `status` (`QUEUED`/`PROCESSING`/`COMPLETED`/`FAILED`), `model`, token counts, `estimated_cost`, timestamps, and an `error` field. This is both an audit trail and the basis for future usage-based billing (§91 cost observability).

## Guardrails

AI-generated marketing content must be checked against:

- misleading or unsupported claims (medical, financial guarantees, etc.)
- illegal products / prohibited ad categories
- fake testimonials, deceptive scarcity
- each connected platform's ad policy

AI output is a draft for human review, not an auto-published artifact — see the Promote flow's Preview/Approve steps in the product spec. The system must never tell a user a campaign "berhasil tayang" (went live) unless the external ad platform actually confirmed it.

## Demo data

Any AI insight or metric shown without real underlying data must be visibly labeled `DEMO`. The dashboard's "Tanyopo Intelligence" card (`features/dashboard/ai-insight-card.tsx`) currently always renders its real empty state, because Phase 0 has no analytics pipeline yet — it does not show placeholder example insights.

## Current state (Phase 0)

No AI provider integration exists yet. This document records the contract future phases build against.
