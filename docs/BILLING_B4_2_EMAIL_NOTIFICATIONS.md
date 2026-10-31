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
* **Freeze before send (P2-1).** Sender, recipient ADDRESSES, subject, text, recipient UUIDs, the idempotency key (`<batch id>-1`) and a SHA-256 payload hash are written in the batch row at creation; a trigger forbids changing them. The sender code sends exactly those values, so every retry is byte-identical even if the env or an operator's e-mail changed meanwhile. The key is never rotated (a rotated key could send the same e-mail twice). Consequence: an operator removed after a batch was frozen can still receive THAT batch's retries; the removal applies to the next batch.
* **Atomic claim.** `pg_try_advisory_xact_lock` (second runner gets `BUSY`) + `FOR UPDATE SKIP LOCKED` + a lease (5 min). Crash => lease expires => the same batch is retried with the same key (audited as `LEASE_EXPIRED`). A late report from an old attempt is `STALE` and ignored.
* **Retry.** Max 6 counted attempts, backoff 1 / 5 / 15 / 60 / 240 min, hard stop 23 h after the first attempt (Resend remembers an idempotency key for 24 h, so a retry never runs where the key could have been forgotten) -> `DEAD`. 4xx other than 401/403/409/429 is permanent (flagged, never re-queued).
* **Recovery (P1-1) — no alert stays un-mailed.**
  * Provider `401`/`403` (wrong key, domain not verified): the batch is **held**, no attempt is used up, it retries every 30 min until the 23 h stop, so fixing the key in Netlify is enough.
  * A batch that dies is **re-queued** (max 3 times) for every alert that is *still OPEN*: **at once** when the provider definitely never accepted it (401/403/429), and **after 24 h** (idempotency window over) when delivery is uncertain (timeout, network, 5xx, crash) — then the line is marked `· pengingat` so a second mail is a visible reminder, never a silent duplicate. Alerts acknowledged/resolved meanwhile are not re-queued.
  * The alert itself is always recorded in the queue (B4.1) regardless of e-mail; `/ops/payments` shows the sender heartbeat, "no active recipient" and the number of batches that gave up.
* **Merge + budget (P2-4).** One e-mail carries up to 20 alerts, CRITICAL first. At most **20 e-mails per UTC day** (hard cap in the function: 1..20); the last 5 slots are reserved for CRITICAL (`RESERVE_HELD`). A batch uses a slot on the day it was created, on the day it is sent and on every day it is still waiting READY, so a retry that crosses midnight cannot push the day over the limit; retries of an already-owed batch are never blocked. Over the limit => stays pending and merges into the next e-mail. `ALERT_EMAIL_DAILY_LIMIT` can lower it, never raise it. Keeps at least 80 of Resend's 100 free e-mails/day for Supabase Auth.
* **Recipients.** Active rows of `prompter_payment_operators` whose `auth.users` e-mail is confirmed, not banned, not deleted — resolved by UUID at send time. No address is hard-coded. No recipient => `NO_RECIPIENT`, nothing is sent, alerts stay pending.
* **Content.** Kind, severity, the first 8 characters of the alert id, reopen count and a link. No tenant name, amount, address or credential.
* **Isolation.** 4 new tables `prompter_payment_alert_*` (RLS on, no policy, all privileges revoked from public/anon/authenticated/service_role, `SELECT` to service_role only) and 6 `fn_*` functions (SECURITY DEFINER, `search_path = public, pg_temp`, service_role only). No PUBLOE / UMKMpro object, no `ALTER` of an existing table, no cron, no pg_net.
* **Visibility.** `/ops/payments` shows the sender heartbeat (not active / running / failing / not running), the "no active recipient" warning and the number of batches that gave up, so a silently dead scheduler is noticed by the operator. Every run writes ONE log line (`status=… processed=… sent=… failed=… last=CODE`, or the dry-run counts) — numbers and fixed words only, never a secret, an address, a tenant or a response body.

