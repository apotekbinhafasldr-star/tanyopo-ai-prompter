# Tanyopo AI Promoter

AI marketing & growth operating system by **Tanyopo Labs**. Upload a product, let AI understand it, pick a goal and channel, set a budget, and get an AI-generated strategy, content, and campaign — reviewed and approved by you before anything goes live.

Tanyopo AI Promoter is a separate application from **UMKMpro AI** (`MANAGE YOUR BUSINESS`). Promoter's job is `GROW YOUR BUSINESS`. The two apps share one Supabase project and one tenant identity, connected through Promoter's own `prompter_*` tables — see [docs/DATABASE.md](docs/DATABASE.md) for exactly how.

## Status

**Phase 7 — Advanced AI.** Auth, multi-tenant data access, onboarding, the application shell, and the design system (Phase 0); real Products, AI Marketing Blueprint generation, the Promote Wizard, Campaign drafts, and Content Studio (Phase 1); a real campaign approval workflow — Budget Guard, the Approval Center, per-channel campaign breakdowns, Analytics with manual conversion logging (Phase 2); a real Meta (Facebook & Instagram) connector (Phase 3); the UMKMpro AI bridge — signed product sync, the "🚀 PROMOSIKAN DENGAN AI" handoff, conversion recording, webhooks, and a profit-aware marketing estimate (Phase 4); Growth, SEO, and a content calendar (Phase 5); and real TikTok and X connectors alongside Meta's — OAuth connect/disconnect, encrypted token storage, and campaign launch, all through one `PlatformConnector` interface and Connection Center (Phase 6) — are all in place. Phase 7 adds Advanced AI: an Analytics Agent that summarizes a tenant's real metrics/conversions into trends and risks, an Optimization Agent that recommends per-channel budget/pause actions reasoned from each channel's estimated marketing contribution (never ROAS alone, and explicitly never labeled "net profit"), a metrics-sync action that pulls real spend/performance data from a connected platform, and Autopilot — policy-gated auto-routing of a recommendation to the Approval Center that never bypasses Budget Guard, RBAC, an active Emergency Stop, or an unconfigured connector, and never executes anything without an Owner's explicit approval. Every autopilot action is fully audited: recommendation, rationale, requested action, risk level, approval status, execution outcome, actor, and timestamp. This delivery also fixed a Phase 6 gap where the campaign launch button was hard-coded to two channels instead of checking real capability/connection state — it's now fully capability-driven. Each connector remains honest about its own current stopping point rather than faking a completed launch — TikTok and X both stop at ad-set targeting today, pending a verified mapping from country to each platform's own numeric location catalog (guessing one would risk real budget on the wrong location, which is worse than stopping). AI generation and every ad-platform/UMKMpro connector show a plain "not configured" state instead of fabricating output or a fake connection when their credentials are unset. The remaining feature areas (AI Marketing chat, Billing) are routed but still render an honest "not built yet" state — see [docs/ROADMAP.md](docs/ROADMAP.md) for what ships in each phase. Nothing in this app fakes a working integration, a connected account, an executed action, or a metric that isn't real.

**Post-Phase 7 architecture correction (not a new phase):** AI generation now runs through a multi-provider **Tanyopo AI Router** (`lib/ai/router.ts`) instead of a single hard-coded Anthropic client — OpenAI and Anthropic adapters both implement the same `AIProvider` interface, routed by task class (`FAST`/`STANDARD`/`STRATEGY`/`CRITICAL`) with one optional live fallback. See [docs/ROADMAP.md](docs/ROADMAP.md) "Architecture correction" and [docs/AI_SYSTEM.md](docs/AI_SYSTEM.md) "AI Router" for details, and [docs/DATABASE.md](docs/DATABASE.md) "Data access boundary" for the confirmed (unchanged) shared-Supabase / UMKMpro isolation model.

## Requirements

- Node.js 20.9+
- npm
- Access to the shared Supabase project (ask a maintainer for credentials)

## Environment variables

Copy `.env.example` to `.env.local` and fill in the values you have. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for what each one does and what happens when it's left empty (most integrations degrade to a clearly-labeled `NOT_CONFIGURED` state rather than failing to build).

```bash
cp .env.example .env.local
```

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Database & migrations

Schema lives in `supabase/migrations/`. This app **adds** `prompter_`-prefixed tables to an existing Supabase project shared with UMKMpro AI — it never modifies UMKMpro's own tables. See [docs/DATABASE.md](docs/DATABASE.md) for the tenancy model and RLS approach.

```bash
# Apply migrations to your local/linked Supabase project
supabase db push
```

## Testing

```bash
npm run lint        # ESLint
npm run typecheck    # tsc --noEmit
npm run test          # Vitest
npm run build         # production build
```

## Documentation

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — system design, folder structure, how Promoter relates to UMKMpro AI
- [DATABASE.md](docs/DATABASE.md) — schema, tenancy model, RLS policies
- [SECURITY.md](docs/SECURITY.md) — auth, RLS, secrets, audit logging
- [INTEGRATIONS.md](docs/INTEGRATIONS.md) — connector architecture (Meta, TikTok, X, UMKMpro)
- [AI_SYSTEM.md](docs/AI_SYSTEM.md) — AI provider abstraction, agents, guardrails
- [DEPLOYMENT.md](docs/DEPLOYMENT.md) — environment variables, deployment notes
- [ROADMAP.md](docs/ROADMAP.md) — phased build plan and current status

## License

Proprietary — Tanyopo Labs. All rights reserved.
