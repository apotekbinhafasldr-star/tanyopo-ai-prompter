# AI System

## Provider abstraction

Business logic never calls a model vendor's SDK directly, and — as of the multi-provider architecture correction — never even picks *which* provider runs. It calls `AIProvider` (`lib/ai/provider.ts`) only indirectly, through the **Tanyopo AI Router** (`lib/ai/router.ts`):

```ts
interface AIProvider {
  readonly name: string;
  generateStructured<T>(schema: z.ZodType<T>, request: StructuredGenerationRequest): Promise<StructuredGenerationResult<T>>;
}
```

**Implemented:**

- `lib/ai/anthropic-provider.ts` — Claude Opus 5 (`claude-opus-5` default) via the official `@anthropic-ai/sdk`, using `client.messages.parse()` with `zodOutputFormat()` for structured output.
- `lib/ai/openai-provider.ts` — via the official `openai` SDK's Responses API (`client.responses.parse()` with `zodTextFormat()` for structured output). Unlike Anthropic, OpenAI has **no hardcoded default model** in this codebase — no OpenAI model id has ever been chosen/verified here, so every OpenAI-routed call needs a model from configuration (`AI_OPENAI_DEFAULT_MODEL` or a per-class `AI_<CLASS>_MODEL`); a route that resolves to OpenAI with no model configured is treated as unusable rather than guessing an id that might not exist.

Both throw `AIProviderError` (`lib/ai/provider.ts`, carrying a coarse `category`: `AUTH`/`RATE_LIMIT`/`CONNECTION`/`API`/`REFUSAL`/`INVALID_OUTPUT`/`CONFIG`) classified most-specific-first from each SDK's own error types, rather than a single opaque message — a `refusal` (Anthropic's `stop_reason`, OpenAI's `refusal`-type output item) is surfaced as a clear "AI menolak membuat konten ini" either way.

Swapping or adding a provider means adding a new `lib/ai/*-provider.ts` file and a case in `router.ts#instantiateProvider()` — no feature code changes, since feature code never references a provider at all (see "AI Router" below).

## Structured output only

Every AI call is validated against a Zod schema before anything downstream trusts it — `client.messages.parse()` either returns a `parsed_output` that matches the schema, or the provider throws. There is no free-text parsing path.

Implemented schemas (`schemas/ai/`):

- `MarketingBlueprintSchema` — summary, USP, benefits, pain points, target personas, positioning, marketing angles, recommended channels, content ideas, risks, disclaimers
- `CampaignProposalSchema` — positioning, audience summary, marketing angle, headline, primary text, CTA, creative concept, recommended channels, budget allocation
- `ContentGenerationSchema` — hook, caption, body, CTA, hashtags, creative brief, video script (nullable when not applicable)
- `SeoRecommendationsSchema` (Phase 5) — summary, target keywords (with intent + rationale), on-page recommendations (issue/recommendation/priority), content plan (title/keyword/content type/angle). The prompt (`buildSeoRecommendationsPrompt`) is explicit that the model has no way to actually crawl the target website — recommendations are reasoned from the URL and business context the tenant provided, not from a real page audit, and the UI repeats that caveat next to the generate button.
- `AnalyticsInsightSchema` (Phase 7) — summary, trends, top channel, underperforming channels, risks. The prompt (`buildAnalyticsInsightPrompt`) hands the model only the tenant's real aggregated `prompter_marketing_metrics`/`prompter_conversions` data; `generateAnalyticsInsightAction()` refuses to call the provider at all when both are empty, so there is no path to a fabricated insight.
- `OptimizationRecommendationSchema` (Phase 7) — summary plus a per-channel `recommendations` array (`action_type`: `INCREASE_BUDGET`/`DECREASE_BUDGET`/`PAUSE_CHANNEL`/`NO_ACTION`, `suggested_daily_budget`, `rationale`, `risk_level`). Both the prompt (`buildOptimizationRecommendationPrompt`) and the schema's `rationale` field description explicitly require reasoning about contribution margin (revenue − COGS − ad spend) rather than ROAS alone — the same high-ROAS-but-poor-contribution campaign should not automatically be recommended for scaling — and explicitly forbid fabricating a channel's numbers or calling the result "net profit."

## AI Router

`lib/ai/router.ts#routeStructuredGeneration()` is the single place any feature asks for a structured AI generation — called only from `services/ai-jobs.ts#runAiJob()`, never directly by feature action files. A caller declares a **task class** (`lib/ai/task-classes.ts`), never a provider:

- `FAST` — reserved for future low-latency calls (caption/hashtag/CTA variants); no job type uses it yet.
- `STANDARD` — `CONTENT_GENERATION`, `ANALYTICS_INSIGHT`.
- `STRATEGY` — `MARKETING_BLUEPRINT`, `CAMPAIGN_PROPOSAL`, `SEO_RECOMMENDATIONS`.
- `CRITICAL` — `OPTIMIZATION_RECOMMENDATION`. A task class never grants an AI response extra authority — Budget Guard and the Approval Center still gate every action an Optimization Agent recommendation can lead to, exactly as before the router existed (see [SECURITY.md](SECURITY.md) "Automation safety").

`TASK_CLASS_BY_JOB_TYPE` maps every `prompter_ai_jobs.job_type` to its class. The router then resolves which configured provider/model actually serves that class (`lib/ai/routing-config.ts#resolveRoute()`, a pure function, unit tested in `tests/unit/lib/ai-routing-config.test.ts`):

1. A per-class override (`AI_<CLASS>_PROVIDER` / `AI_<CLASS>_MODEL`), else
2. `AI_DEFAULT_PROVIDER`, else
3. whichever single provider actually has an API key configured (so a one-key setup needs zero routing config).

