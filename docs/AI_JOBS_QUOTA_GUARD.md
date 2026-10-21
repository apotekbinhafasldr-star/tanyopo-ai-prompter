# AI Jobs quota guard (Draft)

Status: Draft PR, **not applied anywhere**. Tested only on a throw-away local PostgreSQL with synthetic data.

## Problem (reproduced locally on `main`)
- `fn_create_ai_job_if_entitled` is SECURITY DEFINER with no role check: member/kasir of a tenant could consume its AI quota.
- `job_type` / `input_reference` were not validated by the RPC (a 2 MB `input_reference` was accepted).
- Quota = number of `prompter_ai_jobs` rows in the period, so DELETE, backdating `created_at` or moving `tenant_id` resets it.

## What this PR changes
| Part | Migration | Effect |
|---|---|---|
| 1 | `20261021120000_prompter_ai_jobs_quota_guard.sql` | RPC (same signature/maths): `ROLE_NOT_ALLOWED` (not owner/marketing, from `fn_current_role()`/`auth.uid()`), `INVALID_JOB_TYPE` (the 6 app types), `INVALID_INPUT` (not an object or > 64 KiB). BEFORE UPDATE trigger: `id, tenant_id, actor_user_id, job_type, input_reference, created_at` immutable for anon/authenticated. BEFORE TRUNCATE trigger. Includes PR #31's `ENTITLEMENT_NOT_CONFIGURED` block. No grant/revoke. |
| 2 | `20261021120100_prompter_ai_jobs_delete_guard.sql` | BEFORE DELETE trigger for anon/authenticated. **Refuses to apply** unless PR #31 is applied (authenticated has no DELETE) and part 1 is live. |

Not done on purpose: no new ledger, no cost cap, no allowance/period/trial change, no PUBLOE/UMKMpro AI/Apotek object touched.

## Dependencies / order
1. PR #31 first (its migration `20261019100200` re-creates the RPC *without* the role check, so it must come before part 1; file order already guarantees it; part 2 detects the wrong order and refuses).
2. #44, #45, #46 are independent of this PR (none redefines the RPC or the ai_jobs triggers).
3. Part 2 also needs #31's app change (server-side job release); until then, the user-client delete in `services/ai-jobs.ts` would be blocked.

## Rollback
`supabase/rollback/*.down.sql` (not auto-applied). Rollback 2 drops the DELETE trigger only. Rollback 1 drops the triggers and restores the RPC to the **#31 definition** (fail-closed), never to the older B10 body. Neither contains a GRANT.

## Tests
`bash supabase/tests/ai-jobs-guard/run-local.sh` (CI job `ai-jobs-guard-sql`): 37 assertions × variants main / +#31 / +#31+#44+#45+#46, 80 parallel calls, apply-order hazard, idempotency, rollback, re-apply. Static invariants: `tests/unit/migrations/ai-jobs-quota-guard.test.ts`.