## Environment (Netlify only, never in git) — all unset today
| Variable | Meaning |
|---|---|
| `ALERT_EMAIL_ENABLED` | must be exactly `true`; anything else => the function does nothing and never touches the database |
| `ALERT_EMAIL_DRY_RUN` | **fail-safe default = dry run.** Only the exact string `false` sends. Unset, empty, `true`, `1`, `False`, a typo => read-only counts only, no claim, no e-mail |
| `RESEND_ALERT_API_KEY` | dedicated key, *sending access* only |
| `ALERT_EMAIL_FROM` | verified sender, planned `alerts@tanyopo.com` |
| `ALERT_EMAIL_LINK_BASE` | https base URL of the app for the link |
| `ALERT_EMAIL_DAILY_LIMIT` | optional 1..20 |
Re-uses the existing `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY`.

## Tests
* `supabase/tests/b4-2-notifications/run-local.sh` (CI job `billing-b42-sql`, PostgreSQL 17): privileges/RLS, derive, replay, reopen, ack-before-send, merge + CRITICAL order, frozen payload incl. sender / addresses / key (retry identical although env and operator e-mail changed), crash + lease retry (same key), STALE report, backoff, 409 never rotates the key, permanent failure, 6-attempt DEAD, 23 h stop, **8 consecutive 401s keep the batch alive and it is sent once fixed**, **dead batch re-queued at once / after 24 h as reminder / never when permanent / capped at 3 / not when acknowledged**, daily limit and CRITICAL reserve, **budget across midnight**, no recipient, recipient filtering, append-only audit, 12 parallel claims, 10 parallel crash-retries, 8 parallel completes, **40 parallel claims with a cap = exactly cap e-mails**, claim-vs-record race, outbox-locked-but-alarm-path-works, rollback and re-apply, B4.1 definitions identical, **B4.1's own suite still passes with B4.2 installed**, money tables identical.
* `tests/unit/netlify/notifier-core.test.ts`: disabled / misconfigured / dry run / happy path / every provider status / network + timeout / no secret in logs / limits.
* `tests/unit/lib/notification-static-guards.test.ts`: no secret or address in code, default off, self-contained bundle, additive migration, `.env.example` placeholders only.

## NOT VERIFIED (do not treat as PASS)
1. That Netlify actually runs the function every 5 minutes (needs a production deploy; scheduled functions run only on published deploys and cannot be invoked by URL; the minimum interval is not documented).
2. That `@netlify/plugin-nextjs` 5.x coexists with and bundles `netlify/functions/*.ts` with its relative import (CI/build log of a deploy preview is the first evidence; "Run now" works on previews).
3. Real delivery through Resend (no e-mail was sent anywhere), and that Resend's per-day quota resets on the UTC day. That Resend treats the (identical) frozen request as the same idempotent request.
4. Behaviour of the shared Resend quota (Free: 100/day) under signup load: notifications use at most 20/day, leaving 80 for Supabase Auth e-mails.

## Rollout (each step needs Founder approval; none was done)
1. Merge + deploy: the schedule registers but is a no-op while `ALERT_EMAIL_ENABLED` is not `true`.
2. Apply the migration in the Supabase SQL Editor (a production apply file is prepared separately). Verify with `fn_preview_payment_notifications()`.
3. Set `RESEND_ALERT_API_KEY`, `ALERT_EMAIL_FROM`, `ALERT_EMAIL_LINK_BASE`, `ALERT_EMAIL_ENABLED=true` in Netlify (leave `ALERT_EMAIL_DRY_RUN` unset or `true`); the log line `status=dry_run … pending=… recipients=…` proves the schedule runs.
4. Only then set `ALERT_EMAIL_DRY_RUN=false`; the first real e-mail is the Founder's own alert backlog (merged into one e-mail).

## Rollback
* Immediately: set `ALERT_EMAIL_ENABLED` to anything but `true` (no deploy needed).
* Schema: `supabase/rollback/20261101100000_prompter_b4_2_alert_notifications.down.sql` (refuses while notification rows exist — export them first; run it before the B4.1 rollback).
