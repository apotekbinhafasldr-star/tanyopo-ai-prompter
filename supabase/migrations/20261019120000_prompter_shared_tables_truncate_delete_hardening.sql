-- Security-only hardening of dangerous write privileges on shared tables (Fast Track 2026-10-19, step 2).
-- PREPARED FOR REVIEW; NOT APPLIED TO PRODUCTION. Applying it touches tables that PUBLOE/Apotek/UMKMpro share,
-- so it needs the Founder's explicit approval (and a verified backup first).
--
-- Read-only production catalog evidence (2026-10-19):
--   tenants                  RLS on; policies: SELECT x2, UPDATE (owner). No INSERT/DELETE policy.
--                            anon + authenticated hold INSERT/UPDATE/DELETE/TRUNCATE. 107 tables reference it.
--   ai_assistant_usage_log   RLS on; NO policy at all. anon + authenticated hold INSERT/UPDATE/DELETE/TRUNCATE.
--   fitur_ai_usage_log       RLS on; SELECT policy only. Same grants.
--   (prompter_plan_entitlements: already handled by 20261019100200.)
--
-- Why this is safe for existing apps:
--   * INSERT/DELETE on tenants and every write on the two usage logs are ALREADY rejected by RLS for these roles
--     (no matching policy), so no working code path can depend on them; revoking turns an RLS failure into a
--     privilege failure (same 42501 error class) and removes the TRUNCATE hole, which ignores RLS entirely.
--   * Rows are created by SECURITY DEFINER code (handle_new_user, usage-log functions) and by service_role; both are
--     unaffected by revoking from anon/authenticated. ON DELETE CASCADE runs as the table owner.
--   * tenants keeps UPDATE for `authenticated` (the owner-edit policy depends on it) and SELECT for both roles.
--   * Nothing is dropped, no data is read or changed, no policy is changed. Idempotent.
--
-- Note on reachability: Supabase's public API (PostgREST/GraphQL) has no TRUNCATE verb, so TRUNCATE is not
-- remotely reachable through it today; it is still removed (defence in depth against any future SQL-executing
-- function, misconfigured RPC or privileged-role mistake). DELETE/INSERT/UPDATE were RLS-gated, same reasoning.
--
-- Rollback: supabase/rollback/20261019120000_prompter_shared_tables_truncate_delete_hardening.down.sql

revoke truncate, delete, insert on public.tenants from anon, authenticated;
revoke update on public.tenants from anon;

revoke insert, update, delete, truncate on public.ai_assistant_usage_log from anon, authenticated;
revoke insert, update, delete, truncate on public.fitur_ai_usage_log from anon, authenticated;
