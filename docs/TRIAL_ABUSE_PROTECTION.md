# Trial anti-abuse (repeat-signup protection)

Status: **implemented, OFF by default, migrations NOT applied to production.**

## What it protects against
A user creating many accounts (new email each time) to get repeated 14-day trials and fresh AI quotas.
It also lives alongside the P0 fixes (`prompter_ai_jobs`, `prompter_subscriptions`, `prompter_plan_entitlements`
lockdowns) which stop a *single* tenant from resetting its own quota/trial.

## What it deliberately is not
Not an identity system. IP and browser signals are weak and shared (CGNAT, offices, family phones). They only add
a small score and **can never cause a denial on their own**. Only a random first-party cookie reused by 2+ other
emails reaches DENY. Clearing cookies defeats it; that is accepted (see residual risks).

## Design
| Piece | Where |
|---|---|
| Mode switch `TRIAL_ABUSE_MODE` = `off` (default) / `shadow` / `enforce` | `lib/trial-abuse/config.ts` |
| HMAC pseudonyms, per-kind derived keys, email normalisation, coarse IP (/24, /48) | `lib/trial-abuse/pseudonym.ts` |
| Minimal signals (tz, lang, screen rounded, dpr, cores, OS family). No canvas/WebGL/audio | `lib/trial-abuse/signals.ts`, `features/auth/device-signals.tsx` |
| Gate + finalize, fail-closed in enforce, fail-open in shadow | `lib/trial-abuse/gate.ts`, `features/auth/actions.ts` |
| Ledger, atomic buckets, risk gate, hold, recovery, purge | `supabase/migrations/20261019110000_prompter_trial_abuse_protection.sql` |

Raw email/IP/fingerprint are **never** stored: the server sends 64-hex HMAC digests (secret never reaches the DB) and
CHECK constraints reject anything else. Retention: 90 days (`expires_at`), purged opportunistically by the gate
itself and by `fn_trial_abuse_purge` (no cron created).

### Decisions
- `ALLOW` score < 50. `REVIEW` 50–99. `DENY` >= 100 or rate limit exceeded.
- Score: same cookie with 1 other email +50, 2+ other emails +100; same device signals 1 other +20, 2+ +40;
  same /24 network 3+ +10, 8+ +20.
- Rate limits (persistent, atomic upsert; every attempt counts): IP 5/hour and 20/day, email 5/hour, cookie 6/day,
  device 10/day. Rate-limited attempts write no ledger row.
- `REVIEW`: signup proceeds but the tenant's client-created trial starts already expired (period end in the past), which the
  existing quota gate already treats as `TRIAL_EXPIRED`. No new subscription status, no change to `auth.users`/`tenants`.
- Shadow mode records and scores but never holds and never blocks.

### False-positive recovery
User message points to `tanyopofuturetechnology@gmail.com`. Operator (service_role) runs:
```sql
-- find the attempt: operator computes the email digest with the same secret (never paste the secret in SQL)
select public.fn_trial_release_hold('<attempt_id>', 'verified by support: shared family device');
```
It records who/why (`hold_released_reason`), and restores a normal 14-day trial from now if the held subscription row exists.

## Required before activation
Migrations (in order): `20261019100000`, `20261019100100`, `20261019100200` (PR #31 + P0-3), then `20261019110000`.
Secrets / config (no values here): `TRIAL_ABUSE_HMAC_SECRET` (base64, >= 32 random bytes, dedicated),
`TRIAL_ABUSE_KEY_VERSION`, `TRIAL_ABUSE_MODE`. `SUPABASE_SECRET_KEY` must already be set (admin client).

## Activation order (production, Founder-approved steps only)
1. Verified backup (`restore-test.sh` PASS) on the Founder's computer.
2. Apply the three P0 migrations, run read-only grant check; then apply `20261019110000`. Feature still OFF.
3. Create `TRIAL_ABUSE_HMAC_SECRET` in Netlify (Founder). Do not set the mode yet.
4. `TRIAL_ABUSE_MODE=shadow` → privacy notice switches on automatically. Observe REVIEW/DENY rates for a week; no user is blocked.
5. Review false positives; only then `TRIAL_ABUSE_MODE=enforce`.
6. Rollback at any step: set mode `off` (instant, no data touched); SQL rollbacks are in `supabase/rollback/`.

## Residual risks (known, not hidden)
- Signing up directly against Supabase Auth with the public key bypasses the app gate. Closing this needs a
  before-user-created Auth hook on the *shared* project (affects UMKMpro too) — requires separate Founder approval.
- Clearing cookies / new browser profile / different device defeats the cookie signal; mobile CGNAT limits the IP signal.
- Pseudonyms are still personal data; legal review of the notice is recommended before enabling.
- `ai_assistant_usage_log` and `fitur_ai_usage_log` (UMKMpro tables) also grant TRUNCATE to app roles; out of LINOE scope, not changed.
- `tenants` still grants DELETE/TRUNCATE to app roles (shared table; needs Founder decision).
