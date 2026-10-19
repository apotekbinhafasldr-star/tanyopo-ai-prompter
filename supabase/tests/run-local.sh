#!/usr/bin/env bash
# LOCAL-ONLY: runs the P0 trial-security SQL regression test against a
# THROWAWAY local PostgreSQL (never Supabase). Usage:
#   PGHOST=<socket dir or host> PGPORT=<port> PGUSER=postgres supabase/tests/run-local.sh before|after|rollback
# before   : snapshot of production state -> proves the vulnerabilities exist
# after    : snapshot + both migrations   -> proves the fixes and non-regression
# rollback : snapshot + migrations + rollback scripts -> proves the pre-migration state returns
set -euo pipefail
# Isolation guard: this script CREATES roles and databases, so it may only ever talk to a
# throw-away PostgreSQL on this machine (unix socket, localhost or 127.0.0.1) and never when a
# Supabase/production credential is present in the environment.
host="${PGHOST:-}"
case "$host" in
  ""|/*|localhost|127.0.0.1|::1) ;;
  *) echo "refusing: PGHOST='$host' is not a local throw-away server" >&2; exit 2 ;;
esac
for k in SUPABASE_SECRET_KEY SUPABASE_SERVICE_ROLE_KEY DATABASE_URL POSTGRES_URL TOKEN_ENCRYPTION_KEY; do
  if [ -n "${!k:-}" ]; then echo "refusing: $k is set (no production credential may be present)" >&2; exit 2; fi
done
case "${PGDATABASE:-}" in *supabase*|*prod*) echo "refusing: PGDATABASE looks like a shared database" >&2; exit 2 ;; esac
phase="${1:?before|after|rollback|abuse|abuse-rollback|shared-before|shared-after|shared-rollback}"
here="$(cd "$(dirname "$0")" && pwd)"
root="$here/../.."
db="p0_${phase//-/_}_$$"
createdb "$db"
trap 'dropdb --if-exists "$db"' EXIT
q() { psql -v ON_ERROR_STOP=1 -X -q -d "$db" "$@"; }
q -f "$here/support/prod_snapshot.sql"
if [ "${phase#shared-}" != "$phase" ]; then
  mode="${phase#shared-}"
  if [ "$mode" != "before" ]; then
    for m in 20261019100000_prompter_p0_ai_jobs_lockdown 20261019100100_prompter_p0_subscription_trial_insert_guard \
             20261019100200_prompter_p0_plan_entitlements_lockdown 20261019120000_prompter_shared_tables_truncate_delete_hardening; do
      q -f "$root/supabase/migrations/$m.sql"
    done
    q -f "$root/supabase/migrations/20261019120000_prompter_shared_tables_truncate_delete_hardening.sql"   # idempotent re-run
  fi
  if [ "$mode" = "rollback" ]; then
    q -f "$root/supabase/rollback/20261019120000_prompter_shared_tables_truncate_delete_hardening.down.sql"
    mode=before
  fi
  if [ "$mode" = "after" ]; then af=true; else af=false; fi
  q -v phase_after="$af" -f "$here/shared_tables_hardening.sql"
  exit 0
fi
if [ "$phase" = "abuse" ] || [ "$phase" = "abuse-rollback" ]; then
  for m in 20261019100000_prompter_p0_ai_jobs_lockdown 20261019100100_prompter_p0_subscription_trial_insert_guard \
           20261019100200_prompter_p0_plan_entitlements_lockdown 20261019110000_prompter_trial_abuse_protection; do
    q -f "$root/supabase/migrations/$m.sql"
  done
  q -f "$root/supabase/migrations/20261019110000_prompter_trial_abuse_protection.sql"   # idempotent re-run
  if [ "$phase" = "abuse" ]; then
    q -f "$here/trial_abuse.sql"
    bash "$here/trial_abuse_concurrency.sh" "$db"
  else
    q -f "$here/trial_abuse_rollback.sql"
  fi
  exit 0
fi
if [ "$phase" != "before" ]; then
  q -f "$root/supabase/migrations/20261019100000_prompter_p0_ai_jobs_lockdown.sql"
  q -f "$root/supabase/migrations/20261019100100_prompter_p0_subscription_trial_insert_guard.sql"
  q -f "$root/supabase/migrations/20261019100200_prompter_p0_plan_entitlements_lockdown.sql"
fi
if [ "$phase" != "before" ]; then
  # migrations must be idempotent: a second run changes nothing and raises nothing
  q -f "$root/supabase/migrations/20261019100000_prompter_p0_ai_jobs_lockdown.sql"
  q -f "$root/supabase/migrations/20261019100100_prompter_p0_subscription_trial_insert_guard.sql"
  q -f "$root/supabase/migrations/20261019100200_prompter_p0_plan_entitlements_lockdown.sql"
fi
if [ "$phase" = "rollback" ]; then
  q -f "$root/supabase/rollback/20261019100200_prompter_p0_plan_entitlements_lockdown.down.sql"
  q -f "$root/supabase/rollback/20261019100100_prompter_p0_subscription_trial_insert_guard.down.sql"
  q -f "$root/supabase/rollback/20261019100000_prompter_p0_ai_jobs_lockdown.down.sql"
  # after rollback the vulnerable "before" behaviour must be back
  phase=before
fi
if [ "$phase" = "after" ]; then af=true; else af=false; fi
q -v phase="$phase" -v phase_after="$af" -f "$here/p0_trial_security.sql"
