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

## Closing the direct-signup bypass (trial claim)
Anyone with the public Supabase key can sign up straight against Supabase Auth and skip `registerAction`.
We do not touch Auth (shared with PUBLOE/Apotek/UMKMpro; no Auth Hook, no Auth config change). The LINOE trial is
a row in LINOE-owned `prompter_subscriptions`, so the trial itself is gated:
- `TRIAL_ABUSE_MODE=enforce`: `getOrCreateSubscription` calls `claimTrial` -> `fn_trial_claim` (service_role only). It runs
  the same gate (own `claim_*` rate buckets), then creates the subscription itself: 14-day trial on ALLOW, already-expired
  (held) on REVIEW/DENY, fully idempotent and serialised per tenant. Identity comes from the verified session, never from arguments.
- DB switch `prompter_trial_config.claim_required` (default false, flipped with `fn_trial_set_claim_required(true)`):
  while on, any CLIENT insert into `prompter_subscriptions` yields an expired placeholder, so a direct signup cannot
  self-start a trial. The claim upgrades such a placeholder after the gate. Turning it off restores the old behaviour instantly.
- Effect on other products: none. Nothing runs at signup/login in Auth; it only runs when a user opens LINOE without a subscription.
- Order matters: deploy code with mode=enforce FIRST, flip `claim_required` SECOND (flipping first would hand legacy code
  expired placeholders; claim recovers them, but users would see a held trial until their next page load).

## Shared-table hardening (separate migration, needs Founder approval to apply)
`20261019120000` only REVOKEs TRUNCATE/DELETE/INSERT (and anon UPDATE) on `tenants` and all writes on
`ai_assistant_usage_log` / `fitur_ai_usage_log`. Production catalog shows RLS already rejects those writes for app roles
(no INSERT/DELETE policy; logs have no write policy), writers are SECURITY DEFINER/service_role, so no working path is removed.
Reachability note: PostgREST has no TRUNCATE verb, so TRUNCATE on these tables is defence in depth, not a demonstrated
remote exploit through the public API. (This also applies to `prompter_plan_entitlements`, P0-3.)

## Required before activation
Migrations (in order): `20261019100000`, `20261019100100`, `20261019100200` (PR #31 + P0-3), `20261019110000`
(anti-abuse + claim), and `20261019120000` (shared-table hardening, separate approval).
Secrets / config (no values here): `TRIAL_ABUSE_HMAC_SECRET` (base64, >= 32 random bytes, dedicated),
`TRIAL_ABUSE_KEY_VERSION`, `TRIAL_ABUSE_MODE`. `SUPABASE_SECRET_KEY` must already be set (admin client).

## Activation order (production, Founder-approved steps only)
1. Verified backup (`restore-test.sh` PASS) on the Founder's computer.
2. Apply the three P0 migrations, run read-only grant check; then apply `20261019110000`. Feature still OFF.
3. Create `TRIAL_ABUSE_HMAC_SECRET` in Netlify (Founder). Do not set the mode yet.
4. `TRIAL_ABUSE_MODE=shadow` → privacy notice switches on automatically. Observe REVIEW/DENY rates for a week; no user is blocked.
5. Review false positives; only then `TRIAL_ABUSE_MODE=enforce` (deploy), verify a test signup + claim.
6. Then `select fn_trial_set_claim_required(true)` (service_role) to close the direct-signup bypass.
7. Rollback at any step: `fn_trial_set_claim_required(false)`, then mode `off` (instant, no data touched); SQL rollbacks are in `supabase/rollback/`.

## Residual risks (known, not hidden)
- Direct Supabase-Auth signup still creates an auth user + tenant (shared trigger) and cannot be prevented without an
  Auth hook; it no longer yields a LINOE trial once `claim_required` is on (see above). Remaining abuse: email-confirmation
  mailbox farming still costs the attacker one mailbox per attempt and is rate-limited per IP/cookie at claim time.
- Clearing cookies / new browser profile / different device defeats the cookie signal; mobile CGNAT limits the IP signal.
- Pseudonyms are still personal data; legal review of the notice is recommended before enabling.
- Claim-time signals are weaker than signup-time: no browser signals, and the device cookie may be absent if the user confirms
  email on another device. The signup gate (when used) and email/IP pseudonyms still apply.
