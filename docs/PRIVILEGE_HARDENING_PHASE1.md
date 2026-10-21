# Database privilege hardening — Phase 1

Status: **Draft PR. NOT applied to any database.** Applying it to production needs explicit Founder approval
(rollout below). Local tests on synthetic PostgreSQL do not by themselves prove production is safe.

## Why
Supabase default privileges give `anon`/`authenticated` ALL (incl. TRUNCATE) on every new `public` table. A read-only
production catalog audit (2026-10-20) confirmed that 35 of the 36 `prompter_*` tables carry those defaults
(`prompter_demo_ai_usage` was already locked down; `prompter_subscriptions` has no table-level UPDATE, only column-level
`UPDATE(plan)`). RLS does **not** govern TRUNCATE. A single GRANT is not proof of exploitability (RLS is on everywhere and
PostgREST does not expose TRUNCATE), but the privilege has no legitimate user, so it is removed.

## What changes (`20261020190000_prompter_privilege_hardening_phase1.sql`, REVOKE-only)
| Scope | Change |
|---|---|
| all `prompter_*` tables | `REVOKE TRUNCATE`, `REFERENCES`, `TRIGGER` (and `MAINTAIN` on PostgreSQL ≥ 17, issued via guarded dynamic SQL because PostgreSQL < 17 cannot parse it) from PUBLIC, anon, authenticated |
| all `prompter_*` tables | `REVOKE ALL` from anon (no public flow: reads use a logged-in session or the admin client) |
| `invoices`, `jobs`, `plan_entitlements`, `platform_capabilities`, `product_snapshots`, `webhook_events` (policies allow SELECT only) | `REVOKE INSERT, UPDATE, DELETE` from authenticated |
| `audit_logs`, `payment_transactions` | `REVOKE UPDATE, DELETE` from authenticated |
| `subscriptions` | `REVOKE DELETE` from authenticated (never table-level UPDATE — it would drop `UPDATE(plan)`) |
| `oauth_credentials` | `REVOKE ALL` from authenticated (service-role OAuth callback only; RLS has zero policies) |

Evidence that nothing legitimate is lost: `authenticated` keeps SELECT/INSERT/UPDATE/DELETE on the 24 policy-backed tables
(`products`, `approvals`, `content_items`, `master_campaigns`, `channel_campaigns`, ... — the user-session client writes to them under
RLS, e.g. `features/campaigns/actions.ts`), on `audit_logs` INSERT, `payment_transactions` INSERT, `subscriptions` INSERT /
`UPDATE(plan)` and `ai_jobs` INSERT/UPDATE/DELETE. Phase 1 only removes privileges that have no user-session caller:
TRUNCATE/REFERENCES/TRIGGER/MAINTAIN everywhere, anon everywhere, and write privileges on the evidence/read-only tables.
`service_role` (webhook, reconciliation, job queue, OAuth callback, UMKMpro integration, demo via `createAdminClient()`) is never
changed; the migration fails closed if any `service_role` privilege differs.
(Earlier revisions of this document claimed user-session writes were limited to a handful of tables; that was wrong.)

## BLOCKED / deliberately not changed (Phase 1 scope)
* `ai_jobs` INSERT/UPDATE/DELETE — `services/ai-jobs.ts` still completes/deletes job rows with the user client (only TRUNCATE revoked).
* `payment_transactions` INSERT (`services/checkout.ts`) and `subscriptions` `UPDATE(plan)` / INSERT — depend on PR #44 / #45.
* `audit_logs` INSERT — user-client audit writes in `features/*`.
* `ALTER DEFAULT PRIVILEGES` — schema-wide on a shared database; per-table revokes only. New tables must revoke explicitly
  (a unit test fails when a new `prompter_*` table is neither listed nor self-locked).
* Not Phase 1 (candidates for Phase 2): privileges that RLS already makes inert (e.g. DELETE on tables with no DELETE policy —
  `approvals` DELETE is kept because `features/campaigns/actions.ts` issues it), the `anon`-executable helper functions.

## Safety properties (all asserted by tests)
Idempotent; skips absent tables (e.g. Phase 2B `prompter_manual_ad_metrics` before it is applied); fails closed inside the
migration if TRUNCATE/REFERENCES/TRIGGER/MAINTAIN/anon/PUBLIC privileges survive, if any privilege outside the explicit list is lost or gained
by `authenticated`, if any `service_role` privilege or column-level grant changes; no data/RLS/policy/function/
owner/default-privilege change; FK cascades (tenant deletion) run as the table owner and are unaffected.

## Order and conflicts
Independent of PR #31, #44, #45: every statement is a subset of, or disjoint from, what they revoke. Tests prove the final
privilege matrix is identical whether Phase 1 is applied before or after them. Timestamp `20261020190000` sorts after all.

## Tests
`supabase/tests/privilege-phase1/run-local.sh` (CI job `privilege-phase1-sql`; refuses non-local hosts and credentials):
privilege matrix (anon/authenticated/service_role × 7–8 privileges) before/after; mutation negative controls (the migration must refuse a broken copy); runs on PostgreSQL 17 in CI; 46 positive probes (existing reads, checkout INSERT, changePlan `UPDATE(plan)`, AI-job
RPC/update/delete, Owner/Marketing/Member, tenant A/B isolation, service_role webhook/OAuth/queue/demo, cron functions,
`fn_apply_verified_payment`) that must be byte-identical before/after; 100+ negative probes (anon, TRUNCATE on every table,
writes to evidence tables) that must flip to `permission denied`; catalog hashes (policies, functions, owners, default ACLs,
non-prompter ACLs) unchanged; apply twice; rollback and re-apply; fail-closed; PR #31/#44/#45 integration in both orders.
Static invariants: `tests/unit/migrations/privilege-hardening-phase1.test.ts`.

## Rollout (not executed)
1. Founder approval. 2. Supabase preview branch (or a restored copy), never first on production. 3. Re-run the read-only
catalog query and compare with the local "before" matrix. 4. Apply in a quiet window (lock_timeout 5s, statement is instant).
5. Smoke: login, dashboard, AI generation, checkout (gateway OFF → expected message), settings, connections, billing page.
6. Re-run the catalog query: no TRUNCATE/anon, `UPDATE(plan)` still present.

## Rollback (not executed)
`supabase/rollback/20261020190000_prompter_privilege_hardening_phase1.down.sql` is a LEGACY mass-restore (re-grants the default state, incl. TRUNCATE/anon) kept only so this PR's exact-pre-state test passes; DO NOT USE it on production. PR #47 replaces it with a fail-closed, cell-by-cell rollback.
If #31/#44/#45 are already applied, re-run their migrations right after (idempotent REVOKEs); tests prove
rollback + re-run equals the exact pre-Phase-1 matrix. Never roll back to restore TRUNCATE for any real need — there is none.
