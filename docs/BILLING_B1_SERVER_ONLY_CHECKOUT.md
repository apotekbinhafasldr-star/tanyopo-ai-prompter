# Billing B1 — server-only, catalog-priced checkout

Status: Draft PR. **Not applied to any database.** Live payments stay on HOLD.

## Problem (Billing P0 audit)
An Owner could `INSERT` a `PENDING` row into `prompter_payment_transactions` directly over PostgREST with any
plan, amount, currency and provider (policy "Buat payment transaction tenant sendiri"), and the evidence table still
carried client `UPDATE` / `DELETE` / `TRUNCATE` grants. Price validation lived only in application code.

## Change
| Layer | What |
|---|---|
| `prompter_plan_prices` | Database price catalog (STARTER 99.000, GROWTH 199.000, PRO 399.000, BUSINESS 799.000 IDR). No client access. A unit test fails if it drifts from `lib/billing/plans.ts`. |
| `fn_begin_checkout(tenant, user, plan, provider)` | `service_role` only, `SECURITY DEFINER`. **No amount / currency parameter.** Re-verifies in SQL: user is an Owner of that tenant, plan has a price and is `ACTIVE`, subscription exists; caps open `PENDING` rows (10/hour/tenant). |
| `trg_prompter_payment_txn_insert_guard` | Defense in depth for every role: new rows must be clean `PENDING` and match the catalog price/currency; client roles rejected. |
| Grants / policy | Client INSERT policy dropped; all client privileges on the table revoked, `SELECT` (own tenant via RLS) kept for `authenticated`. |
| App | `services/checkout.ts#startCheckout` calls the RPC with the service-role client (no tenant-client insert, no fallback). DB price must equal the code catalog or the transaction is marked `FAILED` and no gateway call is made. |
| `20261030100100` (separate, optional order) | Trial remainder carryover: on the first paid `TRIALING → ACTIVE` the unused trial days (max 14) are added to the first paid period. Renewals, replays and expired trials are unaffected. Trial length is unchanged. |

Compatible with PR #74: `prompter_subscriptions`, `fn_set_trial_plan_preference` and `fn_apply_verified_payment` are not modified.

## Tests
* `supabase/tests/b1-checkout/run-local.sh` (CI job `billing-b1-sql`, PostgreSQL 17, synthetic data): hole reproduced before; Owner / non-owner / anon cannot insert, update, delete or truncate after; RPC not callable by clients; every outcome of the RPC; tenant isolation; webhook path (`fn_apply_verified_payment`) still activates and stays idempotent; #74 intact; S1 in both orders; idempotent re-apply; fail-closed rollbacks; carryover cases.
* `tests/unit/services/checkout.test.ts`, `tests/unit/migrations/b1-server-only-checkout.test.ts`.

## Apply order (Founder, SQL Editor, project `umkmpro-ai`; never `db push`)
1. Backup confirmed. Apply `20261030100000` (one transaction), run the read-only verification, record the ledger row.
2. Merge the PR (Netlify deploys). While the provider is not configured checkout fails closed either way.
3. Apply `20261030100100` (carryover) the same way — can be done later, independently.

## Rollback
`supabase/rollback/20261030100000_*.down.sql` — fail-closed (placeholder must be replaced with
`I_UNDERSTAND_THIS_REOPENS_CLIENT_TXN_INSERT`). Restores only the INSERT policy + privilege that the legacy app code needs;
never re-grants UPDATE / DELETE / TRUNCATE; keeps the price table. `20261030100100` rollback just drops the trigger.

## Out of scope (later stages)
Gateway-side verification of payments (B3), alerts (B4), invoices (B5), Midtrans adapter (B6), audit-log hardening (B7),
intent-key checkout reuse, evidence tables other than `prompter_payment_transactions`.
