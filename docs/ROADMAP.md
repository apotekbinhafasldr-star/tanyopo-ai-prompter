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
- `prompter_attributions` is schema-only — nothing writes to it yet (no attribution model is computed until real conversion data exists)
- Approval Center only handles `CAMPAIGN_LAUNCH`; the other approval types in the schema (`BUDGET_CHANGE`, `CAMPAIGN_SCALE`, `CONTENT_PUBLISH`, `AUTOPILOT_ACTION`) have no feature behind them yet
- Conversions are manual-entry only — no ad-platform conversion API or UMKMpro conversion bridge (Phase 4)
- Budget Guard checks `daily_limit`/`campaign_limit` only; `monthly_limit`, `require_approval_above`, and `autopilot_limit` are stored but not yet enforced

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

## Phase 5 — Growth + SEO

- Growth goals, follower analytics architecture (no bots, no fake engagement)
- SEO projects, on-page recommendations, content plan
- Content calendar

## Phase 6 — TikTok + X

- `TikTokConnector`, `XConnector` — only capabilities each platform genuinely supports

## Phase 7 — Advanced AI

- Analytics Agent, Optimization Agent
- Profit-aware marketing (revenue − COGS − ad spend, clearly labeled as an estimate)
- Cross-channel recommendations
- Autopilot policies (bounded by Budget Guard, platform permissions, tenant authorization, and emergency stop — never bypassing any of them)

## What "done" means for a phase

- `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` all pass
- New tables have RLS enabled with real policies (not RLS-enabled-no-policy)
- No fabricated data, no fake "connected" status, no simulated external API success
- Docs in this folder updated to match what was actually built
