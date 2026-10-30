# Billing B2 — double payment safety & payment idempotency

Status: Draft PR. **Not applied to any database. Live payments stay HOLD.**

## Rules (Founder-approved)
1. Same plan while ACTIVE and the paid period still runs → **one period (1 month) is added** to `current_period_end`; nothing paid for is overwritten. Expired period → counted from the activation time.
2. Different plan while a paid period runs → `fn_begin_checkout` refuses (`PLAN_CHANGE_NOT_ALLOWED`). An old invoice for another plan that is paid anyway is **not applied**: it becomes `REVIEW` (payment evidence kept, subscription untouched).
3. At most **one PENDING invoice per tenant** (partial unique index → race-proof). Identical request within 30 min → same invoice (`EXISTING`, stored payment link reused). A different plan/provider supersedes the old invoice (`CANCELLED`).
4. The subscription UPDATE must affect **exactly one row**, else the whole call fails (nothing stays `PAID`) and the gateway retries. Idempotency per transaction is unchanged; the trial-remainder bonus (carryover trigger) still applies once, only on TRIALING → ACTIVE.
5. A paid notification for an EXPIRED / CANCELLED / FAILED invoice, with a wrong amount, with no subscription or with a plan conflict is **never dropped and never auto-trusted**: status `REVIEW`, reason in `failure_reason`, provider ids + reported amount in `metadata.review`, audit row `payment.needs_review`. HTTP 200 only means "recorded"; the webhook event row is `FAILED / NEEDS_REVIEW`, never `PROCESSED`.
6. `fn_resolve_review_payment(txn, gateway_amount, gateway_currency)` (service_role) re-runs the guarded activation **only after the caller verified the payment with the gateway** (B3). Until then the transaction stays `REVIEW`.

## Files
- `supabase/migrations/20261030140000_prompter_b2_double_payment_safety.sql` (+ rollback `supabase/rollback/…down.sql`, fail-closed while any REVIEW row exists)
- `services/checkout.ts`, `services/payment-webhook.ts`, `services/payment-reconciliation.ts`, `app/(app)/billing/page.tsx`, `types/database.ts`
- Tests: `supabase/tests/b2-double-payment/` (CI job `billing-b2-sql`), `tests/unit/migrations/b2-double-payment-safety.test.ts`, updated `checkout` / `payment-webhook` unit tests.

## Apply (after Founder approval, via SQL Editor, never `db push`)
Preflight: no tenant may have more than one PENDING transaction (the unique index would refuse). Then apply, verify read-only, record the ledger — same pattern as B1.

## Operating `REVIEW`
`select id, tenant_id, plan, amount, failure_reason, metadata->'review' from prompter_payment_transactions where status = 'REVIEW';` — settle each one: verify with the gateway, then `fn_resolve_review_payment`, or refund at the gateway. Alarms for new REVIEW rows are B4.

## Known remaining risks
- Webhook authenticity is still a static token (B3); the resolver trusts its caller to have verified the gateway.
- A plan-conflict REVIEW has no automated outcome (refund or apply after the period) — manual until B4/B5.
- The stored payment link lives in `metadata` (readable by members of the same tenant only).
- The 30-minute reuse window and the 20-attempts-per-hour cap are constants in the migration.
