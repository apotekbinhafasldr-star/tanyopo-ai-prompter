# LINOE Accounting Reports + Coretax Support Package (Phase C)

Status: **Draft PR, DEMO data only, nothing applied, nothing deployed.** Branch builds on the Admin Center (PR #62) and the finance foundation (PR #61).

## What exists
| Area | Where | Notes |
|---|---|---|
| Chart of Accounts | `lib/accounting/coa.ts` | **Proposed template** (structure only, no balances). The accountant must approve it. |
| Double-entry ledger | `lib/accounting/ledger.ts`, `journal.ts` | Balanced, two-sided, referenced, audited. Posted journals are frozen; no update/delete. Corrections = reversing journal (once, never reversed again). Closed periods reject posting. |
| Reports | `lib/accounting/statements.ts` | Trial balance, income statement, balance sheet (Assets = Liabilities + Equity, difference shown), direct cash flow, general ledger. Always `final: false`. |
| AR / AP | `lib/accounting/ar-ap.ts` | Sub-ledger, aging buckets, control-account reconciliation. |
| Bank reconciliation | `lib/accounting/bank-rec.ts` | One-to-one matching; final only if the unexplained difference is zero **and** a person finalises it. |
| Period-end | `lib/accounting/adjustments.ts` | Accrual, prepayment expiry, depreciation, deferred-revenue release, year-end closing: drafts only, amounts supplied by the accountant. |
| From PR #61 | `lib/accounting/from-finance.ts` | Journals are derived from the verified finance snapshot with the **same idempotency keys** (`payment|…`, `refund|…`, `settlement|…`, `expense|…`) so nothing is recorded twice. Changed facts are reported as conflicts, never overwritten. |
| Fiscal | `lib/accounting/fiscal.ts` | Only **verified** adjustments / loss carry-forward / rate count. No default rate. LINOE is always a *segment*; entity view stays INCOMPLETE until other activities are supplied and verified. |
| Coretax support package | `lib/coretax/*` | Hand-written ZIP / XLSX / PDF (no new dependency) + CSV + README + `manifest.json` with SHA-256. **No XML** (no validated DJP spec). Not an import file. |
| UI | `features/admin/premium/*`, `app/admin/finance/**` | Navy/cyan/blue scoped theme, KPI cards with exact trend, interactive SVG chart, period/status filters, loading/error/empty states, mobile cards. |
| Migration (review only) | `supabase/migrations/20261027120000_linoe_accounting_ledger.sql` | Not applied. Verified on a throwaway PG16 (see below). Rollback refuses if any row exists. |

## Security
- Founder (SUPER_ADMIN) holds everything. **Refund approval is Founder-only**: removed from the legacy FINANCE_ADMIN set, cannot be granted to STAFF, and is not an allowed value in the `permissions` column.
- New permissions `accounting.view` (journals/reports) and `tax.export` (sensitive). `finance.view` only sees dashboard aggregates.
- `POST /admin/finance/tax/coretax-package`: flag on, same-origin, `tax.export` **and** `accounting.view` verified server-side, audited; real-data exports fail closed if the audit write fails (DEMO proceeds, labelled). POST only; no GET.
- No login to Coretax, no SPT filing, no tax payment, no DJP endpoint anywhere.

## DEMO vs real
Everything on screen is fictional DEMO data (Sep–Nov 2026) until the migrations are approved and applied and a real ingestion job exists. The demo capital journal is fictional and labelled; real books get an opening balance only from an `OPENING` journal with evidence.

## Verified on throwaway PG16 (not any real project)
unbalanced / one-sided / empty / header-account / duplicate-key / no-reference journals rejected; update, delete, truncate blocked; reversal once only, no reversal of a reversal; closed period blocks posting; reopen needs a reason; tax rate without verifier, tax payment without proof and a final reconciliation with a difference are rejected; anon/authenticated/service_role cannot delete; rollback refuses with data, succeeds on empty, migration re-applies cleanly.

## Still needed from humans
Accountant approval of the CoA, revenue-recognition policy, PKP status, tax rates, fiscal adjustments; DJP-validated XML spec (if XML attachments are ever wanted); Founder decision on applying migrations (order: 100000, 110000, 120000), first Super Admin seed, Midtrans ingestion job.