If the resolved primary provider's live call fails, and a distinct `AI_FALLBACK_PROVIDER` is configured, the router tries it once — never silently, never swallowing the original failure if the fallback isn't usable either. Which provider actually produced the result, its model, and whether a fallback occurred are all recorded on the `prompter_ai_jobs` row (`provider`, `model`, `fallback_provider`) — never fabricated, never assumed to be whichever provider was requested.

`AIRoutingNotConfiguredError` is thrown only when nothing at all is usable for a task class — `runAiJob()` catches this specifically and returns a plain "AI belum dikonfigurasi" state without ever creating a `prompter_ai_jobs` row, the same UX every AI feature had before the router existed. Any other thrown error means a real provider call was actually attempted and failed.

## Prompt construction

`lib/ai/prompts.ts` builds every prompt from the same two pieces: `buildSystemPreamble(brandProfile)` (tenant brand context — name, description, tone of voice, target market, prohibited claims — plus the guardrails below) and a feature-specific prompt builder (`buildMarketingBlueprintPrompt`, `buildCampaignProposalPrompt`, `buildContentPrompt`, `buildSeoRecommendationsPrompt`) that describes the product/website and the user's specific inputs. No feature builds its own ad-hoc prompt string outside this file.

## Agent architecture (deterministic, not an autonomous loop)

The product spec names eleven agent roles (`MarketingOrchestrator`, `ProductIntelligenceAgent`, `StrategyAgent`, `CopywriterAgent`, `CreativeAgent`, `SocialAgent`, `AdsAgent`, `SEOAgent`, `AnalyticsAgent`, `OptimizationAgent`, `GrowthAgent`). Phase 1 implements the first three as single structured-output calls (blueprint generation, campaign proposal generation, content generation); Phase 5 adds a fourth, `SEOAgent` (SEO recommendation generation); Phase 7 adds two more, `AnalyticsAgent` (analytics insight generation) and `OptimizationAgent` (optimization recommendation generation) — all deterministic request → validated response, no open-ended tool access, no autonomous loop. `GrowthAgent` remains unbuilt — Growth tracking (Phase 5) is honest manual entry, not an AI-driven agent. Later phases add more generation types the same way rather than introducing a different architecture.

## Autopilot (Phase 7)

Autopilot is a policy-gated *routing* decision, never an autonomous *execution* one — this app has no background scheduler, so nothing runs unattended. When `prompter_automation_settings.automation_mode = 'autopilot'` and the matching `prompter_autopilot_policies` row is enabled, an Optimization Agent recommendation is auto-submitted to the Approval Center (`features/campaigns/optimization-actions.ts#maybeAutoSubmitRecommendations()`) instead of waiting for a manual click — but it still lands as a pending `AUTOPILOT_ACTION` approval, and real execution against a connector only happens after an Owner clicks Approve (`features/approvals/actions.ts#executeAutopilotAction()`, which re-validates Emergency Stop, campaign status, and connector configuration fresh at that moment). See [SECURITY.md](SECURITY.md) "Automation safety" for the full list of boundaries Autopilot can never bypass.

## AI jobs

`prompter_ai_jobs` (see `docs/DATABASE.md`) tracks every generation request: `job_type`, `status` (`QUEUED`/`PROCESSING`/`COMPLETED`/`FAILED`), `provider` (which provider actually ran — `"openai"`/`"anthropic"`), `model`, `fallback_provider` (set only when a fallback was used), `error_category` (coarse, provider-agnostic), token counts, `estimated_cost`, `error`, `actor_user_id`, timestamps. `services/ai-jobs.ts#runAiJob()` wraps every call to the AI Router (`routeStructuredGeneration()`) — inserts the job row, updates it to `COMPLETED` with the real provider/model/token counts or `FAILED` with the error message and category afterward. No job is ever left stuck `QUEUED`; a request that reaches "nothing configured" never creates a row at all. `estimated_cost` is still not populated for any job type (needs per-model, per-provider pricing — remains open).

## Guardrails

`buildSystemPreamble()` instructs the model, on every call, not to:

- make misleading or unsupported claims (medical, financial guarantees, etc.)
- promote illegal products or violate common ad platform policies (Meta, TikTok, X)
- fabricate testimonials or false urgency/scarcity

and to surface (not silently drop) any claim risk it's unsure about — `MarketingBlueprintSchema.risks` exists specifically so the model has somewhere to put that, for human review.

AI output is a draft for human review, not an auto-published artifact. Campaign drafts stay `status = 'DRAFT'` through all of Phase 1 — nothing tells a user a campaign "berhasil tayang" (went live), because nothing publishes yet.

## Demo data

Any AI insight or metric shown without real underlying data must be visibly labeled `DEMO`. The dashboard's "Tanyopo Intelligence" card (`features/dashboard/ai-insight-card.tsx`) still always renders its real empty state — Phase 1 added product/campaign/content generation, not an analytics pipeline, so there's still no real insight to show yet.

## Current state

Two providers are implemented — OpenAI and Anthropic — routed through the Tanyopo AI Router rather than hard-coded per feature. Marketing Blueprint generation, Promote Wizard campaign proposals, Content Studio generation, SEO recommendation generation, Analytics Agent insights, and Optimization Agent recommendations are all live end-to-end once at least one of `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` is configured (and, for OpenAI, a model — see "AI Router" above). Neither key is set in this repository's own environments by default; live generation against a real provider has not been exercised in this codebase (see [ROADMAP.md](ROADMAP.md) and [SECURITY.md](SECURITY.md) for what "live-verified" actually means here). Image generation/analysis, `GrowthAgent`, `MarketingOrchestrator` as a distinct orchestration layer (today each generation type is invoked directly, not routed through a separate orchestrator agent), and cost estimation are not yet built.
