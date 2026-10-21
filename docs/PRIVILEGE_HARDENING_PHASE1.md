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
| all `prompter_*` tables | `REVOKE TRUNCATE` from PUBLIC, anon, authenticated |
| all `prompter_*` tables | `REVOKE ALL` from anon (no public flow: reads use a logged-in session or the admin client) |
| `invoices`, `jobs`, `plan_entitlements`, `platform_capabilities`, `product_snapshots`, `webhook_events` (policies allow SELECT only) | `REVOKE INSERT, UPDATE, DELETE` from authenticated |
| `audit_logs`, `payment_transactions` | `REVOKE UPDATE, DELETE` from authenticated |
| `subscriptions` | `REVOKE DELETE` from authenticated (never table-level UPDATE — it would drop `UPDATE(plan)`) |
| `oauth_credentials` | `REVOKE ALL` from authenticated (service-role OAuth callback only; RLS has zero policies) |

Evidence that nothing legitimate is lost: every client-side (non-admin) write in the code base is on `audit_logs` INSERT,
`payment_transactions` INSERT, `subscriptions` INSERT / `UPDATE(plan)` and `ai_jobs` INSERT/UPDATE/DELETE — all kept.
Webhook, reconciliation, job queue, OAuth callback, UMKMpro integration and demo use `createAdminClient()` (service_role).

## BLOCKED / deliberately not changed (Phase 1 scope)
* `ai_jobs` INSERT/UPDATE/DELETE — `services/ai-jobs.ts` still completes/deletes job rows with the user client (only TRUNCATE revoked).
* `payment_transactions` INSERT (`services/checkout.ts`) and `subscriptions` `UPDATE(plan)` / INSERT — depend on PR #44 / #45.
* `audit_logs` INSERT — user-client audit writes in `features/*`.
* `ALTER DEFAULT PRIVILEGES` — schema-wide on a shared database; per-table revokes only. New tables must revoke explicitly
  (a unit test fails when a new `prompter_*` table is neither listed nor self-locked).
* Not Phase 1 (candidates for Phase 2): privileges that RLS already makes inert (e.g. DELETE on tables with no DELETE policy),
  `REFERENCES`/`TRIGGER`/`MAINTAIN`, the `anon`-executable helper functions.

## Safety properties (all asserted by tests)
Idempotent; skips absent tables (e.g. Phase 2B `prompter_manual_ad_metrics` before it is applied); fails closed inside the
migration if TRUNCATE/anon survive or if any privilege outside the explicit list is lost or gained; no data/RLS/policy/function/
owner/default-privilege change; FK cascades (tenant deletion) run as the table owner and are unaffected.

## Order and conflicts
Independent of PR #31, #44, #45: every statement is a subset of, or disjoint from, what they revoke. Tests prove the final
privilege matrix is identical whether Phase 1 is applied before or after them. Timestamp `20261020190000` sorts after all.

## Tests
`supabase/tests/privilege-phase1/run-local.sh` (CI job `privilege-phase1-sql`; refuses non-local hosts and credentials):
privilege matrix before/after; 46 positive probes (existing reads, checkout INSERT, changePlan `UPDATE(plan)`, AI-job
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

## Rollback (not executed) — fail-closed forward-fix
`supabase/rollback/20261020190000_prompter_privilege_hardening_phase1.down.sql` is **not** a mass restore any more. The previous
version re-granted `select, insert, update, delete, truncate` to anon + authenticated and, after #31/#44/#45, re-opened
**240 privilege cells** (UPDATE on `prompter_ai_jobs` → `created_at` mutable → quota reset; INSERT on `prompter_payment_transactions`;
all of anon; TRUNCATE). The suite keeps that old script only as a test-only negative control
(`support/legacy_mass_restore.sql`) to prove the detector catches the defect.

Now you must name the exact pairs a *verified* broken flow needs:
`psql -v ON_ERROR_STOP=1 -v pairs='prompter_jobs:UPDATE' -f <down.sql>`. Only 9 pairs (`prompter_jobs`, `prompter_platform_capabilities`,
`prompter_product_snapshots` × INSERT/UPDATE/DELETE, authenticated only) can be restored; everything else (TRUNCATE, anon, ai_jobs,
payment_transactions, invoices, webhook_events, plan_entitlements, audit_logs, subscriptions, oauth_credentials) is refused, and the
script is all-or-nothing with a post-check that exactly the named cells changed. Anything else needs its own reviewed migration.
