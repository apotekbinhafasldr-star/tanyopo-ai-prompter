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
- Social platform passwords (Facebook/Instagram/TikTok/X) are never requested or stored. Platform connections happen through each platform's own OAuth flow; only the resulting token metadata (`expires_at`, `scopes`, `status`) is ever displayed — the token itself is encrypted server-side (see below).

## OAuth token storage (Phase 3)

Two layers of protection, not just one:

1. **Encryption at rest.** `lib/crypto/token-cipher.ts` encrypts every token with AES-256-GCM before it's written to the database, keyed by `TOKEN_ENCRYPTION_KEY` (32 raw bytes, base64). A compromised database dump contains only ciphertext, never a usable token.
2. **RLS lockout.** `prompter_oauth_credentials` has Row Level Security enabled with **zero policies** for `anon`/`authenticated` — every ordinary Supabase client query is denied by default, regardless of the caller's role or tenant. Only the service-role key (`lib/supabase/admin.ts`, itself server-only and never shipped to the browser) can read or write that table. This means a token can't leak through a future bug in an RLS policy on that table, because there is no policy to get wrong.

Both the OAuth callback (`app/api/connections/meta/callback/route.ts`) and the campaign-launch flow (`features/campaigns/launch-actions.ts`) that needs to read a token back go through the admin client for exactly this reason.

## Signed service authentication (Phase 4)

`/api/v1/integrations/umkmpro/*` has no Supabase session to authenticate against — it's UMKMpro AI's server calling Promoter's server, not a user in a browser. Authentication is HMAC-SHA256 over `${timestamp}.${rawBody}`, keyed by the shared `UMKMPRO_SERVICE_TOKEN`:

- `lib/umkmpro/signature.ts` — pure, dependency-free (only `node:crypto`) signature computation and verification, directly unit tested (`tests/unit/lib/umkmpro-signature.test.ts`). Verification is constant-time (`timingSafeEqual`) and rejects a request whose `x-umkmpro-timestamp` header is more than 5 minutes old or in the future, so a captured request can't be replayed indefinitely.
- `lib/umkmpro/auth.ts` — the `server-only` wrapper that reads `UMKMPRO_SERVICE_TOKEN` from the environment and pulls the two headers (`x-umkmpro-timestamp`, `x-umkmpro-signature`) off the real request.
- Every route reads the **raw** request body text and signs/verifies that exact byte string before any `JSON.parse` — parsing then re-stringifying first would let a semantically-identical-but-differently-formatted body slip past a signature computed over the original bytes.
- A request that fails verification gets a `401 UNAUTHORIZED` naming the specific reason (`MISSING_HEADERS`/`STALE_TIMESTAMP`/`INVALID_SIGNATURE`); `UMKMPRO_SERVICE_TOKEN` unset gets `503 NOT_CONFIGURED` instead — the route never falls back to accepting an unsigned request.

## Rate limiting (Phase 4)

`lib/rate-limit.ts` — a best-effort, in-memory fixed-window limiter (60 requests/minute per route, per `/api/v1/integrations/umkmpro/*` route name). Honestly scoped, not oversold: state is process-local, so it resets on every deploy/restart and isn't shared across multiple server instances — a real gap for a multi-instance production deployment, and one this app doesn't have the infrastructure (a shared cache like Redis) to close yet. It's still a genuine backstop against a runaway retry loop from a single instance, which is the failure mode it exists to catch today.

## Audit logging

`prompter_audit_logs` is append-only (see [DATABASE.md](DATABASE.md) — no `UPDATE`/`DELETE` RLS policy exists on the table at all). Every critical action defined in the product spec (account connection, campaign launch, budget change, approval, automation change, role change, billing action) must write a row here once those features exist. As of Phase 4: `onboarding.completed`, `campaign.submitted_for_approval`, `campaign.approved`, `campaign.launch_rejected`, `budget_policy.updated`, `connection.connected`, `connection.disconnected`, `campaign.launched`, `campaign.launch_failed`, `umkmpro.product_synced`, `umkmpro.promotion_handoff_created`, and `umkmpro.conversion_recorded` are wired (`actor_user_id` is `null` for the UMKMpro-originated ones — there is no Promoter user in that request, only a signed service call); automation-mode, role, and billing changes will follow as those features land. The webhook receipt log (`prompter_webhook_events`) intentionally does **not** also write an audit log row — it already is the durable, idempotent record of what UMKMpro AI delivered.

## Separation of duties (Budget Guard / Approval Center)

Submitting a campaign for approval and deciding it are deliberately different privilege levels, enforced at the RLS layer rather than only in the UI: `prompter_approvals` INSERT is open to `owner`/`marketing`, but its UPDATE policy (the approve/reject decision) is restricted to `owner` only — see the Phase 2 migration. `features/approvals/actions.ts#decideApprovalAction()` also checks the caller's role before writing, so a non-owner gets a clear error rather than a silently-ignored write. Budget Guard's hard-block check (`services/budget-guard.ts`) runs before an approval request is even created, so a campaign that exceeds the tenant's configured limit never reaches the queue.

Connecting or disconnecting an ad platform account is owner-only (product spec §62 — STAFF must not connect ad accounts without authorization): checked explicitly in `app/api/connections/meta/authorize/route.ts`, the callback route, and `features/connections/actions.ts#disconnectAction()`, and independently backed by RLS on `prompter_connected_accounts`.

## Automation safety

`prompter_automation_settings` defaults to `automation_mode = 'manual'` and `emergency_stop_active = false` for every new tenant. The eventual Autopilot feature must never be able to bypass:

- the tenant's budget policy,
- platform (Meta/TikTok/X) permission scopes,
- tenant authorization, or
- an active emergency stop.

These are product requirements, not yet enforced by running code — Autopilot execution logic doesn't exist yet (Phase 7).

## Known pre-existing findings (not introduced by this app)

Running `mcp_supabase_get_advisors` against the shared project surfaces several `WARN`-level findings that predate Promoter and belong to UMKMpro AI's schema (`function_search_path_mutable` on several `fn_*_publik` functions, several `SECURITY DEFINER` RPCs callable by `anon`, `pg_net` installed in the `public` schema, leaked-password protection disabled). Promoter's own migration introduced one such warning (`prompter_set_updated_at` missing a pinned `search_path`) and it was fixed in the same session (`20260829080100_prompter_fix_function_search_path.sql`). The pre-existing UMKMpro findings are out of scope for this repository to fix unilaterally.

One additional `INFO`-level finding is expected and intentional: `rls_enabled_no_policy` on `prompter_oauth_credentials` — see "OAuth token storage" above. Unlike the UMKMpro `ai_assistant_usage_log` case (a table nothing currently reads that would need a policy added once it's used), this one is a deliberate, permanent design choice — don't "fix" it by adding a policy.

## Reporting

There is no public bug bounty yet. Report security issues to the Tanyopo Labs team directly rather than filing a public issue.
