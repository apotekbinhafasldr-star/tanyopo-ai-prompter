# Architecture

## Ecosystem position

```
Tanyopo Labs
├── UMKMpro AI          — MANAGE YOUR BUSINESS (POS, inventory, HR, ...)
└── Tanyopo AI Promoter — GROW YOUR BUSINESS (this repo)
```

Two products, one ecosystem. Promoter's source code is fully separate from UMKMpro AI's — a different repository, a different Next.js app, deployed independently. What they share is:

1. **One Supabase project.** Not two — see [DATABASE.md](DATABASE.md) for why and how tenancy still stays cleanly separated.
2. **One tenant identity.** `auth.users`, `public.tenants`, `public.user_profiles` are owned by UMKMpro AI's schema. Promoter reads them for auth/tenancy and never writes to them directly.
3. **An eventual API bridge.** UMKMpro AI's "🚀 PROMOSIKAN DENGAN AI" button will call into Promoter's `/api/v1/integrations/umkmpro/*` namespace (Phase 4). Promoter does not require UMKMpro AI to function — a user can sign up and use Promoter standalone.

## Tech stack

- **Framework:** Next.js 16 (App Router, Turbopack, `nodejs`-runtime `proxy.ts` — Next 16 renamed `middleware.ts`/`middleware()` to `proxy.ts`/`proxy()`; the `edge` runtime is no longer available for this file)
- **Language:** TypeScript, strict mode
- **UI:** React 19, Tailwind CSS v4 (CSS-first `@theme` tokens, no `tailwind.config.js`), a small local `components/ui/` primitive set (no external component library) built with `class-variance-authority` + `tailwind-merge`
- **Icons:** `lucide-react`
- **Backend:** Supabase (Postgres, Auth, Storage, Edge Functions), reached via `@supabase/ssr` and `@supabase/supabase-js`
- **AI:** Anthropic (`@anthropic-ai/sdk`) behind a vendor-neutral `AIProvider` interface — see [AI_SYSTEM.md](AI_SYSTEM.md)
- **Validation:** Zod, schemas live in `schemas/`

## Folder structure

```
app/                    Route segments (App Router)
  (marketing)/           Public landing page, no auth required
  (auth)/                /login, /register — redirect away once signed in
  onboarding/             Post-signup wizard, standalone layout (no sidebar)
  (app)/                  Authenticated app shell (sidebar) — dashboard and
                          every feature area
components/
  ui/                    Design-system primitives (Button, Card, Input, ...)
  layout/                Sidebar and other shell chrome
  shared/                Cross-feature building blocks (e.g. ComingSoon)
features/                Feature-scoped UI + server actions, grouped by
                          domain (auth, onboarding, dashboard, marketing,
                          products, promote, campaigns, content, ...)
lib/
  supabase/              client.ts (browser), server.ts (SSR), admin.ts
                          (service-role, server-only)
  ai/                    provider.ts (vendor-neutral interface),
                          anthropic-provider.ts, get-provider.ts,
                          prompts.ts (shared prompt builders)
  env.ts                 Typed env access; missing optional vars resolve to
                          undefined rather than throwing
  utils/, constants/      Small shared helpers (cn(), nav config, ...)
services/                Server-only data-access functions shared across
                          routes (e.g. services/session.ts, services/ai-jobs.ts)
schemas/                 Zod schemas, one file per domain
types/                   Hand-scoped Supabase Database type (see DATABASE.md
                          for why this isn't the full generated schema)
supabase/
  migrations/             SQL migrations, additive-only against the shared
                          project (see DATABASE.md)
  functions/              Edge Functions (webhook receivers, Phase 3+)
tests/
  unit/                   Vitest unit tests
  e2e/                    End-to-end test scaffolding
docs/                     This documentation set
```

## Request flow (authenticated app)

1. `proxy.ts` refreshes the Supabase session cookie on every request and redirects unauthenticated users to `/login`, and authenticated users away from `/login`/`/register`.
2. `app/(app)/layout.tsx` calls `services/session.ts#requireSessionContext()`, a server-only helper that loads the user's `tenant_id`, role, and business name, and redirects to `/onboarding` if the Promoter brand profile isn't complete yet.
3. Every page under `app/(app)/` is a Server Component that either renders real, tenant-scoped data or an explicit empty/"coming soon" state — never a fabricated number or a fake "connected" status.

## What's real vs. what's still a stub

As of Phase 1, **Products, Promote, Campaigns, and Content** are real — they read and write actual tenant data and (when `AI_PROVIDER_API_KEY` is configured) call a real AI provider. **Growth, SEO, Analytics, AI Marketing, Connections, Approvals, Billing** are still routed and reachable from the sidebar but render `components/shared/coming-soon.tsx` stating which phase builds them — see [ROADMAP.md](ROADMAP.md). No stub page pretends to have working data or a working button behind it, and no Phase 1 feature fakes a result when its AI provider isn't configured (see [AI_SYSTEM.md](AI_SYSTEM.md)).
