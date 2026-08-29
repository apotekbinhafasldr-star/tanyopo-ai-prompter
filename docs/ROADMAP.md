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

## Phase 1 — Core Promoter ✅ (this delivery)

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

## Phase 2 — Marketing Operations

- `channel_campaigns` (per-platform execution rows under a Phase 1 master campaign) and the `DRAFT → AWAITING_APPROVAL → SCHEDULED → ACTIVE/...` status transitions
- Approval Center, Budget Guard
- Analytics schema, conversions, attribution
- Audit log wired into every critical action (Phase 1 only logs onboarding completion)

## Phase 3 — Meta Foundation

- Connection Center UI
- OAuth architecture, encrypted token storage
- `MetaConnector` adapter, `platform_capabilities` registry
- Real `NOT_CONFIGURED`/`CONNECTED`/`EXPIRED` states, no simulated success

## Phase 4 — UMKMpro Integration

- Product handoff → `product_snapshots`
- `/api/v1/integrations/umkmpro/*` (products, promotions, conversions, webhooks)
- Signed service authentication

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
