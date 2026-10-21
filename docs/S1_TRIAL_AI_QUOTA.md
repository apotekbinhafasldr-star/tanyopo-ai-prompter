# S1 — Trial 14 hari & kuota AI (LINOE-only, Draft)

Status: **Draft PR. NOT applied to any database.** Replaces the S1 slice of PR #31 (which also carries S3 trial-abuse and S4 shared-table
changes; those stay out of this PR). Applying needs explicit Founder approval.

## Problem (read-only production catalog, 2026-10-19/21)
- `prompter_ai_jobs`: `authenticated` has table-level INSERT/UPDATE/DELETE/TRUNCATE and the policy is FOR ALL for owner/marketing →
  a tenant can DELETE its own job rows or backdate `created_at` and reset its AI quota (quota = `count(*)` of rows in the period).
- `prompter_subscriptions`: the INSERT policy does not pin `current_period_start/end`/`created_at` → a tenant without a row can insert a
  trial that never expires or starts in the future; DELETE/TRUNCATE are granted (policy blocks DELETE, TRUNCATE ignores RLS).
- `prompter_plan_entitlements`: TRUNCATE granted → empty table makes the (B10) quota function fail open.

## What S1 changes (3 migrations, all LINOE-only, REVOKE/trigger only)
| Migration | Effect |
|---|---|
| `20261019100000_prompter_p0_ai_jobs_lockdown` | `authenticated`/`anon` lose INSERT/DELETE/TRUNCATE on `prompter_ai_jobs`; UPDATE only on the 10 bookkeeping columns `services/ai-jobs.ts` writes. `created_at`, `tenant_id`, `job_type`, `input_reference`, `actor_user_id`, `estimated_cost` are immutable for clients. The SECURITY DEFINER RPC is the only creator of jobs. |
| `20261019100100_prompter_p0_subscription_trial_insert_guard` | BEFORE INSERT trigger (SECURITY INVOKER, only for anon/authenticated): forces `TRIALING`, `FREE`, server `now()` and `now() + interval '14 days'`, resets billing fields. DELETE/TRUNCATE revoked; anon INSERT revoked. `UPDATE(plan)` untouched. |
| `20261019100200_prompter_p0_plan_entitlements_lockdown` | `INSERT/UPDATE/DELETE/TRUNCATE` revoked from anon/authenticated. **Does not redefine the quota RPC** (see below). |

App change: `services/ai-jobs.ts` checks that AI is configured **before** a job is created; the defensive release of an unconfigured job
goes through the server-only admin client (scoped by tenant + id + PROCESSING) and falls back to closing it as FAILED/CONFIG. Clients
never DELETE.

## Why the RPC is not redefined here
`fn_create_ai_job_if_entitled` has its final guarded definition in PR #48 (role check, input validation, fail-closed
`ENTITLEMENT_NOT_CONFIGURED`). Redefining it in S1 would overwrite that guard whenever the order is "wrong". Tests prove: S1 leaves the
function byte-identical; #48 part 1 → S1 keeps the guard; S1 → #48 (part 1 + 2) works; #48 part 2 without S1 refuses.
Until #48 lands, TRUNCATE on the entitlement table is closed by privilege; the in-function fail-closed block arrives with #48.
The #48 role policy (owner/marketing only) is **not** changed here — LINOE user access policy must be confirmed first.

## Deployment order (when approved)
1. Deploy the app change (`services/ai-jobs.ts`) first; 2. apply the 3 migrations; 3. then #48 (part 1, then part 2).
Applying the migrations before the code would make the old user-client DELETE fail silently (the row would stay counted).

## Not in S1
S3 trial anti-abuse (HMAC ledger, gate, claim; default OFF, needs secrets/privacy decision) and S4 shared tables (`tenants`, sibling-product
usage logs; needs cross-product confirmation) stay in PR #31 for now. S1 does **not** stop "new email → new tenant → new trial" farming (S3).

## Rollback (fail-closed, not executed)
`supabase/rollback/20261019100000_prompter_s1_trial_ai_quota.down.sql` is plain SQL. The old #31 rollbacks re-granted
DELETE/INSERT/TRUNCATE/anon and are removed. The only restorable cell is `UPDATE(estimated_cost)` for `authenticated`; everything else
(DELETE, INSERT, TRUNCATE, created_at/tenant_id/job_type, subscriptions, entitlements, trial trigger, anon) is refused. Fix forward instead.

## Tests
`bash supabase/tests/s1-trial-quota/run-local.sh` (CI job `s1-trial-quota-sql`, PostgreSQL 17 enforced): holes reproduced before; 43 checks
after (14-day server-time trial, forged period neutralised, DELETE/backdate/insert/TRUNCATE refused, bookkeeping UPDATE works, tenant A/B
isolation, staff roles, anon, service_role/cascade paths); idempotent apply; 45+45 parallel quota calls = exactly 30 per tenant;
rollback refuses 18 forbidden requests and re-opens nothing; legacy rollback negative control; integration with #48 (both orders) and #46.
Static invariants: `tests/unit/migrations/s1-trial-quota.test.ts`, `tests/unit/services/ai-jobs.test.ts`.
