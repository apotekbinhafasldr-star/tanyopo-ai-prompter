# Roadmap

Development proceeds phase by phase. A phase is not started until the previous one is verified stable (lint/typecheck/test/build passing, migrations applied cleanly). This file is the source of truth for "what phase are we in."

## Phase 0 — Foundation ✅ (this delivery)

- Repository structure, Next.js 16 + TypeScript + Tailwind v4
- Supabase client/server/admin architecture
- Database migration foundation (`prompter_brand_profiles`, `prompter_automation_settings`, `prompter_audit_logs`) + RLS, reusing UMKMpro AI's shared tenant identity
- Auth (email + password) and multi-tenant session context
- Onboarding wizard
- Application shell (sidebar, all nav destinations routed) + design system
- Landing page
- Docs, `.env.example`, CI (lint/typecheck/test/build)

## Phase 1 — Core Promoter

- Products, product media upload (Supabase Storage)
- Marketing Blueprint generation (AI provider abstraction + structured schemas)
- Promote Wizard (product → goal → channel → target → budget → AI proposal → preview → draft)
- Content generation (Content Studio, first pass)

## Phase 2 — Marketing Operations

- Campaign management (master + channel campaigns)
- Approval Center, Budget Guard
- Analytics schema, conversions, attribution
- Audit log wired into every critical action

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
