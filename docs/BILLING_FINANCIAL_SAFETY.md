# Billing Financial Safety (F1–F4) — Draft, NOT applied to any database

Status: **Draft PR. Migration `20261020160000_prompter_billing_financial_safety.sql` is NOT applied anywhere.**
No gateway is activated, no secret/env changed, shared Supabase untouched. Evidence comes from throw-away local/CI
PostgreSQL 16 with synthetic data (`supabase/tests/billing/`).

## 1. Findings fixed

| ID | Problem on main (proven against the real v1 SQL) | Fix |
|----|---------------------------------------------------|-----|
| F1 | Sweep expires PENDING after 24h without asking the gateway; a later PAID is refused (`TRANSACTION_EXPIRED`). | PAID after EXPIRED/FAILED is applied (`LATE_PAYMENT_APPLIED`). Sweep no longer expires a linked invoice until the gateway confirmed "not paid" (or 12 attempts / 7 days → exception). Reconciliation job with backoff; timeout ≠ failure. |
| F2 | One payload with amount 0 flips the transaction to FAILED forever; the valid event is then refused. | Bad payload ⇒ ledger row + OPEN exception, transaction untouched. Later valid event still applies. |
| F3 | Nothing prevents two PENDING checkouts per tenant/plan; double click = two invoices. | `fn_begin_checkout`: per tenant+plan advisory lock, stable `intent_key` (unique per tenant), reuse of the still-valid invoice. Real second payment ⇒ `DUPLICATE_PAYMENT` exception (money kept, no 2nd extension). |
| F4 | Renewal resets to `now()+1 month`, losing paid days (25 days left → 31). | Extends from `max(now, current_period_end)` for same-plan renewals; PAST_DUE/TRIALING start now; plan change with time left ⇒ `PLAN_CHANGE_WHILE_ACTIVE` review (no auto-proration). |

Also closed: subscription missing (F5) no longer a silent PAID; cross-tenant gateway reference ⇒ exception.

## 2. Objects (all additive; v1 `fn_apply_verified_payment` left untouched)

* Columns on `prompter_payment_transactions`: `intent_key, checkout_url, checkout_expires_at, activation_state (NONE|APPLIED|NEEDS_REVIEW), applied_at, reconcile_attempts, next_reconcile_at, last_reconciled_at, gateway_status`.
* `prompter_payment_ledger` — append-only (UPDATE/DELETE/TRUNCATE blocked by trigger), tenant-readable via RLS, every observation kept with the amount/status the gateway reported.
* `prompter_payment_exceptions` — OPEN/RESOLVED/DISMISSED queue, deduped while OPEN, service-role only.
* Functions (service_role only): `fn_begin_checkout`, `fn_record_checkout_session`, `fn_mark_checkout_failed`, `fn_apply_payment_event`, `fn_claim_reconciliation_batch`, `fn_record_reconciliation_attempt`, `fn_resolve_payment_exception`, `fn_open_payment_exceptions`; `fn_expire_stale_payment_transactions` redefined.

## 3. Transaction state machine

```
               fn_begin_checkout
 (none) ───────────────────────────► PENDING ──(invoice linked)──► PENDING+invoice
                                        │                              │
        gateway create fails,           │                              │ webhook / reconciliation
        nothing linked                  ▼                              ▼
        fn_mark_checkout_failed ──► FAILED*              ┌─────────── event ───────────┐
                                                         │                             │
                                  non-PAID (EXPIRED/FAILED/…)                       PAID
                                  ⇒ ledger only (RECORDED),                          │
                                  status unchanged                                   ▼
                                                                         verify: ref, provider, amount>0,
                                                                         currency == expected
                                                                          │            │
                                                                       invalid       valid
                                                                          ▼            ▼
                                                                  EXCEPTION       lock subscription
                                                                  (txn untouched)      │
                          ┌───────────────┬───────────────┬─────────────┴──────────┬───────────────┐
                          ▼               ▼               ▼                        ▼               ▼
                  no subscription   already APPLIED   2nd real payment       plan change      apply period
                  NEEDS_REVIEW      ALREADY_APPLIED   same period            with time left   PAID+APPLIED
                  (PAID kept)       (replay no-op)    DUPLICATE_PAYMENT      PLAN_CHANGE_…    (LATE/RENEWAL flags)
                                                      NEEDS_REVIEW           NEEDS_REVIEW
 EXPIRED/FAILED/PENDING ─(PAID verified)─► PAID   (late payment is NEVER discarded)
 * FAILED only for a row that never reached the gateway.  Sweep: PENDING→EXPIRED only after gateway "not paid".
```

