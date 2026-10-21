#!/usr/bin/env bash
# LOCAL-ONLY S1 (trial + AI quota) tests on a THROW-AWAY PostgreSQL with SYNTHETIC data. Never touches Supabase.
# Refuses non-local hosts and any credential env var. Optional integration needs other PRs' migration dirs:
#   PR48_DIR (guard: supabase/migrations 20261021120000/20261021120100), PR46_DIR (privilege hardening phase 1).
# REQUIRE_PG_MAJOR=17 (set in CI) refuses to run on any other PostgreSQL major.
set -uo pipefail
HOST="${PGHOST:-/tmp}"; PORT="${PGPORT:-5544}"; USER_="${PGUSER:-postgres}"
case "$HOST" in /*|localhost|127.0.0.1|::1) ;; *) echo "REFUSED: non-local PGHOST=$HOST" >&2; exit 2;; esac
for k in SUPABASE_SECRET_KEY SUPABASE_SERVICE_ROLE_KEY DATABASE_URL POSTGRES_URL TOKEN_ENCRYPTION_KEY; do
  if [ -n "${!k:-}" ]; then echo "REFUSED: $k is set" >&2; exit 2; fi
done
case "${PGDATABASE:-}" in *supabase*|*prod*) echo "REFUSED: PGDATABASE looks like a shared database" >&2; exit 2;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../../.." && pwd)"
M1=20261019100000_prompter_p0_ai_jobs_lockdown; M2=20261019100100_prompter_p0_subscription_trial_insert_guard; M3=20261019100200_prompter_p0_plan_entitlements_lockdown
G1=20261021120000_prompter_ai_jobs_quota_guard; G2=20261021120100_prompter_ai_jobs_delete_guard; M46=20261020190000_prompter_privilege_hardening_phase1
DOWN="$root/supabase/rollback/20261019100000_prompter_s1_trial_ai_quota.down.sql"
PS() { psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q "$@"; }
P() { PS -v ON_ERROR_STOP=1 "$@"; }
PA() { PS -At "$@"; }
W="$(mktemp -d)"; fail=0; pass() { echo "PASS: $*"; }; bad() { echo "FAIL: $*"; fail=1; }
SRV=$(PA -d postgres -c "show server_version_num")
if [ -n "${REQUIRE_PG_MAJOR:-}" ]; then
  [ $((SRV/10000)) = "$REQUIRE_PG_MAJOR" ] || { echo "REFUSED: server_version_num=$SRV is not PostgreSQL $REQUIRE_PG_MAJOR" >&2; exit 2; }
  echo "PostgreSQL major $REQUIRE_PG_MAJOR confirmed (server_version_num=$SRV)"
fi
mk() { P -d postgres -c "drop database if exists $1" -c "create database $1" >/dev/null; P -d "$1" -f "$here/support/prod_snapshot.sql" >/dev/null; }
s1() { for m in $M1 $M2 $M3; do P -d "$1" -f "$root/supabase/migrations/$m.sql" >/dev/null || return 1; done; }
g48() { P -d "$1" -f "$PR48_DIR/supabase/migrations/$G1.sql" >/dev/null && { [ "${2:-both}" = one ] || P -d "$1" -f "$PR48_DIR/supabase/migrations/$G2.sql" >/dev/null; }; }
rpcmd5() { PA -d "$1" -c "select md5(pg_get_functiondef('public.fn_create_ai_job_if_entitled(text,jsonb)'::regprocedure))"; }
suite() { # <db> <phase_after> <fc_expected> <rpc_md5_before> <label>
  if P -d "$1" -v phase_after="$2" -v fc_expected="$3" -v rpc_md5_before="$4" -f "$here/s1_trial_quota.sql" >"$W/o.txt" 2>&1; then
    pass "$5: $(grep -c ' PASS$\|^ *[A-Za-z0-9-].*| PASS' "$W/o.txt" | head -1) checks via s1_trial_quota.sql (summary: $(grep -E 'ALL PASS|FAILURES' "$W/o.txt" | tr -d ' ' | head -1))"
  else bad "$5"; grep -E "FAIL|ERROR" "$W/o.txt" | head -5; fi
}

# ---- 1) BEFORE: the holes exist on the reconstructed production state ----
mk s1_before; M0=$(rpcmd5 s1_before)
suite s1_before false false "$M0" "before (holes reproduced)"

# ---- 2) AFTER: S1 only; idempotent; fixes, legit paths, isolation ----
mk s1_after; s1 s1_after && s1 s1_after && pass "S1 migrations apply and re-apply cleanly (idempotent)" || bad "S1 migrations failed"
suite s1_after true false "$M0" "after S1"
[ "$(rpcmd5 s1_after)" = "$M0" ] && pass "S1 leaves fn_create_ai_job_if_entitled byte-identical (cannot overwrite the PR #48 guard)" || bad "S1 changed the RPC"

# ---- 3) concurrency (real parallel backends) ----
mk s1_conc; s1 s1_conc
if PGHOST="$HOST" PGPORT="$PORT" PGUSER="$USER_" bash "$here/concurrency.sh" s1_conc >"$W/conc.txt" 2>&1; then pass "$(grep 'concurrency:' "$W/conc.txt")"; else bad "concurrency"; cat "$W/conc.txt"; fi

# ---- 4) rollback is fail-closed ----
rbsql() { local out="$W/rb_$RANDOM.sql"; RB_IN="$DOWN" RB_OUT="$out" RB_REQ="$1" python3 -c "
import os
s=open(os.environ['RB_IN']).read(); r=os.environ['RB_REQ']
d=\"v_req text := 'REPLACE_WITH_REQUEST';\"
assert s.count(d)==1
if r!='-': s=s.replace(d,\"v_req text := '\"+r.replace(\"'\",\"''\")+\"';\")
open(os.environ['RB_OUT'],'w').write(s)"; echo "$out"; }
[ "$(grep -cE '^[[:space:]]*\\' "$DOWN")" = 0 ] && pass "rollback is plain SQL (no psql meta-command)" || bad "rollback has meta-commands"
mk s1_rb; s1 s1_rb
refused=0; total=0
for rq in "-" "" "prompter_ai_jobs:DELETE" "prompter_ai_jobs:INSERT" "prompter_ai_jobs:TRUNCATE" "prompter_ai_jobs:UPDATE" "prompter_ai_jobs:UPDATE(created_at)" "prompter_ai_jobs:UPDATE(tenant_id)" \
          "prompter_ai_jobs:UPDATE(job_type)" "prompter_ai_jobs:UPDATE(estimated_cost),prompter_ai_jobs:DELETE" "prompter_subscriptions:DELETE" "prompter_subscriptions:TRUNCATE" "prompter_subscriptions:INSERT" \
          "prompter_plan_entitlements:TRUNCATE" "prompter_plan_entitlements:UPDATE" "drop trigger trg_prompter_subscriptions_enforce_trial_insert" "anon:SELECT" "prompter_ai_jobs:UPDATE(estimated_cost)'; drop table public.prompter_ai_jobs; --"; do
  total=$((total+1)); o=$(PS -d s1_rb -v ON_ERROR_STOP=1 -f "$(rbsql "$rq")" 2>&1) && rc=0 || rc=1
  if [ "$rc" = 1 ] && echo "$o" | grep -q "refused"; then refused=$((refused+1)); else echo "   NOT REFUSED: '$rq' rc=$rc"; fi
done
[ "$refused" = "$total" ] && pass "rollback refuses $total forbidden/ambiguous requests (DELETE/INSERT/TRUNCATE, created_at/tenant_id/job_type, subscriptions, entitlements, trigger drop, anon, injection)" || bad "only $refused/$total refused"
P -d s1_rb -c "select to_regclass('public.prompter_ai_jobs') is not null" >/dev/null
suite s1_rb true false "$M0" "after refused rollbacks (nothing re-opened)"
mk s1_rb2; s1 s1_rb2
if P -d s1_rb2 -f "$(rbsql 'prompter_ai_jobs:UPDATE(estimated_cost)')" >"$W/rbok.txt" 2>&1; then pass "the single allowed rollback request applies"; else bad "allowed rollback failed"; cat "$W/rbok.txt"; fi
[ "$(PA -d s1_rb2 -c "select has_column_privilege('authenticated','public.prompter_ai_jobs','estimated_cost','UPDATE')")" = t ] && pass "…and grants exactly UPDATE(estimated_cost) to authenticated" || bad "estimated_cost not granted"
suite s1_rb2 true false "$M0" "after the allowed rollback (every quota/trial attack still blocked)"
bc=$(PA -d s1_rb2 -c "select count(*) from (select has_table_privilege(r,'public.'||t,p) g from (values ('anon'),('authenticated')) a(r), (values ('prompter_ai_jobs'),('prompter_subscriptions'),('prompter_plan_entitlements')) b(t), (values ('DELETE'),('TRUNCATE'),('INSERT')) c(p) where not (r='authenticated' and t='prompter_subscriptions' and p='INSERT')) x where g")
[ "$bc" = 0 ] && pass "after the allowed rollback no DELETE/TRUNCATE/INSERT exists for anon/authenticated (except the app's own trial INSERT)" || bad "$bc dangerous cells after rollback"
# negative control: the OLD #31 mass-restore rollback must be detected as re-opening the holes
if git -C "$root" cat-file -e "refs/tmp/pr31:supabase/rollback/20261019100000_prompter_p0_ai_jobs_lockdown.down.sql" 2>/dev/null; then
  mk s1_leg; s1 s1_leg; git -C "$root" show "refs/tmp/pr31:supabase/rollback/20261019100000_prompter_p0_ai_jobs_lockdown.down.sql" > "$W/legacy.sql"; P -d s1_leg -f "$W/legacy.sql" >/dev/null
  lg=$(PA -d s1_leg -c "select has_table_privilege('authenticated','public.prompter_ai_jobs','DELETE') and has_table_privilege('anon','public.prompter_ai_jobs','TRUNCATE')")
  [ "$lg" = t ] && pass "negative control: the legacy #31 ai_jobs rollback re-opens DELETE + anon TRUNCATE (the detector catches it)" || bad "legacy control did not reproduce"
else echo "SKIP: legacy rollback negative control (refs/tmp/pr31 not available)"; fi

# ---- 5) integration with PR #48 (both orders) and PR #46 ----
if [ -n "${PR48_DIR:-}" ] && [ -f "$PR48_DIR/supabase/migrations/$G1.sql" ]; then
  mk s1_48; s1 s1_48 && g48 s1_48 && pass "S1 then #48 (part 1 + part 2): part 2's prerequisite check passes after S1" || bad "S1 then #48 failed"
  P -d s1_48 -f "$here/integration.sql" >"$W/int.txt" 2>&1 && pass "S1+#48 integration ($(grep -c PASS "$W/int.txt") checks)" || { bad "S1+#48 integration"; grep -E "FAIL|ERROR" "$W/int.txt" | head; }
  mk s1_48b; s1 s1_48b && g48 s1_48b && suite s1_48b true true "$M0" "S1+#48 full suite (incl. fail-closed empty entitlements)"
  mk s1_48c; s1 s1_48c; PGHOST="$HOST" PGPORT="$PORT" PGUSER="$USER_" bash "$here/concurrency.sh" s1_48c >/dev/null 2>&1 || true
  mk s1_48d; s1 s1_48d && g48 s1_48d && { PGHOST="$HOST" PGPORT="$PORT" PGUSER="$USER_" bash "$here/concurrency.sh" s1_48d >"$W/c2.txt" 2>&1 && pass "S1+#48 concurrency: $(grep 'concurrency:' "$W/c2.txt")" || { bad "S1+#48 concurrency"; cat "$W/c2.txt"; }; }
  # reverse order: #48 part 1 first, S1 afterwards must NOT remove the guard (S1 never redefines the RPC)
  mk s1_rev; g48 s1_rev one && s1 s1_rev && g48 s1_rev one >/dev/null 2>&1
  P -d s1_rev -c "do \$\$ begin if position('ROLE_NOT_ALLOWED' in pg_get_functiondef('public.fn_create_ai_job_if_entitled(text,jsonb)'::regprocedure))=0 then raise exception 'guard lost'; end if; end \$\$" >/dev/null 2>&1 \
    && pass "reverse order (#48 part 1, then S1): the role guard is still in the RPC (no overwrite)" || bad "reverse order lost the #48 guard"
  P -d s1_rev -f "$PR48_DIR/supabase/migrations/$G2.sql" >/dev/null 2>&1 && pass "reverse order: #48 part 2 applies once S1 is in" || bad "#48 part 2 refused after S1"
  # #48 without S1: part 2 must refuse (documents the dependency)
  mk s1_no; g48 s1_no one; if P -d s1_no -f "$PR48_DIR/supabase/migrations/$G2.sql" >/dev/null 2>&1; then bad "#48 part 2 applied without S1"; else pass "#48 part 2 refuses without S1 (dependency enforced)"; fi
else echo "SKIP: PR #48 integration (PR48_DIR not set)"; fi
if [ -n "${PR46_DIR:-}" ] && [ -f "$PR46_DIR/supabase/migrations/$M46.sql" ]; then
  mk s1_46; s1 s1_46 && P -d s1_46 -f "$PR46_DIR/supabase/migrations/$M46.sql" >"$W/p46.txt" 2>&1 && pass "S1 then #46 phase 1 applies (its fail-closed post-check accepts S1's grants)" || { bad "S1 then #46"; tail -3 "$W/p46.txt"; }
  suite s1_46 true false "$M0" "S1+#46 (quota/trial behaviour unchanged by privilege hardening)"
  mk s1_46r; P -d s1_46r -f "$PR46_DIR/supabase/migrations/$M46.sql" >/dev/null 2>&1; s1 s1_46r && pass "#46 first, then S1 applies" || bad "#46 then S1"
  suite s1_46r true false "$M0" "#46 then S1"
else echo "SKIP: PR #46 integration (PR46_DIR not set)"; fi

[ -n "${KEEP_W:-}" ] && echo "kept: $W" || rm -rf "$W"
[ "$fail" = 0 ] && echo "ALL S1 LOCAL TESTS PASSED (synthetic PostgreSQL only; says nothing about production by itself)" || { echo "SOME TESTS FAILED"; exit 1; }
