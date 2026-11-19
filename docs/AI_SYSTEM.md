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
- `lib/ai/openai-provider.ts` — via the official `openai` SDK's Responses API (`client.responses.parse()` with `zodTextFormat()` for structured output). Unlike Anthropic, OpenAI has **no hardcoded default model** in this codebase, so every OpenAI-routed call needs a model from configuration (`AI_OPENAI_DEFAULT_MODEL` or a per-class `AI_<CLASS>_MODEL`); a route that resolves to OpenAI with no model configured is treated as unusable rather than guessing an id that might not exist. `gpt-5.4-mini` is the verified production default — confirmed live on 2026-09-01 via `models.retrieve()` and a real `client.responses.parse()` structured-output call through this exact code path — see `.env.example`.

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

`prompter_ai_jobs` (see `docs/DATABASE.md`) tracks every generation request: `job_type`, `status` (`QUEUED`/`PROCESSING`/`COMPLETED`/`FAILED`), `provider` (which provider actually ran — `"openai"`/`"anthropic"`), `model`, `fallback_provider` (set only when a fallback was used), `error_category` (coarse, provider-agnostic), token counts, `estimated_cost`, `error`, `actor_user_id`, timestamps. `services/ai-jobs.ts#runAiJob()` wraps every call to the AI Router (`routeStructuredGeneration()`) — the quota RPC inserts the job row as `PROCESSING`, then it is closed as `COMPLETED` with the real provider/model/token counts or `FAILED` with a user-safe message and category. A request that reaches "nothing configured" never creates a row at all.

Failure handling (unit tests: `tests/unit/services/ai-jobs-failsafe.test.ts`, `tests/unit/lib/ai-provider-http-errors.test.ts`):

- Only `AIProviderError` text is shown to tenants or stored in `error`. Any other error (Zod/JSON parse errors, SDK or runtime errors) is replaced by a generic message; `AUTH`/`CONFIG` get a neutral "layanan tidak tersedia" text (the adapter text names environment variables). The category is still stored for operators.
- Closing the job tries the caller's client, then retries once through the server-only admin client (tenant + id + `PROCESSING`), so one failed bookkeeping write does not leave a paid job in `PROCESSING` or turn a successful generation into a reported failure.
- Retry policy (`lib/ai/resilience.ts`): one retry for `RATE_LIMIT` (429), `CONNECTION` (incl. our own 45 s timeout) and vendor 5xx (incl. 529); never for `AUTH`, `REFUSAL`, `INVALID_OUTPUT`, `CONFIG` or a 4xx.

Cost bound per quota unit: at most 2 attempts on the primary provider plus 2 on the fallback = 4 paid provider calls, each capped at 4000 output tokens (`DEFAULT_MAX_TOKENS` / `DEFAULT_MAX_OUTPUT_TOKENS`) and 45 s, i.e. up to about 3 minutes in the worst case. The quota counts job rows, including `FAILED` ones.

`estimated_cost` is written by `recordEstimatedCost()` (admin client, `COMPLETED` rows only) but `AI_MODEL_PRICING` in `lib/ai/pricing.ts` is still empty on purpose, so it stays `NULL` until someone copies the prices of the models actually in use from the providers' official pricing pages. Known gaps (need Founder approval or infrastructure, not code in this module): no reaper for jobs stuck in `PROCESSING` after a platform timeout, no usage alert, no idempotency key for double submits.

## Guardrails

`buildSystemPreamble()` instructs the model, on every call, not to:

- make misleading or unsupported claims (medical, financial guarantees, etc.)
- promote illegal products or violate common ad platform policies (Meta, TikTok, X)
- fabricate testimonials or false urgency/scarcity

and to surface (not silently drop) any claim risk it's unsure about — `MarketingBlueprintSchema.risks` exists specifically so the model has somewhere to put that, for human review.

AI output is a draft for human review, not an auto-published artifact. Campaign drafts stay `status = 'DRAFT'` through all of Phase 1 — nothing tells a user a campaign "berhasil tayang" (went live), because nothing publishes yet.

## Quality Gate (campaign proposals)

`lib/ai/campaign-quality-gate.ts` is a pure, rule-based check of a stored campaign proposal. It makes no model call and costs no quota. A PASS means only "none of these rules fired"; it is not a statement that an ad is good or compliant with any platform's policy.

**Blocking rules (severity `block`).** In addition to the earlier rules (`GUARANTEED_RESULT`, `NUMERIC_RESULT_PROMISE`, `URL_IN_COPY`, `PHONE_IN_COPY`, `TRANSACTION_IN_SIMULATION`), PR-5 adds:

- `FINANCIAL_CLAIM` (dimension `claim_risk`): offer and promise phrases only: fast loans/credit, investment offers or promises ("investasi ... pasti untung", "mulai berinvestasi", trading crypto/forex), "cepat kaya", "passive income", "modal kecil untung besar", "pasti cuan/profit", "bebas riba". A bare "investasi", "saham" or "invest" does not fire ("investasi jangka panjang" on a wall paint, "beli saham cokelat").
- `SPECIAL_CATEGORY` (dimension `ad_policy`): offer phrases for credit/loan/leasing/KPR, job openings ("lowongan kerja", "we're hiring", "sedang merekrut"; "melamar kerja sama" is excluded), rental/property listings, and elections/political campaigning. The message is platform-neutral: many ad platforms (Meta is one) require a special-category declaration and LINOE does not support it yet, so ads in these categories stay blocked until it does.
- `SPECIAL_CATEGORY_HINT` (`warn`): a single ambiguous word ("pinjaman", "perumahan", "rekrutmen", "politik", ...) that is not an offer phrase. Reviewer decides; it never blocks and is not reported when a `SPECIAL_CATEGORY` block matched the same text.

