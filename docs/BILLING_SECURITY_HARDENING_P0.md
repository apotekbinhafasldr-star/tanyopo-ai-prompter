# Billing Security Hardening P0 — Draft, NOT applied to any database

Migration `20261020180000_prompter_billing_security_hardening_p0.sql` (+ rollback) is **not applied anywhere**.
Evidence = throw-away local/CI PostgreSQL 16, synthetic data, schema rebuilt from this repo's migrations with
Supabase-style default privileges. The live production catalog has **not** been re-read for this PR.

## Findings closed
| # | Hole (reproduced on main: `hardening_before.sql`) | Fix |
|---|---|---|
| 1 | Owner `UPDATE prompter_subscriptions SET plan=…` on any status (column grant + policy "Owner kelola subscription"): ACTIVE STARTER → BUSINESS unpaid | Policy dropped, UPDATE revoked. Trial plan *preference* only via `fn_set_trial_plan_preference()` (SECURITY DEFINER, pinned search_path, tenant/role from JWT, Owner + TRIALING only) |
| 2 | Owner INSERT into `prompter_payment_transactions` (forged amount/plan/checkout columns) | Policy dropped, INSERT/UPDATE/DELETE/TRUNCATE revoked; creation only by service role (PR #44 `fn_begin_checkout`) |
| 3 | anon **and** authenticated hold TRUNCATE/DELETE/UPDATE on payment transactions, invoices, webhook events, audit logs (TRUNCATE ignores RLS) | Revoked (audit log keeps own-tenant INSERT) |
| 4 | First payment during trial burns the unused trial days | Trigger `trg_prompter_subscriptions_trial_carryover`: TRIALING→ACTIVE with a period change adds remaining trial (cap 14 days). Works for v1 and PR #44 functions; no data rewritten |

No row is modified; existing tenants' subscriptions are byte-identical after the migration (test P0 hash).

## Code
`services/billing.ts#changePlan` now calls the RPC instead of UPDATE (same UX messages). No other app code changes.
Writers audited by grep: invoices / webhook events / payment transactions are written only with the service-role client.

## Audit of the rest (read-only findings; only the above is changed)
* SECURITY DEFINER functions (15): all pin `search_path`; billing mutators (`fn_apply_*`, sweeps) are service_role-only; `fn_schedule_cancellation`/`fn_activate_product`/`fn_create_ai_job_if_entitled`/`fn_reserve_active_campaign_slot` are authenticated-callable and derive tenant/role from the JWT.
* RLS enabled on all billing tables; policies tenant-scoped.
* Endpoints: `/api/webhooks/payment` (signature), `/api/internal/jobs/process` (Bearer, constant-time), `/api/v1/integrations/umkmpro/*` (HMAC, untouched), `/api/connections/*` and `/api/demo/start` (not billing).
* **Not changed, needs Founder decision:** ~25 other `prompter_*` tables still grant anon/authenticated TRUNCATE/DELETE (PR #31 covers only ai_jobs/entitlements/subscriptions/shared); default privileges give every future table ALL again; `prompter_audit_logs` INSERT lets a tenant forge its own audit rows (tenant-scoped).

## Cross-PR
* **#44**: this migration refuses to run before `fn_begin_checkout` exists (otherwise the legacy `services/checkout.ts` INSERT path would be cut with no replacement). Deploy #44 migration + code first.
* **#31**: independent; both orders and "hardening first" tested. Hardening intentionally does not touch ai_jobs / entitlements / subscriptions DELETE-TRUNCATE (owned by #31).
* **#43**: no overlap.
* Textual: `.github/workflows/ci.yml` (append-only, trivial), `services/billing.ts` (different hunks than #31, verified with `git merge-tree`).

## Rollout (not executed)
Backup/PITR → Supabase branch → apply #31 (if approved) and #44 → deploy #44 code → apply this migration → deploy this code (**code and migration within one release window**: old `changePlan` against the new migration fails with "Gagal mengubah paket", no outage) → verify. Rollback: code first, then the down script (restores the vulnerable grants; prefer forward-fix).

## Remaining risk
Live catalog unverified; Xendit/DOKU/Midtrans unchanged; other tables' TRUNCATE; audit-log forgery; default privileges; the PR #44 INSERT-policy gap (forged `checkout_url`) is closed by this migration only once applied.
