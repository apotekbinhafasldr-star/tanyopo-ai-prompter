# AI System

## Provider abstraction

Business logic never calls a model vendor's SDK directly — it calls `AIProvider` (`lib/ai/provider.ts`):

```ts
interface AIProvider {
  readonly name: string;
  generateStructured<T>(schema: z.ZodType<T>, request: StructuredGenerationRequest): Promise<StructuredGenerationResult<T>>;
}
```

`lib/ai/get-provider.ts#getAIProvider()` returns the configured implementation or `null`. `serverEnv.aiProviderApiKey` (see `lib/env.ts`) gates this — with no key set, every AI-powered action returns `null` and the caller must show that as a plain "AI belum dikonfigurasi" state, never fabricated output. `serverEnv.aiProviderName` selects the implementation and defaults to `"anthropic"` when a key is present but the name is left blank.

**Implemented:** `lib/ai/anthropic-provider.ts` — Claude Opus 5 (`claude-opus-5`) via the official `@anthropic-ai/sdk`, using `client.messages.parse()` with `zodOutputFormat()` for structured output. Errors are classified most-specific-first (`AuthenticationError` → `RateLimitError` → `APIConnectionError` → `APIError`) into human-readable messages before reaching the UI; a `stop_reason: "refusal"` is surfaced as a clear "AI menolak membuat konten ini" rather than an opaque failure.

Swapping or adding a provider means adding a new `lib/ai/*-provider.ts` file and a case in `get-provider.ts` — no feature code changes.

## Structured output only

Every AI call is validated against a Zod schema before anything downstream trusts it — `client.messages.parse()` either returns a `parsed_output` that matches the schema, or the provider throws. There is no free-text parsing path.

Implemented schemas (`schemas/ai/`):

- `MarketingBlueprintSchema` — summary, USP, benefits, pain points, target personas, positioning, marketing angles, recommended channels, content ideas, risks, disclaimers
- `CampaignProposalSchema` — positioning, audience summary, marketing angle, headline, primary text, CTA, creative concept, recommended channels, budget allocation
- `ContentGenerationSchema` — hook, caption, body, CTA, hashtags, creative brief, video script (nullable when not applicable)
- `SeoRecommendationsSchema` (Phase 5) — summary, target keywords (with intent + rationale), on-page recommendations (issue/recommendation/priority), content plan (title/keyword/content type/angle). The prompt (`buildSeoRecommendationsPrompt`) is explicit that the model has no way to actually crawl the target website — recommendations are reasoned from the URL and business context the tenant provided, not from a real page audit, and the UI repeats that caveat next to the generate button.
- `AnalyticsInsightSchema` (Phase 7) — summary, trends, top channel, underperforming channels, risks. The prompt (`buildAnalyticsInsightPrompt`) hands the model only the tenant's real aggregated `prompter_marketing_metrics`/`prompter_conversions` data; `generateAnalyticsInsightAction()` refuses to call the provider at all when both are empty, so there is no path to a fabricated insight.
- `OptimizationRecommendationSchema` (Phase 7) — summary plus a per-channel `recommendations` array (`action_type`: `INCREASE_BUDGET`/`DECREASE_BUDGET`/`PAUSE_CHANNEL`/`NO_ACTION`, `suggested_daily_budget`, `rationale`, `risk_level`). Both the prompt (`buildOptimizationRecommendationPrompt`) and the schema's `rationale` field description explicitly require reasoning about contribution margin (revenue − COGS − ad spend) rather than ROAS alone — the same high-ROAS-but-poor-contribution campaign should not automatically be recommended for scaling — and explicitly forbid fabricating a channel's numbers or calling the result "net profit."

## Prompt construction

`lib/ai/prompts.ts` builds every prompt from the same two pieces: `buildSystemPreamble(brandProfile)` (tenant brand context — name, description, tone of voice, target market, prohibited claims — plus the guardrails below) and a feature-specific prompt builder (`buildMarketingBlueprintPrompt`, `buildCampaignProposalPrompt`, `buildContentPrompt`, `buildSeoRecommendationsPrompt`) that describes the product/website and the user's specific inputs. No feature builds its own ad-hoc prompt string outside this file.

