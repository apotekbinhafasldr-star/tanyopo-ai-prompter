# Deployment

## Environment variables

| Variable | Required | Effect when empty |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | App fails to start — this is the shared Supabase project's URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | App fails to start. |
| `SUPABASE_SECRET_KEY` | No | `lib/supabase/admin.ts#createAdminClient()` returns `null`; any server-only/service-role code path must treat that as `NOT_CONFIGURED` — this includes every `/api/v1/integrations/umkmpro/*` route (Phase 4), which returns `503 NOT_CONFIGURED` rather than attempting a write with no client. |
| `NEXT_PUBLIC_APP_URL` | No | Defaults to `http://localhost:3000`. |
| `AI_PROVIDER_NAME`, `AI_PROVIDER_API_KEY` | No | AI generation features (Phase 1+) render as not configured. |
| `META_APP_ID`/`META_APP_SECRET`/`META_REDIRECT_URI` | No | Meta connector (Phase 3) stays `NOT_CONFIGURED`. |
| `TIKTOK_APP_ID`/`TIKTOK_APP_SECRET`/`TIKTOK_REDIRECT_URI` | No | TikTok connector (Phase 6) stays `NOT_CONFIGURED`. |
| `X_CLIENT_ID`/`X_CLIENT_SECRET`/`X_REDIRECT_URI` | No | X connector (Phase 6) stays `NOT_CONFIGURED`. |
| `UMKMPRO_SERVICE_TOKEN` | No | `/api/v1/integrations/umkmpro/*` (Phase 4) returns `503 NOT_CONFIGURED` for every request rather than accepting unsigned traffic. |

Copy `.env.example` to `.env.local` for local development. Never commit `.env.local` (it's in `.gitignore`) or any file containing a real credential.

## Database

This app does not own a Supabase project lifecycle — it targets the existing shared project (`umkmpro-ai`, ref `wjjyqovhmwenbcvbnkgx`). New migrations are added to `supabase/migrations/` and applied with the Supabase CLI (`supabase db push`) or the Supabase MCP `apply_migration` tool, by someone with access to that project. See [DATABASE.md](DATABASE.md) for the additive-only rule.

## Build

```bash
npm run build
npm run start
```

Next.js 16 uses Turbopack for both `next dev` and `next build` by default — no extra flag needed.

## Hosting

No hosting provider is pinned yet. The app is a standard Next.js App Router project and deploys to Vercel or any Node.js 20.9+ host without modification, as long as the environment variables above are set.

## CI

`.github/workflows/ci.yml` runs install → lint → typecheck → test → build on every push/PR. It intentionally does not require any production secret — `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in CI point at placeholder values sufficient for `next build` to succeed (no live Supabase calls happen at build time), so a PR from a contributor without production credentials still gets full signal from lint/typecheck/test/build.