Neither blocking rule is excused by the same words appearing in the product description (that exemption still applies to proof/claim warnings such as `MEDICAL_CLAIM`, which is still a warning). The rules are word-boundary phrase patterns and are only a heuristic.

Residual false negatives: spelling tricks and paraphrases are not caught ("c e p a t k a y a", "inv3stasi", leetspeak, synonyms, text inside images). Residual false positives are possible on legitimate offer phrases (for example an HR-software ad that says "lowongan kerja"). `hasBlockingIssue(result)`, `blockingIssues(result)`, `formatBlockingIssuesMessage(result)` and `scanRawProposalCopy(raw)` are exported helpers.

**Enforcement on the server covers the ACTIVE copy only.** The launch reads `proposal.headline`, `proposal.primary_text` and `proposal.cta` (the preview also shows `hook`); `updateCampaignCopyAction` edits exactly these top-level fields, while `selectCandidate` only swaps which candidate is copied into them. The campaign page still shows findings for all three candidates plus the active copy as advice (`copyScope: "all"`). `submitForApprovalAction` (`features/campaigns/actions.ts`) re-evaluates with `copyScope: "active"`, with the same inputs as the page (parsed `ai_proposal`, product name, product description as known facts), after the budget checks and before any approval row is written. A blocking issue in the active copy returns an Indonesian message (what was found, revise the copy or regenerate the strategy, submit again); no approval is created and the status does not change. A problem confined to an alternative candidate does not block, so the owner can never be locked out by text they cannot edit. A stored proposal that does not parse (legacy) is "cannot be assessed" like on the page, except that its known active strings (`hook`, `headline`, `cta`, `primary_text`) are scanned for `FINANCIAL_CLAIM` and `SPECIAL_CATEGORY` only. If the product cannot be read, nothing is submitted and the user is asked to retry.

**Proposal fields added in PR-5.** `objective_recommendation`, `audience` (countries as ISO codes, age range, `advantage_plus`, `interest_suggestions_text` as plain keyword text only; there is no field for Meta interest IDs and the objects are strict), `missing_facts`, and `test_plan` (recommended copy variants and a minimum number of days; no performance numbers). They are optional in `CampaignProposalSchema`, so older stored proposals stay valid, and required-nullable in `CampaignProposalGenerationSchema`, which is what the AI is asked to fill (the providers' structured outputs reject `.optional()`). The generation schema has no refinements or numeric bounds on the audience, so a slip cannot fail the whole generation; `normalizeProposalAdditions()` repairs the output in code before saving (swaps inverted ages, clamps to 13-65, keeps two-letter country codes, drops numeric "interests", trims lists), and the stored schema stays strict. They are advice for the reviewer; nothing in them is sent to an ad platform. The prompt still makes a single `CAMPAIGN_PROPOSAL` call.

**Optimization data thresholds.** `generateOptimizationRecommendationsAction` reads impressions, clicks, reach and date from `prompter_marketing_metrics`, computes CTR and CPC in code (never by the model), and, before creating an AI job, requires analysable data. A channel is analysable with enough delivery data, or with no delivery data at all (no impressions) but some spend or conversions (the pre-threshold behaviour is kept). Only when no channel is analysable does it return "Data belum cukup" and use no AI quota. After the AI answers, `INCREASE_BUDGET` becomes `NO_ACTION` for any channel below the thresholds. `submitRecommendationAsApprovalAction` re-checks the same thresholds for `INCREASE_BUDGET` (fail closed if the metrics cannot be read), so a stored or forged recommendation cannot bypass them; `DECREASE_BUDGET` and `PAUSE_CHANNEL` are not click-based and are not checked.

UNVERIFIED: the thresholds (at least 3 days with delivery, at least 1000 impressions, at least 100 clicks for click-based actions) are proposed starting values ("usulan, belum divalidasi"), set in `lib/campaigns/optimization-data-sufficiency.ts`. They are not derived from Meta documentation or from LINOE data and need founder review.

## Demo data

Any AI insight or metric shown without real underlying data must be visibly labeled `DEMO`. The dashboard's "Tanyopo Intelligence" card (`features/dashboard/ai-insight-card.tsx`) still always renders its real empty state — Phase 1 added product/campaign/content generation, not an analytics pipeline, so there's still no real insight to show yet.

## Current state

Two providers are implemented — OpenAI and Anthropic — routed through the Tanyopo AI Router rather than hard-coded per feature. Marketing Blueprint generation, Promote Wizard campaign proposals, Content Studio generation, SEO recommendation generation, Analytics Agent insights, and Optimization Agent recommendations are all live end-to-end once at least one of `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` is configured (and, for OpenAI, a model — see "AI Router" above). Neither key is set in this repository's own environments by default; live generation against a real provider has not been exercised in this codebase (see [ROADMAP.md](ROADMAP.md) and [SECURITY.md](SECURITY.md) for what "live-verified" actually means here). Image generation/analysis, `GrowthAgent`, `MarketingOrchestrator` as a distinct orchestration layer (today each generation type is invoked directly, not routed through a separate orchestrator agent), and cost estimation are not yet built.