NEEDS_REVIEW never refunds and never revokes access automatically (business decision pending).

## 4. Evidence

`bash supabase/tests/billing/run-local.sh` — before (v1 holes reproduced), after (115+ assertions), rollback ×2, concurrency
(20 parallel same-intent checkouts → 1 txn; 16 identical webhooks → 1 activation; webhook×reconciliation race; two real
payments race → 1 activation + 1 reviewed duplicate; 4 parallel reconciliation workers never share a row). Also run in CI job `billing-sql`.

Required scenarios → tests: 20 parallel checkouts; identical + out-of-order webhooks; PAID after EXPIRED/FAILED; amount-zero then valid;
crash before/after commit; lost webhook + reconciliation; two real payments; renewal with 25 days left; subscription not found;
cross-tenant reference; 14-day trial unchanged; rollback + compatibility with the existing schema/RLS insert path.

## 5. Staged deploy and rollback plan (NOT executed)

1. Founder approval. Take a Supabase backup/PITR point. 2. Apply migration to a Supabase **branch** first; run `billing_after.sql` assertions (adapt role stubs). 3. Apply to production (additive; v1 flow keeps working because v1 function and columns are untouched). 4. Deploy app code (webhook/checkout now call v2 RPCs — **deploy only after the migration**; before it, checkout fails closed). 5. Keep gateway disabled until DOKU/Midtrans verified. 6. Schedule `/api/internal/payments/reconcile` (needs `JOBS_PROCESSOR_SECRET` + scheduler — Founder decision).
Rollback: app first (redeploy previous build), then `supabase/rollback/…down.sql` — refuses to run if ledger/exception/`activation_state<>'NONE'` rows exist unless `app.allow_financial_history_drop='yes'` is set deliberately (forward-fix preferred once real money rows exist).
No backfill of old rows is performed (legacy rows keep `activation_state='NONE'`); a separate reviewed backfill plan is needed.

## 6. Residual risks (F5–F10) and gaps

F5 subscription creation policy (now an exception, still no auto-create) · F6 trial length enforced elsewhere (PR #31 trigger) ·
F7 refund/chargeback policy (statuses not modelled; only recorded) · F8 event-id history (Xendit event id = invoice id) ·
F9 `prompter_invoices` still never written · F10 no grace period. Xendit retry/invoice-expiry behaviour **unverified**.
Direct owner INSERT RLS policy on `prompter_payment_transactions` remains for backward compatibility (cleanup later).
Reconciliation of an adapter without `getPaymentDetails` (Xendit) routes PAID to review instead of crediting.
Vitest/lint/typecheck/build run only in CI (no node_modules in the authoring sandbox).

## 7. DOKU / Midtrans foundation (not wired)

Interface gained optional `getPaymentDetails()`. Still needed per provider (unverified against official docs): multi-header/body signature
verification (single-header interface insufficient for DOKU), richer statuses (REFUNDED/CHARGEBACK/CHALLENGE), event timestamp/order, separate webhook URL, per-adapter production guard.

## 8. Founder decisions

TRIALING remaining-days on first payment · plan change/proration · duplicate-payment credit vs refund · alert channel · reconciliation scheduler/secret ·
drop the owner INSERT policy · backfill plan · DOKU vs Midtrans · refund/chargeback policy.
