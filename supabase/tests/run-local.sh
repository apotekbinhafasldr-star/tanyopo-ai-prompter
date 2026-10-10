#!/usr/bin/env bash
# LOCAL-ONLY: runs the P0 trial-security SQL regression test against a
# THROWAWAY local PostgreSQL (never Supabase). Usage:
#   PGHOST=<socket dir or host> PGPORT=<port> PGUSER=postgres supabase/tests/run-local.sh before|after|rollback
# before   : snapshot of production state -> proves the vulnerabilities exist
# after    : snapshot + both migrations   -> proves the fixes and non-regression
# rollback : snapshot + migrations + rollback scripts -> proves the pre-migration state returns
set -euo pipefail
phase="${1:?before|after|rollback}"
here="$(cd "$(dirname "$0")" && pwd)"
root="$here/../.."
db="p0_${phase}_$$"
createdb "$db"
trap 'dropdb --if-exists "$db"' EXIT
q() { psql -v ON_ERROR_STOP=1 -X -q -d "$db" "$@"; }
q -f "$here/support/prod_snapshot.sql"
if [ "$phase" != "before" ]; then
  q -f "$root/supabase/migrations/20261010110000_prompter_p0_ai_jobs_lockdown.sql"
  q -f "$root/supabase/migrations/20261010110100_prompter_p0_subscription_trial_insert_guard.sql"
fi
if [ "$phase" = "rollback" ]; then
  q -f "$root/supabase/rollback/20261010110100_prompter_p0_subscription_trial_insert_guard.down.sql"
  q -f "$root/supabase/rollback/20261010110000_prompter_p0_ai_jobs_lockdown.down.sql"
  # after rollback the vulnerable "before" behaviour must be back
  phase=before
fi
if [ "$phase" = "after" ]; then af=true; else af=false; fi
q -v phase="$phase" -v phase_after="$af" -f "$here/p0_trial_security.sql"
