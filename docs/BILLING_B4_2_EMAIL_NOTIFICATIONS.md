# Billing B4.2 — E-mail notifications for payment alerts (development only)

Status: **implemented on a feature branch, NOT applied to production, NOT enabled.** Live payments and the Budget Gate stay on HOLD.
Nothing here sends an e-mail until the Founder (1) applies the migration, (2) sets the Netlify environment, (3) sets `ALERT_EMAIL_ENABLED=true`.

## Design in one page
```
alert path (B4.1, UNCHANGED)           outbox (B4.2)                              sender (Netlify Scheduled Function, every 5 min)
fn_record_payment_alarm / sync  --->   prompter_payment_alerts (OPEN)
                                         |  derived by the claim function         fn_claim_payment_notification_batch  --> frozen batch
                                         v                                        fn_payment_notification_recipient_emails --> addresses
                                       notifications (alert_id, sequence)         POST Resend (Idempotency-Key = batch id + generation)
                                       batches (frozen subject/body, key)         fn_complete_… / fn_fail_…
                                       attempts (append-only audit)
```
* **Transaction boundary / webhook safety.** The webhook, `fn_record_payment_alarm` and `fn_sync_payment_alerts` are not modified (a test compares every B4.1 function definition before and after). Notifications are *derived* from the alert truth inside the claim function, so an outbox failure, a locked or missing table, or a dead sender cannot fail, roll back or slow a webhook (test 3g locks the whole outbox table and the alarm path still answers). A notification that was never created is re-derived on the next claim (self-healing).
* **Dedupe.** `UNIQUE (alert_id, sequence)`, `sequence = 1 + reopened_count`. A replay (same evidence) never creates a row; a REOPEN creates exactly one new row. Only `OPEN` alerts are notified; an alert acknowledged/resolved before sending is `SKIPPED`.
* **Freeze before send.** Subject, text, recipient UUIDs and a SHA-256 payload hash are written in the batch row; a trigger forbids changing them. The idempotency key is `batch_id-key_generation`.
* **Atomic claim.** `pg_try_advisory_xact_lock` (second runner gets `BUSY`) + `FOR UPDATE SKIP LOCKED` + a lease (5 min). Crash => lease expires => the same batch is retried with the same key (audited as `LEASE_EXPIRED`). A late report from an old attempt is `STALE` and ignored.
* **Retry.** Max 6 attempts, backoff 1 / 5 / 15 / 60 / 240 min, hard stop 23 h after the first attempt (Resend remembers an idempotency key for 24 h, so a retry never runs where the key could have been forgotten) -> `DEAD`. 4xx other than 401/403/409/429 is permanent. `409 invalid_idempotent_request` rotates the key generation (the payload is frozen, so this should never happen).
* **Merge + budget.** One e-mail carries up to 20 alerts, CRITICAL first. At most **20 e-mails per UTC day**; the last 5 slots are reserved for CRITICAL (`RESERVE_HELD`). Over the limit => stays pending and merges into the next day's e-mail. The limit can be lowered with `ALERT_EMAIL_DAILY_LIMIT`, never raised above 20.
* **Recipients.** Active rows of `prompter_payment_operators` whose `auth.users` e-mail is confirmed, not banned, not deleted — resolved by UUID at send time. No address is hard-coded. No recipient => `NO_RECIPIENT`, nothing is sent, alerts stay pending.
* **Content.** Kind, severity, the first 8 characters of the alert id, reopen count and a link. No tenant name, amount, address or credential.
* **Isolation.** 4 new tables `prompter_payment_alert_*` (RLS on, no policy, all privileges revoked from public/anon/authenticated/service_role, `SELECT` to service_role only) and 6 `fn_*` functions (SECURITY DEFINER, `search_path = public, pg_temp`, service_role only). No PUBLOE / UMKMpro object, no `ALTER` of an existing table, no cron, no pg_net.
* **Visibility.** `/ops/payments` shows the sender heartbeat (not active / running / failing / not running) and the number of batches that gave up, so a silently dead scheduler is noticed by the operator.

## Environment (Netlify only, never in git) — all unset today
| Variable | Meaning |
|---|---|
| `ALERT_EMAIL_ENABLED` | must be exactly `true`; anything else => the function does nothing and never touches the database |
| `ALERT_EMAIL_DRY_RUN` | `true` => read-only counts, no claim, no e-mail (use this first) |
| `RESEND_ALERT_API_KEY` | dedicated key, *sending access* only |
| `ALERT_EMAIL_FROM` | verified sender, planned `alerts@tanyopo.com` |
| `ALERT_EMAIL_LINK_BASE` | https base URL of the app for the link |
| `ALERT_EMAIL_DAILY_LIMIT` | optional 1..20 |
Re-uses the existing `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY`.

## Tests
* `supabase/tests/b4-2-notifications/run-local.sh` (CI job `billing-b42-sql`, PostgreSQL 17): privileges/RLS, derive, replay, reopen, ack-before-send, merge + CRITICAL order, frozen payload, crash + lease retry (same key), STALE report, backoff, key rotation, permanent failure, 6-attempt DEAD, 23 h stop, daily limit, CRITICAL reserve, no recipient, recipient filtering, append-only audit, 12 parallel claims, 10 parallel crash-retries, 8 parallel completes, claim-vs-record race, outbox-locked-but-alarm-path-works, rollback (refuses with rows / clean when empty) and re-apply, B4.1 definitions identical, money tables identical.
* `tests/unit/netlify/notifier-core.test.ts`: disabled / misconfigured / dry run / happy path / every provider status / network + timeout / no secret in logs / limits.
* `tests/unit/lib/notification-static-guards.test.ts`: no secret or address in code, default off, self-contained bundle, additive migration, `.env.example` placeholders only.

## NOT VERIFIED (do not treat as PASS)
1. That Netlify actually runs the function every 5 minutes (needs a production deploy; scheduled functions run only on published deploys and cannot be invoked by URL; the minimum interval is not documented).
2. That `@netlify/plugin-nextjs` 5.x coexists with and bundles `netlify/functions/*.ts` with its relative import (CI/build log of a deploy preview is the first evidence; "Run now" works on previews).
3. Real delivery through Resend (no e-mail was sent anywhere), and that Resend's per-day quota resets on the UTC day.
4. Behaviour of the shared Resend quota (Free: 100/day) under signup load: notifications use at most 20/day, leaving 80 for Supabase Auth e-mails.

## Rollout (each step needs Founder approval; none was done)
1. Merge + deploy: the schedule registers but is a no-op while `ALERT_EMAIL_ENABLED` is not `true`.
2. Apply the migration in the Supabase SQL Editor (a production apply file is prepared separately). Verify with `fn_preview_payment_notifications()`.
3. Set `RESEND_ALERT_API_KEY`, `ALERT_EMAIL_FROM`, `ALERT_EMAIL_LINK_BASE`, `ALERT_EMAIL_DRY_RUN=true`, `ALERT_EMAIL_ENABLED=true` in Netlify; check the dry-run counts in the function log.
4. Remove `ALERT_EMAIL_DRY_RUN`; the first real e-mail is the Founder's own alert backlog (merged into one e-mail).

## Rollback
* Immediately: set `ALERT_EMAIL_ENABLED` to anything but `true` (no deploy needed).
* Schema: `supabase/rollback/20261101100000_prompter_b4_2_alert_notifications.down.sql` (refuses while notification rows exist — export them first; run it before the B4.1 rollback).
