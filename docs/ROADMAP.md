# Roadmap

Development proceeds phase by phase. A phase is not started until the previous one is verified stable (lint/typecheck/test/build passing, migrations applied cleanly). This file is the source of truth for "what phase are we in."

## Phase 0 — Foundation ✅

- Repository structure, Next.js 16 + TypeScript + Tailwind v4
- Supabase client/server/admin architecture
- Database migration foundation (`prompter_brand_profiles`, `prompter_automation_settings`, `prompter_audit_logs`) + RLS, reusing UMKMpro AI's shared tenant identity
- Auth (email + password) and multi-tenant session context
- Onboarding wizard
- Application shell (sidebar, all nav destinations routed) + design system
- Landing page
- Docs, `.env.example`, CI (lint/typecheck/test/build)

## Phase 1 — Core Promoter ✅

- `prompter_products`, `prompter_product_media`, `prompter_marketing_blueprints`, `prompter_ai_jobs`, `prompter_master_campaigns`, `prompter_content_items` + RLS; Storage buckets `product-media` (in use), `creative-assets`/`brand-assets`/`generated-content` (reserved for later phases)
- AI provider abstraction (`lib/ai/provider.ts`) with an Anthropic implementation (`lib/ai/anthropic-provider.ts`, Claude Opus 5 via `client.messages.parse` + Zod structured output) — resolves to `NOT_CONFIGURED` when `AI_PROVIDER_API_KEY` is unset, never fabricates output
- Every AI generation call is wrapped in a `prompter_ai_jobs` row (`services/ai-jobs.ts`) — QUEUED→PROCESSING→COMPLETED/FAILED, token counts, cost observability foundation
- Products: list, create, edit, media upload to `product-media`
- Marketing Blueprint generation on the product detail page (`MarketingBlueprintSchema`)
- Promote Wizard (`/promote`): pick product → goal → channels → target → budget → AI campaign proposal (`CampaignProposalSchema`) → saved as a `DRAFT` `prompter_master_campaigns` row
- Campaigns: real list + detail (regenerate proposal, edit headline/primary text/CTA, delete draft) — status stays `DRAFT` in Phase 1, no live publishing (that's Phase 2/3)
- Content Studio (`/content`): AI content generator (`ContentGenerationSchema`) + a content library list

**Known Phase 1 simplifications** (kept deliberately small in scope, not hidden):
- Promote Wizard requires an existing product — no inline "create product" sub-step (use `/products/new` first)
- Products list has no grid/list view toggle (grid only)
- Campaign copy editing covers headline/primary text/CTA only, not the full proposal
- `budget_allocation` percentages are AI-generated and not validated to sum to exactly 100

## Phase 2 — Marketing Operations ✅

- `prompter_channel_campaigns` (per-platform rows under a master campaign, materialized from `channels` + the AI proposal's `budget_allocation`), `prompter_budget_policies`, `prompter_approvals`, `prompter_marketing_metrics`, `prompter_conversions`, `prompter_attributions` + RLS
- Budget Guard (`services/budget-guard.ts`): a campaign whose `daily_budget`/`total_budget` exceeds the tenant's `daily_limit`/`campaign_limit` is **rejected outright** on submission — it never reaches the Approval Center as a request that would just get rejected there
- Campaign status machine: `DRAFT` → (submit, passes Budget Guard) → `AWAITING_APPROVAL` → (Owner decides) → `SCHEDULED` or back to `DRAFT`. **No code path in this app ever sets `ACTIVE`** — that only happens once a real connector (Phase 3+) confirms the campaign is live on the platform
- Approval Center (`/approvals`): pending queue + history, Owner-only Approve/Reject (RLS-enforced, not just UI-gated), campaign owner/submitter can cancel a pending submission back to `DRAFT`
- Budget Guard settings card in `/settings` (Owner-only edit; other roles see it read-only)
- Campaign detail: per-channel breakdown table, submit-for-approval action, editing/regenerating locked to `DRAFT` status only
- Analytics (`/analytics`): honest empty state for `prompter_marketing_metrics` (nothing writes to it until a Phase 3+ connector exists) + manual conversion logging against `prompter_conversions` (a business owner recording a sale they know came from a campaign)
- Audit log (`prompter_audit_logs`) now records `campaign.submitted_for_approval`, `campaign.approved`, `campaign.launch_rejected`, `budget_policy.updated` — alongside Phase 0's `onboarding.completed`

**Known Phase 2 simplifications:**
- `prompter_attributions` now gets a single-touch row (`services/attribution.ts`) whenever a conversion is recorded with a known campaign link — `MANUAL` for the manual-entry form, `UMKMPRO_VERIFIED` for UMKMpro AI's conversions feed. A conversion recorded with no campaign link stays unattributed (never guessed). True multi-touch/weighted models are still future work — this only ever writes one 100%-weight row per conversion.
- Approval Center only handles `CAMPAIGN_LAUNCH`; the other approval types in the schema (`BUDGET_CHANGE`, `CAMPAIGN_SCALE`, `CONTENT_PUBLISH`, `AUTOPILOT_ACTION`) have no feature behind them yet
- Conversions are manual-entry only — no ad-platform conversion API or UMKMpro conversion bridge (Phase 4)
- Budget Guard checks `daily_limit`, `campaign_limit`, and `monthly_limit` (the last as a projection — real month-to-date `prompter_marketing_metrics` spend plus this campaign's remaining-month contribution, vs. the limit); `require_approval_above` and `autopilot_limit` are stored but not yet enforced. There is still no per-platform limit — `prompter_budget_policies` has no platform-scoped columns, a real gap against the product spec's "per-platform limits" requirement, and would need a schema migration to add.

## Phase 3 — Meta Foundation ✅ (this delivery)

- `prompter_platform_capabilities` (global, seeded, read-only from the app), `prompter_connected_accounts` (metadata, owner-only), `prompter_oauth_credentials` (encrypted tokens, RLS enabled with zero app-level policies — service-role only) + a small follow-up migration adding `prompter_channel_campaigns.error`
- Token encryption (`lib/crypto/token-cipher.ts`, AES-256-GCM, `TOKEN_ENCRYPTION_KEY`)
- `PlatformConnector` interface (`lib/connectors/types.ts`) + `MetaConnector` (`lib/connectors/meta-connector.ts`) implementing `connect`/`disconnect`/`getAccounts`/`createCampaign`/`createAdSet`/`createCreative`/`createAd`/`getInsights`/`pauseCampaign`/`updateBudget` against the real Meta Marketing API v21.0 — every write leaves the object `PAUSED`. `getConnector()` returns `null` for TikTok/X (no implementation yet, Phase 6)
- Meta OAuth flow (`/api/connections/meta/authorize` + `/callback`): CSRF state cookie, code → short-lived → long-lived token exchange, scope verification, ad account fetch, encrypted storage via the service-role client
- Connection Center (`/connections`): honest per-platform status (`CONNECTED`/`NOT_CONNECTED`/`EXPIRED`/`NOT_CONFIGURED`/`NOT_AVAILABLE`) for Facebook & Instagram (Meta), TikTok, X, Website, UMKMpro AI — Connect/Disconnect owner-gated at both the route and RLS layers
- Campaign launch capstone (`features/campaigns/launch-actions.ts`): the one code path that sets `prompter_channel_campaigns.status = 'ACTIVE'`, and only once Meta's own API confirms the campaign/ad set/creative/ad were created; a failure is stored on the row's `error` column, never silently dropped
- Audit log now also records `connection.connected`, `connection.disconnected`, `campaign.launched`, `campaign.launch_failed`

**Known Phase 3 simplifications / honesty notes:**
- **Unverified against a live ad account.** This environment has neither Meta credentials nor network access to `graph.facebook.com` — the connector's request/response shapes follow the documented Marketing API v21.0 contracts but haven't been exercised end-to-end. Treat it as a first implementation to verify, not battle-tested code.
- `createCreative` requires a Facebook Page ID and there's no Page-picker UI yet, so the launch flow reaches that step and stops there with a clear stored error — full ad creation isn't reachable today even with real credentials, until Page selection is built.
- Location targeting on launch defaults to Indonesia (`["ID"]`) — no country picker/geocoding from the campaign's free-text `target_country` field yet.
- Budget is passed to Meta assuming no currency minor-unit multiplier (true for IDR) — a cents-based ad account currency would need adjusting.
- One ad account per tenant per platform is auto-selected (the first one returned) — no "switch ad account" UI.
- `getInsights`, `pauseCampaign`, `updateBudget` are implemented on the connector but have no UI wired to them yet.

## Phase 4 — UMKMpro Integration ✅ (this delivery)

- `prompter_product_snapshots` (append-only), `prompter_promotion_handoffs`, `prompter_webhook_events` + RLS; `prompter_products` gains `unique(tenant_id, source_system, source_product_id)` for safe upsert; `prompter_conversions` gains `external_event_id` + `unique(tenant_id, source, external_event_id)` for idempotent externally-pushed events
- Signed service authentication (`lib/umkmpro/signature.ts` + `lib/umkmpro/auth.ts`): HMAC-SHA256 over `${timestamp}.${rawBody}`, keyed by `UMKMPRO_SERVICE_TOKEN`, constant-time comparison, 5-minute freshness window
- Best-effort in-memory rate limiting (`lib/rate-limit.ts`) and the shared `{ data, error, meta }` API response envelope (`lib/api/response.ts`), product spec §71-72
- `/api/v1/integrations/umkmpro/{products,promotions,conversions,webhooks}` (`services/umkmpro.ts` is the data-access layer): product sync + append-only snapshot, one-time promotion handoff (idempotent on a caller-supplied key), conversion recording (idempotent upsert), generic idempotent webhook receipt log
- `/promote?handoff=<id>` resolves a handoff via the normal session-scoped client (RLS is the tenant-isolation check, not extra application code), marks it `CONSUMED`, and preselects the product in the Promote Wizard
- Fixed two pre-existing bugs required for the handoff flow to survive an unauthenticated visit: `proxy.ts` now preserves the full query string (not just the path) in the post-login `next` redirect, and `loginAction` now honors a validated `next` param instead of always redirecting to `/dashboard`
- Profit-aware marketing estimate (product spec §49) on the product detail Analytics tab: revenue (from `PURCHASE` conversions) − COGS (product `hpp` × units) − ad spend, clearly labeled as an estimate, `null` (not `Rp 0`) when `hpp` isn't set
- Audit log now also records `umkmpro.product_synced`, `umkmpro.promotion_handoff_created`, `umkmpro.conversion_recorded`

**Known Phase 4 simplifications / honesty notes:**
- **The signed-authentication layer was verified against a real running local server in this environment; the database write path was not.** `SUPABASE_SECRET_KEY` isn't obtainable through the Supabase MCP server used in this session (by design — it only exposes publishable keys), so `/api/v1/integrations/umkmpro/*` could be exercised end-to-end for its auth/rate-limit layer (missing signature, wrong secret, stale timestamp all correctly rejected with `401`; a correctly-signed request correctly fails closed with `503 NOT_CONFIGURED` rather than crashing or faking success) but not for an actual database write. Treat `services/umkmpro.ts`'s upsert/idempotency logic as implemented and unit-testable in isolation, not as verified against a live Postgres instance — the next person with the real service-role key should re-run the same signed-request flow and confirm the resulting rows.
- The webhook endpoint is a pure, idempotent receipt log — it does not dispatch to any further processing based on `eventType`. A concrete need (e.g. "act on `product.deleted`") should get its own explicit handling, not a generic dispatcher built ahead of a real use case.
- A first-time UMKMpro user who hasn't completed Promoter's own `/onboarding` yet loses the in-flight handoff during that detour (see [INTEGRATIONS.md](INTEGRATIONS.md) "Consuming a handoff") — the link will most likely have expired (30 minutes) by the time onboarding finishes.
- The profit estimate assumes one unit sold per `PURCHASE` conversion — there's no line-item/quantity field on a conversion yet, so a multi-unit order recorded as a single conversion undercounts units sold (and so understates COGS).
- Rate limiting is process-local (see [SECURITY.md](SECURITY.md)) — real but not multi-instance-safe.

## Phase 5 — Growth + SEO ✅ (this delivery)

- `prompter_growth_goals`, `prompter_follower_snapshots` + RLS — a per-platform follower target and manually-logged follower count history. No bot, no purchased followers, no fake engagement anywhere in this app — `/growth` (`lib/growth-progress.ts` for the pure progress-bar math) shows an honest "belum ada data" when no snapshot has been logged yet, never a fabricated 0%.
- `prompter_seo_projects`, `prompter_seo_recommendations` + RLS — a project per website, AI-generated on-page recommendations, refined keyword suggestions, and a content plan (`schemas/ai/seo-recommendations.ts`, `services` follow the same `runAiJob()`/`prompter_ai_jobs` bookkeeping as every other AI feature). `/seo` (list + create) and `/seo/[id]` (detail + generate). **Honesty note surfaced directly in the UI:** the AI cannot actually crawl or audit the target website — recommendations are reasoned from the URL, the user's own target keywords, and brand context, not a real page inspection.
- Content calendar: `prompter_content_items.scheduled_at` (nullable timestamptz) + a "Kalender" tab on `/content` grouping items by date, alongside the existing "Perpustakaan" list. Scheduling a `DRAFT` item moves it to `SCHEDULED`; clearing the date reverts it to `DRAFT`.
- `prompter_ai_jobs.job_type` gains `SEO_RECOMMENDATIONS` — a fourth deterministic structured-output generation type (`SEOAgent`, per the product spec's agent list), following the same architecture as the other three (Marketing Blueprint, Campaign Proposal, Content Generation).

**Known Phase 5 simplifications / honesty notes:**
- Follower counts are entirely manual entry — no platform in this codebase has an organic-follower-count read API wired up (Meta's Marketing API, used for ads elsewhere in this app, doesn't expose that). `prompter_follower_snapshots.source` is schema-ready (`'manual'` today) for a future real integration, but no such integration exists yet.
- SEO recommendations are AI reasoning from a URL and user-provided context, explicitly not a real crawl/audit — no site-fetching code exists in this app. The UI and prompt both say so rather than implying the AI actually visited the page.
- The content calendar is a grouped chronological list, not a month-grid calendar widget — consistent with this app's no-external-component-library approach (no charting/calendar library is a dependency). A date-only granularity (no time-of-day) is enough for "what's planned when," which is what the feature is for.
- No feature (Growth or SEO) is wired to anything outside this app — Growth doesn't read a Meta/TikTok/X follower count via API, and SEO doesn't submit anything to Search Console or a real crawler. Both are honestly scoped to what a tenant records/asks for themselves.
- **Not exercised in an authenticated browser session.** This environment has no test-user credentials for the shared production Supabase project, and creating one there wasn't done unilaterally (it's real, shared data — see [DATABASE.md](DATABASE.md) on why this app doesn't own that project). Verification for Phase 5 is lint/typecheck/unit tests/production build only — the same bar as Phases 0-3. Someone with real credentials should click through `/growth` and `/seo` once before calling this battle-tested.

## Phase 6 — TikTok + X ✅ (this delivery)

- `lib/connectors/tiktok-connector.ts` (TikTok for Business Marketing API v1.3) and `lib/connectors/x-connector.ts` (X Ads API v12) — both implement the full `PlatformConnector` interface, following the same "throw `ConnectorConfigError` at a real missing prerequisite, never fake success" discipline as the Meta connector.
- The `PlatformConnector` interface itself gained `adAccountId` on `getInsights`/`pauseCampaign`/`updateBudget` (previously create*-only) — a real fix, not a TikTok/X-only workaround, since neither platform's objects are globally addressable by id alone the way Meta's Graph API objects are. Safe change: nothing called these three methods yet (Phase 3's own "known simplification" noted they had no UI wired up).
- Shared OAuth route helpers (`lib/connectors/oauth-authorize.ts`, `lib/connectors/oauth-callback.ts`) extracted from the Meta-only route handlers once three platforms needed the identical authorize/callback flow — Meta's own routes were refactored onto them too (no behavior change), so there's one implementation of a security-sensitive flow instead of three copies.
- `/api/connections/{tiktok,x}/{authorize,callback}` routes, wired the same way as Meta's.
- `/connections` (Connection Center) now renders real Connect/Disconnect flows for TikTok and X — replacing their `NOT_AVAILABLE` placeholder cards — via a shared `ConnectorCard` component (previously Meta's card markup was hand-written inline; extracted once two more platforms needed the identical structure).
- `features/campaigns/launch-actions.ts` now resolves TikTok/X channels too, with a per-platform `OBJECTIVE_MAP` translating `PrimaryGoal` into each platform's own objective vocabulary instead of assuming Meta's `OUTCOME_*` names apply everywhere.
- `prompter_platform_capabilities` updated (no schema change, just data) — every TikTok/X capability that now has real code is `enabled=true`, each with a `notes` value naming its specific remaining gap rather than presenting a false "fully working" status.

**Known Phase 6 simplifications / honesty notes** (see [INTEGRATIONS.md](INTEGRATIONS.md) for the full per-platform breakdown):
- **Unverified against a live account, for all three platforms.** This environment has no credentials or network access for Meta, TikTok, or X's APIs. Every connector follows documented API contracts as closely as possible but should be treated as a first implementation to verify, not battle-tested code — the same posture Meta's own connector has carried since Phase 3.
- **No verified location-catalog mapping for TikTok or X.** Both platforms target by their own numeric location ids, not ISO country codes. Rather than guess a number and risk silently spending real budget on the wrong location, `createAdSet` throws `ConnectorConfigError` for both — the real campaign-launch flow for TikTok/X stops one step earlier than Meta's (which at least reaches the creative step) as a direct, honest consequence.
- **X has no PKCE on its OAuth2 flow.** X's documentation states `code_challenge` is required for every client type; this connector sends plain Authorization Code. The authorization request will likely be rejected by X until that's added — deferred rather than guessed at, since adding it correctly means threading a `code_verifier` through the shared callback handler that Meta/TikTok would then have to ignore, and this environment has no way to verify the fix against a real X app.
- **No asset-upload or tweet-composition flow.** TikTok ad creatives need an already-uploaded video/image; X Promoted Tweets need an existing tweet. Neither exists in this app, so both connectors' `createCreative` throws a clear, named error rather than fabricating a creative.
- **X's funding instrument is auto-selected** (the account's first one, no picker UI) — the same simplification already applied to ad-account selection across every connector, not a new one.
- **`getInsights`/`pauseCampaign`/`updateBudget` remain unwired to any UI** for all three platforms, same as Phase 3 — the interface fix (adding `adAccountId`) makes them callable correctly whenever that UI gets built, but nothing calls them yet.

## Phase 7 — Advanced AI ✅ (this delivery)

- `prompter_analytics_insights`, `prompter_optimization_recommendations`, `prompter_autopilot_policies` + RLS; `prompter_ai_jobs.job_type` gains `ANALYTICS_INSIGHT`, `OPTIMIZATION_RECOMMENDATION`
- Metrics sync (`features/campaigns/sync-insights-actions.ts`): wires `connector.getInsights()` into `prompter_marketing_metrics` for the first time — an owner/marketing user on an `ACTIVE` channel campaign can pull real spend/impressions/clicks/conversions from the connected platform and upsert them (`unique(channel_campaign_id, date)`), replacing the "nothing ever writes here" state Phases 3-6 left behind
- Analytics Agent (`AnalyticsInsightSchema`, `features/analytics/actions.ts#generateAnalyticsInsightAction()`): summarizes real `prompter_marketing_metrics`/`prompter_conversions` data per tenant into `prompter_analytics_insights` (trends, top channel, underperforming channels, risks). Refuses to call the AI provider at all when the tenant has zero metrics and zero conversions — never fabricates an insight from nothing. Rendered on `/dashboard` (Tanyopo Intelligence card) and `/analytics`
- Optimization Agent (`OptimizationRecommendationSchema`, `features/campaigns/optimization-actions.ts#generateOptimizationRecommendationsAction()`): per-channel recommendation (`INCREASE_BUDGET`/`DECREASE_BUDGET`/`PAUSE_CHANNEL`/`NO_ACTION`) for a master campaign, computed from real per-channel spend/conversions/revenue and each channel's estimated marketing contribution (`lib/profit-estimate.ts`) — explicitly instructed, in both prompt and schema field description, to reason about contribution margin rather than ROAS alone, and to never fabricate a channel's numbers. Refuses when the campaign has no channel data
- Cross-channel intelligence: both agents work from whatever real data actually exists across Facebook/Instagram/TikTok/X/SEO channels for a tenant — a channel with no metrics simply doesn't appear in the comparison, never a guessed placeholder
- Profit-aware marketing labeling: every user-facing surface (product detail Analytics tab, Optimization Agent prompt/output) now says "Estimasi Kontribusi Marketing," never "profit"/"laba bersih" — explicitly not net profit, since other operating expenses aren't included. `lib/profit-estimate.ts#computeProfitEstimate()`'s calculation is unchanged (revenue − COGS − ad spend); only the label and documentation were corrected
- Approval-gated execution (`features/approvals/actions.ts#executeAutopilotAction()`): once an Owner clicks Approve on an `AUTOPILOT_ACTION` approval, it re-validates — fresh, at execution time, not trusting state from when the recommendation was generated — Emergency Stop, the channel campaign's `ACTIVE` status, the connector's configuration, and the connected account's status, then calls the real `connector.pauseCampaign()`/`connector.updateBudget()`. A failure is caught and recorded as a note on the approval, never silently swallowed or reported as success
- Autopilot policies (`prompter_autopilot_policies`: `AUTO_PAUSE_UNDERPERFORMING`/`AUTO_PROPOSE_BUDGET_REALLOCATION`, toggled in `/settings`): when `automation_mode = 'autopilot'` and the matching policy is enabled, a generated recommendation is auto-routed straight to the Approval Center instead of waiting for a manual "submit" click — `lib/autopilot-policy.ts#policyTypeForAction()` (unit tested) does the pure mapping. Auto-routing still goes through the same `submitRecommendationCore()` as a manual submission: Budget Guard is checked **before** the approval row is even created, and nothing executes until an Owner approves
- Automation & Autopilot settings UI (`/settings`): automation mode (Manual/AI Assist/Autopilot), Emergency Stop toggle (with an active-state banner showing who/when/why), and per-policy enable toggles (disabled unless mode is Autopilot) — `features/settings/actions.ts` enforces owner-only writes at the app layer and logs every mode/policy/emergency-stop change to `prompter_audit_logs`
- Every AI action in Phase 7 is fully audited: recommendation content, rationale, data used, requested action, risk level, approval requirement and status, execution status, and the connector's own response/error where applicable — via `prompter_ai_jobs`, `prompter_approvals.context`, and `prompter_audit_logs` (`metrics.synced`, `autopilot_action.blocked_emergency_stop`, `autopilot_action.executed`, `autopilot_action.execution_failed`, `autopilot_policy.auto_submitted`, `optimization.recommendation_submitted`, `automation_mode.updated`, `emergency_stop.toggled`, `autopilot_policy.updated`), each with `actor_user_id` populated

**Phase 6 gap fixed (found during Phase 7 work):** the campaign detail page's launch button was gated on a hard-coded `Set(["FACEBOOK", "INSTAGRAM", "TIKTOK", "X"])` rather than actual capability/connection state, meaning a channel could show as launchable even without a configured connector or `CREATE_AD` capability. Replaced with `resolveLaunchability()` (`app/(app)/campaigns/[id]/page.tsx`), which checks the connector exists, `prompter_platform_capabilities.CREATE_AD` is enabled, `connector.isConfigured()`, and a `CONNECTED` row in `prompter_connected_accounts` — a channel that fails any check shows the specific reason instead of a launch button, never a silent hide or a fake "launchable."

**Known Phase 7 simplifications / honesty notes:**
- **No autonomous background execution.** This app has no cron/job scheduler. "Autopilot" here means: a human opens a campaign and triggers the Optimization Agent, and — only if Autopilot mode and the matching policy are enabled — the resulting recommendation is auto-routed to the Approval Center instead of requiring a manual "submit" click. Actual execution against a real ad platform still always requires an Owner's explicit Approve decision; nothing in this app ever executes unattended.
- **Unverified against live ad accounts**, same caveat as every connector since Phase 3 — `executeAutopilotAction()`'s `pauseCampaign()`/`updateBudget()` calls follow the documented connector interface but haven't been exercised against a real Meta/TikTok/X account.
- `estimated_cost` on `prompter_ai_jobs` is still not populated for the two new job types (`ANALYTICS_INSIGHT`, `OPTIMIZATION_RECOMMENDATION`) — same pre-existing gap noted in [AI_SYSTEM.md](AI_SYSTEM.md) since Phase 1.
- Cross-channel comparison is presented as per-channel rows within a single Analytics Insight / Optimization Recommendation, not a dedicated side-by-side comparison widget — the data itself is real and channel-honest, but there's no new chart/table component built specifically for "compare channel A vs B" beyond what the AI's own summary/rationale text says.

## Architecture correction — shared Supabase confirmation + multi-provider AI (post-Phase 7)

Not a phase — a hardening pass over already-complete Phase 0-7 work, requested explicitly as a correction rather than new functionality. Two parts:

1. **Shared Supabase architecture, confirmed not rebuilt.** Verified (read-only discovery against the live shared project, see [DATABASE.md](DATABASE.md) "Data access boundary") that Promoter already used the single shared Supabase project since Phase 0, already reused `tenants`/`user_profiles` as its tenant/membership model with no duplicate `organizations` schema, and never queries any of UMKMpro's ~79 operational tables directly — every access to UMKMpro data goes through the signed `/api/v1/integrations/umkmpro/*` API into Promoter's own `prompter_*` mirror/snapshot tables. No schema or application change was needed here; this was already the architecture.
2. **Multi-provider AI Router.** `lib/ai/router.ts` replaces the single-provider `getAIProvider()` (retired) — every feature now declares a task class (`FAST`/`STANDARD`/`STRATEGY`/`CRITICAL`, `lib/ai/task-classes.ts`) instead of getting a hard-coded Anthropic instance. Added `lib/ai/openai-provider.ts` (OpenAI Responses API) alongside the existing `lib/ai/anthropic-provider.ts`; routing is config-driven (`lib/ai/routing-config.ts#resolveRoute()`, pure, unit tested) with one optional live fallback on a real provider failure. `prompter_ai_jobs` gained `provider`/`actor_user_id`/`fallback_provider`/`error_category` columns for real AI usage accounting — see [AI_SYSTEM.md](AI_SYSTEM.md) "AI Router" and [DATABASE.md](DATABASE.md) "Architecture correction — AI Router usage-accounting columns". `CRITICAL`-class routing (the Optimization Agent) never gains authority to bypass Budget Guard, RBAC, or the Approval Center — task class governs which AI provider answers a request, nothing about what happens with the answer.

**Honesty note:** neither `OPENAI_API_KEY` nor `ANTHROPIC_API_KEY` is configured in this repository's own working environments — live generation against a real provider has not been exercised as part of this correction. See [SECURITY.md](SECURITY.md) and the session's live-verification report for exactly what remains `NOT_VERIFIED` versus what passed lint/typecheck/unit-tests/build.

## Billing foundation — provider-neutral (Final Production Completion pass)

Not a phase — Phase 2's plan explicitly deferred billing, and no phase since built it. Adds the minimum honest foundation the product spec's hybrid model (Freemium + Subscription + AI Usage + optional Success Fee) needs, without inventing anything not yet decided:

- `prompter_subscriptions` (one row per tenant, lazily created as `FREE`/`ACTIVE` on first access — same pattern as `prompter_budget_policies`): `plan` (`FREE`/`PRO`/`BUSINESS`/`GROWTH`/`AGENCY`/`UMKMPRO_BUNDLE`), `status`, `billing_provider` (null = no payment processor connected, `NOT_CONFIGURED`), `success_fee_rate_bps` (null = no commercial rate decided yet, no fee ever calculated).
- `/billing` (`app/(app)/billing/page.tsx`) replaces the `ComingSoon` stub: shows the tenant's real plan/status, real AI usage this month (`services/billing.ts#getMonthlyAiJobCount()`, counted from `prompter_ai_jobs` — the same table every AI feature already writes to), and a success-fee calculation (`lib/billing/success-fee.ts#calculateSuccessFee()`, unit tested) computed **only** from `prompter_attributions` rows where `attribution_model = 'UMKMPRO_VERIFIED'` — never manual self-reported conversions, never total business revenue, per the product spec's explicit constraint.
- **No prices are invented anywhere.** Every plan tier exists as a name only; there is no price column, no checkout, no invoice. `billing_provider`/`success_fee_rate_bps` being null is rendered honestly as "not configured yet," never hidden or defaulted to a guessed number.
- **No payment processor is integrated.** This is architecture only — a real Stripe/Midtrans/Xendit (or similar) integration is future work once one is chosen; this pass deliberately stops short of picking one.

Attribution write path (`services/attribution.ts#recordSingleTouchAttribution()`) was also completed as part of this same pass — `prompter_attributions` had been schema-only since Phase 2 (see Phase 2's known simplifications above). Every conversion recorded with a known campaign link now gets one single-touch attribution row (`MANUAL` for the manual entry form, `UMKMPRO_VERIFIED` for UMKMpro AI's conversions feed) — which is what makes the success-fee calculation above possible to compute from real data rather than nothing at all. True multi-touch/weighted attribution remains future work.

Budget Guard's `monthly_limit` also went from stored-but-unenforced to a real hard-stop in this same pass — see Phase 2's updated note above. `prompter_budget_policies` still has no platform-scoped columns, so **per-platform limits remain unimplemented** — a real, documented gap.

## Payment provider abstraction (Final Blocker Resolution pass)

Extends the billing foundation above with the pieces needed to make "no payment processor chosen yet" an architecture-level non-blocker rather than an unfinished corner:

- `lib/billing/payment-provider.ts#PaymentProvider` + `NullPaymentProvider` + `getPaymentProvider()` — see [INTEGRATIONS.md](INTEGRATIONS.md) "Payment provider architecture" for the full shape. Unit tested (`tests/unit/lib/null-payment-provider.test.ts`): every method either throws `PaymentProviderConfigError` or (webhook verification) fails closed, never simulates success.
- `prompter_invoices` (new migration, tenant-scoped, select-only from the app — every row would be written by a real processor's webhook, none exists yet so the table is empty in practice) + `/billing`'s new Invoice card, rendering a real (currently empty) list rather than a placeholder.
- `/billing` gained a real plan-change form (`features/billing/actions.ts#changePlanAction`, `features/billing/plan-form.tsx`) — Owner-only, audit-logged (`subscription.plan_changed`), and explicitly labeled as a governance change only ("tidak ada tagihan atau proration yang diproses") since no processor is connected to actually bill anything.
- `PAYMENT_PROVIDER_NAME`/`PAYMENT_PROVIDER_API_KEY`/`PAYMENT_PROVIDER_WEBHOOK_SECRET` added to `lib/env.ts`/`.env.example` — generic, provider-neutral names a future adapter reads, all blank today.

**What this does not do:** integrate any real processor, invent a price, or process a real payment. That remains explicitly out of scope until a processor is chosen — this pass only makes sure that choice doesn't block anything else.

## Background job architecture (Final Blocker Resolution pass)

See [INTEGRATIONS.md](INTEGRATIONS.md) "Background job architecture" for the full shape (`lib/jobs/job-queue.ts#JobQueueProvider`, `lib/jobs/providers/supabase-job-queue.ts`, `prompter_jobs` + `prompter_claim_next_job()`, `app/api/internal/jobs/process/route.ts`). In one line: a provider-neutral, retryable, idempotent, auditable job queue exists and is verified correct (live end-to-end RPC test, 20+ new unit tests), but nothing enqueues into it yet — this pass resolves the *architecture* gap (Meta/TikTok/X credentials and a payment processor not blocking Global Edition development) without rewiring any already-verified synchronous, Budget-Guard/Approval-Center-gated flow into it.

## What "done" means for a phase

- `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` all pass
- New tables have RLS enabled with real policies (not RLS-enabled-no-policy)
- No fabricated data, no fake "connected" status, no simulated external API success
- Docs in this folder updated to match what was actually built
