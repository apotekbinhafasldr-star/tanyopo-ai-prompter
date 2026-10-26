# LINOE Finance & Tax foundation (Phase A)

Status: **foundation only**. No dashboard UI, no data ingestion job, and **the migration is not applied to any environment**.

## Four layers that are never merged

| Layer | Meaning | Where |
|---|---|---|
| Verified payment | Gateway confirmed it (webhook) and it was recorded | `FinanceBook.ingestPayment` |
| Recognised revenue | The part earned over the service period, net of refunds | `lib/finance/revenue.ts` |
| Settled funds | Money the gateway actually paid out | `lib/finance/reconciliation.ts`, `summary.ts` |
| Refunds and fees | Reductions, tracked separately | `refunds.ts`, `FinanceBook.ingestGatewayFee` |

## Rules baked into the code

- Money is `bigint` minor units (scale 2). No floating point anywhere; more than two decimals or exponent notation is rejected, not rounded.
- Every fact has a deterministic idempotency key (same strings as `finance_ledger_entries.idempotency_key`). A repeat is a no-op; a different fact under the same key is a conflict and stops.
- Only PROCESSED refunds count, and never beyond the payment balance (excess is reported as `OVER_REFUND`).
- Revenue recognition is straight-line per day over the service period. **Placeholder pending the accountant**; only `revenue.ts` changes if the policy changes.
- No tax rate or tax status is assumed. `TaxConfig` must be marked verified (who + when); otherwise tax amounts are `NOT_CONFIGURED`. The database refuses a rate without a verifier.
- Settlement lateness needs an explicit `lateAfterDays`; there is no assumed gateway payout time.
- CSV export neutralises spreadsheet formulas in free text (`= + - @ TAB CR`); money is rendered from typed values.

## Access

Finance data is platform-wide. Access requires an active row in `finance_platform_admins` (`FINANCE_ADMIN` or `FINANCE_VIEWER`), checked in `services/finance-admin.ts`. A tenant `owner` is **not** enough. The check fails closed (not signed in, no row, revoked, lookup error, missing service key). The service-role client is only handed to the callback after the gate passes.

## Database (migration file only)

`supabase/migrations/20261027100000_linoe_finance_foundation.sql` adds seven `finance_*` tables. It touches no existing object. RLS is on with no policies, `anon`/`authenticated` have no grants, `service_role` has no DELETE/TRUNCATE, ledger/audit/tax rows are immutable by trigger, expenses can only be voided. Rollback: `supabase/rollback/20261027100000_linoe_finance_foundation.down.sql` (refuses if any table has rows).

Verified on a throwaway local PostgreSQL 16 (not production): applies cleanly in one transaction, blocks UPDATE/DELETE/TRUNCATE on ledger and audit, rejects duplicate idempotency keys, rejects an unverified tax rate, denies anon/authenticated/service-role delete, and the rollback refuses with rows and drops cleanly when empty.

## Not done yet

Midtrans adapter and its refund/fee/settlement payload mapping (unverified), ingestion job from `prompter_webhook_events`, seeding the first admin row, dashboard UI, and `types/database.ts` entries for the new tables.
