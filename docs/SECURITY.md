# Security

## Authentication

Supabase Auth, email + password (magic link and Google OAuth are straightforward additions on top of the same `@supabase/ssr` setup, not yet wired up). Session cookies are read/refreshed by `proxy.ts` on every request and by `lib/supabase/server.ts` in Server Components/Actions.

## Multi-tenant isolation

- Every `prompter_*` table has Row Level Security **enabled with policies**, not just enabled (a table with RLS on and no policy silently denies everything, which looks safe but breaks the app instead of protecting it — worth calling out because that's exactly what the Supabase advisor flags for one pre-existing UMKMpro table, `ai_assistant_usage_log`, unrelated to this app).
- All tenant-scoping RLS conditions call `public.fn_current_tenant_id()` (`SECURITY DEFINER`, resolves to the caller's own `user_profiles.tenant_id`). No Promoter table trusts a `tenant_id` value sent from the client.
- `lib/supabase/client.ts` and `lib/supabase/server.ts` both use the **publishable** (anon) key — the one safe to ship to the browser. RLS is what actually enforces isolation, not key secrecy.
- `lib/supabase/admin.ts` wraps the **service-role** key (`SUPABASE_SECRET_KEY`), which bypasses RLS entirely. It is `import "server-only"`-guarded, returns `null` when the key isn't configured (callers must handle that as `NOT_CONFIGURED`, not crash), and must never be imported into anything that reaches the browser.

## Secrets

- No credential is hard-coded anywhere in this repo. `.env.example` lists every variable the app can use, all blank.
- `lib/env.ts` centralizes env access: `publicEnv` for values safe in client bundles, `serverEnv` (only importable from server code) for everything else. Optional integration credentials resolve to `undefined` instead of throwing, so the app runs with zero third-party integrations configured — see [INTEGRATIONS.md](INTEGRATIONS.md).
- Social platform passwords (Facebook/Instagram/TikTok/X) are never requested or stored. Platform connections happen through each platform's own OAuth flow (Phase 3+); only the resulting token metadata (`expires_at`, `scopes`, `status`) is ever persisted, encrypted, server-side.

## Audit logging

`prompter_audit_logs` is append-only (see [DATABASE.md](DATABASE.md) — no `UPDATE`/`DELETE` RLS policy exists on the table at all). Every critical action defined in the product spec (account connection, campaign launch, budget change, approval, automation change, role change, billing action) must write a row here once those features exist. The onboarding completion flow (`features/onboarding/actions.ts`) already does this as the first example.

## Automation safety

`prompter_automation_settings` defaults to `automation_mode = 'manual'` and `emergency_stop_active = false` for every new tenant. The eventual Autopilot feature must never be able to bypass:

- the tenant's budget policy,
- platform (Meta/TikTok/X) permission scopes,
- tenant authorization, or
- an active emergency stop.

These are product requirements, not yet enforced by running code — Autopilot execution logic doesn't exist yet (Phase 7).

## Known pre-existing findings (not introduced by this app)

Running `mcp_supabase_get_advisors` against the shared project surfaces several `WARN`-level findings that predate Promoter and belong to UMKMpro AI's schema (`function_search_path_mutable` on several `fn_*_publik` functions, several `SECURITY DEFINER` RPCs callable by `anon`, `pg_net` installed in the `public` schema, leaked-password protection disabled). Promoter's own migration introduced one such warning (`prompter_set_updated_at` missing a pinned `search_path`) and it was fixed in the same session (`20260829080100_prompter_fix_function_search_path.sql`). The pre-existing UMKMpro findings are out of scope for this repository to fix unilaterally.

## Reporting

There is no public bug bounty yet. Report security issues to the Tanyopo Labs team directly rather than filing a public issue.
