# Tanyopo AI Promoter

AI marketing & growth operating system by **Tanyopo Labs**. Upload a product, let AI understand it, pick a goal and channel, set a budget, and get an AI-generated strategy, content, and campaign — reviewed and approved by you before anything goes live.

Tanyopo AI Promoter is a separate application from **UMKMpro AI** (`MANAGE YOUR BUSINESS`). Promoter's job is `GROW YOUR BUSINESS`. The two apps share one Supabase project and one tenant identity, connected through Promoter's own `prompter_*` tables — see [docs/DATABASE.md](docs/DATABASE.md) for exactly how.

## Status

**Phase 3 — Meta Foundation.** Auth, multi-tenant data access, onboarding, the application shell, and the design system (Phase 0); real Products, AI Marketing Blueprint generation, the Promote Wizard, Campaign drafts, and Content Studio (Phase 1); and a real campaign approval workflow — Budget Guard, the Approval Center, per-channel campaign breakdowns, Analytics with manual conversion logging (Phase 2) — are all in place. Phase 3 adds a real Meta (Facebook & Instagram) connector: OAuth connect/disconnect through the Connection Center, encrypted token storage (a table the app itself cannot read back — only the server-side service role can), and a campaign-launch action that only ever marks a channel campaign `ACTIVE` after Meta's own API confirms it was created. AI generation and the Meta connector both show a plain "not configured" state instead of fabricating output or a fake connection when their credentials are unset. The remaining feature areas (Growth, SEO, AI Marketing chat, Billing, TikTok/X connectors) are routed but still render an honest "not built yet" state — see [docs/ROADMAP.md](docs/ROADMAP.md) for what ships in each phase. Nothing in this app fakes a working integration, a connected account, or a metric that isn't real.

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
