# Billing B3 — Midtrans payment verification (SANDBOX ONLY)

Status: implemented in PR (Draft). **No database migration. No production SQL. Live payment stays HOLD.**
Scope decision (Founder, 30 Oct 2026): gateway = Midtrans; B3 is sandbox only; a production server key is refused.

## What changed
| Area | Change |
|---|---|
| `lib/billing/providers/midtrans-payment-provider.ts` | New adapter: Snap checkout, SHA512 notification signature (constant-time), server-to-server Get Status (`getVerifiedPayment`), strict status mapping. Sandbox hosts hard-coded; only `SB-Mid-server-…` keys accepted. |
| `lib/billing/payment-provider.ts` | New optional `getVerifiedPayment()` + `VerifiedPayment` types. |
| `services/payment-verification.ts` | One guarded path (`verifyAndSettle`) used by the webhook **and** the return-from-checkout page. |
| `services/payment-webhook.ts` | For a server-verifiable provider the notification body is only an untrusted *pointer* (which order to ask about). |
| `services/payment-reconciliation.ts` | Return trip now asks Midtrans from the server and settles through the same path (throttled 6/min/transaction). |
| `app/api/webhooks/payment/route.ts` | Body limited to 64 KB before anything else (413). Path unchanged. |
| `lib/billing/read-body-limit.ts` | Streaming size-limited body reader. |
| Xendit | Unchanged (sandbox, static token, not verified server-side). It is not the chosen gateway; do not select it. |

## Trust model
1. **Signature** — `SHA512(order_id + status_code + gross_amount + ServerKey)`, compared in constant time. It proves the notification came from someone holding our server key, but it does **not** cover `transaction_status`, so it is necessary, not sufficient.
2. **Get Status (mandatory)** — the server asks Midtrans for the order (`GET /v2/{order_id}/status`, Basic auth, 5 s timeout, 64 KB cap). Status, amount, currency and the payment reference used for activation come **only** from this answer. Nothing from a webhook body or a browser redirect is used to move a subscription.
3. **Ownership** — `order_id` is our own `prompter_payment_transactions.id` (UUID shape enforced before it touches a URL); the row must exist and have `provider = 'midtrans'`. The return trip reads the row with the caller's tenant-scoped session first.
4. **Paid means exactly**: `settlement`, or `capture` with `fraud_status = accept`, with `status_code = 200` and no contradicting fraud status. `challenge`, `deny`, `cancel`, `expire`, `failure`, `refund`, `chargeback` and any unknown status/combination never activate.
5. **Amount/currency** — the gateway's values go to `fn_apply_verified_payment` (B2), which compares them with the invoice; anything else becomes `REVIEW`.

## Outcomes
| Situation | Result |
|---|---|
| Wrong/missing signature | 401, nothing read or written |
| Body > 64 KB | 413 |
| Midtrans timeout / 5xx / garbage / wrong order / bad signature on the answer | 503 (Midtrans retries), event `FAILED`, nothing activated |
| Notification says paid, Midtrans says pending | 503 retry |
| Notification says paid, Midtrans says cancel/expire/deny | 200, event `FAILED / STATUS_MISMATCH_CLAIMED_PAID`, pending invoice closed, nothing activated |
| Notification says pending/expire, Midtrans says paid | Midtrans wins → activates once |
| Verified paid, replay ×N or parallel | one period (B2 idempotency + row locks) |
| Verified paid on EXPIRED/CANCELLED/FAILED invoice, wrong amount/currency, plan conflict | `REVIEW` (B2): money recorded, subscription unchanged |
| Verified cancel/expire/deny on a PENDING invoice | invoice closed (`GATEWAY_*`); PAID/REVIEW rows never touched |
| Refund / chargeback (any invoice) or cancel/void of an already PAID invoice | **no subscription change**; one de-duplicated audit row `payment.refund_reported` / `payment.chargeback_reported` / `payment.reversal_reported` with `context.alarm = "PENDING_B4"`; event `FAILED / ALARM_*`; HTTP 200. If the audit row cannot be written → 500 so Midtrans retries |
| Invoice created by another provider / unknown order / non-UUID order id | 400, Midtrans never called |

### Alarm — honest status
B3 only **records** refund/chargeback/reversal evidence. **No operational alarm exists until B4** (a reader of `payment.*_reported` audit rows and `REVIEW` transactions that notifies a person). Do not rely on these rows being seen by anyone yet.

## Secrets
- The Midtrans server key lives only in the server environment (`PAYMENT_PROVIDER_API_KEY`); `PAYMENT_PROVIDER_WEBHOOK_SECRET` is unused for Midtrans. It is never logged, returned, put in a URL, or exposed via `NEXT_PUBLIC_*` (static test `midtrans-static-guards`).
- Nobody should paste it into chat. Netlify env is **not changed by this PR**.

## Not in B3 (unchanged residuals)
- B4: alert on `REVIEW` rows and `payment.*_reported`.
- B6: `Origin`-derived redirect URLs are not allow-listed (Midtrans `callbacks.finish` is built from them).
- B7: audit log is writable by tenant members through existing grants.
- The resolver `fn_resolve_review_payment` still has no application caller; resolving `REVIEW` stays manual.
- Snap `expiry` is left at Midtrans' default (24 h, matching the 24 h stale-invoice sweep); explicit expiry needs a sandbox-confirmed parameter.
- To confirm in the Midtrans sandbox before any go-live discussion: status codes per status, that Get Status returns `currency`, `callbacks.finish` behaviour, notification URL registration (`<domain>/api/webhooks/payment`).
- Netlify Deploy Previews cannot receive third-party webhooks (login wall), so end-to-end sandbox payment tests need the production domain with a **sandbox** key — a separate Founder decision, not part of this PR.

## Rollback
Revert the PR and clear `PAYMENT_PROVIDER_NAME` → `NullPaymentProvider` (webhook 503, checkout refused). No database change to undo.

## Tests (run in CI)
`tests/unit/lib/midtrans-payment-provider.test.ts`, `read-body-limit.test.ts`, `midtrans-static-guards.test.ts`,
`tests/unit/services/payment-webhook-midtrans.test.ts` (forged/manipulated/mismatch/replay/parallel/out-of-order/late/refund/chargeback/challenge/deny/cross-provider/cross-tenant/gateway failure),
`payment-reconciliation-midtrans.test.ts` (verified return trip, forged "success" redirect, cross-tenant, throttle).
Database-level concurrency and REVIEW behaviour remain covered by `supabase/tests/b2-double-payment`.