## Agent architecture (deterministic, not an autonomous loop)

The product spec names eleven agent roles (`MarketingOrchestrator`, `ProductIntelligenceAgent`, `StrategyAgent`, `CopywriterAgent`, `CreativeAgent`, `SocialAgent`, `AdsAgent`, `SEOAgent`, `AnalyticsAgent`, `OptimizationAgent`, `GrowthAgent`). Phase 1 implements the first three as single structured-output calls (blueprint generation, campaign proposal generation, content generation); Phase 5 adds a fourth, `SEOAgent` (SEO recommendation generation); Phase 7 adds two more, `AnalyticsAgent` (analytics insight generation) and `OptimizationAgent` (optimization recommendation generation) — all deterministic request → validated response, no open-ended tool access, no autonomous loop. `GrowthAgent` remains unbuilt — Growth tracking (Phase 5) is honest manual entry, not an AI-driven agent. Later phases add more generation types the same way rather than introducing a different architecture.

## Autopilot (Phase 7)

Autopilot is a policy-gated *routing* decision, never an autonomous *execution* one — this app has no background scheduler, so nothing runs unattended. When `prompter_automation_settings.automation_mode = 'autopilot'` and the matching `prompter_autopilot_policies` row is enabled, an Optimization Agent recommendation is auto-submitted to the Approval Center (`features/campaigns/optimization-actions.ts#maybeAutoSubmitRecommendations()`) instead of waiting for a manual click — but it still lands as a pending `AUTOPILOT_ACTION` approval, and real execution against a connector only happens after an Owner clicks Approve (`features/approvals/actions.ts#executeAutopilotAction()`, which re-validates Emergency Stop, campaign status, and connector configuration fresh at that moment). See [SECURITY.md](SECURITY.md) "Automation safety" for the full list of boundaries Autopilot can never bypass.

## AI jobs

`prompter_ai_jobs` (see `docs/DATABASE.md`) tracks every generation request: `job_type` (now includes `ANALYTICS_INSIGHT` and `OPTIMIZATION_RECOMMENDATION` as of Phase 7), `status` (`QUEUED`/`PROCESSING`/`COMPLETED`/`FAILED`), `model`, token counts, `estimated_cost`, `error`, timestamps. `services/ai-jobs.ts#runAiJob()` wraps every call to `AIProvider.generateStructured()` — inserts the job row before calling the provider, updates it to `COMPLETED` with token counts or `FAILED` with the error message afterward. No job is ever left stuck `QUEUED`. `estimated_cost` is still not populated for any job type (needs per-model pricing — remains open, not resolved in Phase 7).

## Guardrails

`buildSystemPreamble()` instructs the model, on every call, not to:

- make misleading or unsupported claims (medical, financial guarantees, etc.)
- promote illegal products or violate common ad platform policies (Meta, TikTok, X)
- fabricate testimonials or false urgency/scarcity

and to surface (not silently drop) any claim risk it's unsure about — `MarketingBlueprintSchema.risks` exists specifically so the model has somewhere to put that, for human review.

AI output is a draft for human review, not an auto-published artifact. Campaign drafts stay `status = 'DRAFT'` through all of Phase 1 — nothing tells a user a campaign "berhasil tayang" (went live), because nothing publishes yet.

## Demo data

Any AI insight or metric shown without real underlying data must be visibly labeled `DEMO`. The dashboard's "Tanyopo Intelligence" card (`features/dashboard/ai-insight-card.tsx`) still always renders its real empty state — Phase 1 added product/campaign/content generation, not an analytics pipeline, so there's still no real insight to show yet.

## Current state (Phase 7)

Anthropic is the only implemented provider. Marketing Blueprint generation, Promote Wizard campaign proposals, Content Studio generation, SEO recommendation generation, Analytics Agent insights, and Optimization Agent recommendations are all live end-to-end when `AI_PROVIDER_API_KEY` is configured. Image generation/analysis, `GrowthAgent`, `MarketingOrchestrator` as a distinct orchestration layer (today each generation type is invoked directly, not routed through a separate orchestrator agent), and cost estimation are not yet built.
