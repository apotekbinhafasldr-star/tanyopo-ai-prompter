#!/usr/bin/env bash
# LOCAL-ONLY tests for the AI Jobs quota guard on a THROW-AWAY PostgreSQL with SYNTHETIC data.
# Refuses non-local hosts and any credential env var. Never touches Supabase / production.
# Variants: main | pr31 | all (#31+#44+#45+#46); plus an apply-order hazard test (guard applied BEFORE #31).
# Integration variants need PR dirs: PR31_DIR PR44_DIR PR45_DIR PR46_DIR (each = dir containing supabase/migrations).
set -uo pipefail
HOST="${PGHOST:-/tmp}"; PORT="${PGPORT:-5544}"; USER_="${PGUSER:-postgres}"
case "$HOST" in /*|localhost|127.0.0.1) ;; *) echo "REFUSED: non-local PGHOST=$HOST" >&2; exit 2;; esac
for k in SUPABASE_SECRET_KEY SUPABASE_SERVICE_ROLE_KEY DATABASE_URL POSTGRES_URL; do
  if [ -n "${!k:-}" ]; then echo "REFUSED: $k is set" >&2; exit 2; fi
done
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../../.." && pwd)"
G1=20261021120000_prompter_ai_jobs_quota_guard; G2=20261021120100_prompter_ai_jobs_delete_guard
P() { psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -v ON_ERROR_STOP=1 "$@"; }
PL() { psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q "$@"; }
PA() { psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -At "$@"; }
fail=0; pass() { echo "PASS: $*"; }; bad() { echo "FAIL: $*"; fail=1; }
L31="20261019100000_prompter_p0_ai_jobs_lockdown 20261019100100_prompter_p0_subscription_trial_insert_guard 20261019100200_prompter_p0_plan_entitlements_lockdown 20261019110000_prompter_trial_abuse_protection 20261019120000_prompter_shared_tables_truncate_delete_hardening"
# S1_ONLY3=1: PR31_DIR holds PR #53 (exactly the three S1 migrations; the trial-abuse / shared-tables files do not exist there).
if [ -n "${S1_ONLY3:-}" ]; then L31="20261019100000_prompter_p0_ai_jobs_lockdown 20261019100100_prompter_p0_subscription_trial_insert_guard 20261019100200_prompter_p0_plan_entitlements_lockdown"; fi
M44=20261020160000_prompter_billing_financial_safety; M45=20261020180000_prompter_billing_security_hardening_p0
M46=20261020190000_prompter_privilege_hardening_phase1

P -d postgres -c "drop database if exists ajg_tpl" -c "create database ajg_tpl" >/dev/null
P -d ajg_tpl -f "$here/support/base.sql" >/dev/null
for f in "$root"/supabase/migrations/2026*.sql; do
  case "$(basename "$f")" in $G1.sql|$G2.sql) continue;; esac
  PL -d ajg_tpl -f "$f" >/dev/null 2>&1 || true
done
mk() { P -d postgres -c "drop database if exists $1" -c "create database $1 template ajg_tpl" >/dev/null; }
ap() { P -d "$1" -f "$2" >/dev/null; }
apm() { ap "$1" "$2/supabase/migrations/$3.sql"; }
g1() { ap "$1" "$root/supabase/migrations/$G1.sql"; }
g2() { ap "$1" "$root/supabase/migrations/$G2.sql"; }
prep() { # <db> <variant>: everything except fixtures
  local db="$1"
  case "$2" in
    main) g1 "$db" ;;
    pr31) for m in $L31; do apm "$db" "$PR31_DIR" "$m"; done; g1 "$db"; g2 "$db" ;;
    pr31_rev) g1 "$db"; for m in $L31; do apm "$db" "$PR31_DIR" "$m"; done; g2 "$db" ;;
    all) for m in $L31; do apm "$db" "$PR31_DIR" "$m"; done; apm "$db" "$PR44_DIR" "$M44"; apm "$db" "$PR45_DIR" "$M45"
         apm "$db" "$PR46_DIR" "$M46"; g1 "$db"; g2 "$db" ;;
  esac
}
need() { for v in "$@"; do [ -n "${!v:-}" ] && [ -d "${!v}/supabase/migrations" ] || return 1; done; }

# Does the S1 source (PR #31 or PR #53) redefine the quota RPC? #31's S1 files do (older body => apply-order hazard);
# #53's do not (REVOKE/trigger only). The order-hazard and rollback assertions below depend on this, and are
# STRICTER, not weaker, in the no-redefine case (the guard must survive S1 in either order).
s1_redef=0
if need PR31_DIR; then
  for m in $L31; do
    grep -qiE 'create or replace function[[:space:]]+public\.fn_create_ai_job_if_entitled' "$PR31_DIR/supabase/migrations/$m.sql" && s1_redef=1
  done
  echo "S1 source redefines fn_create_ai_job_if_entitled: $s1_redef"
fi

variants="main"
need PR31_DIR && variants="$variants pr31" || echo "SKIP pr31: PR31_DIR not set"
need PR31_DIR PR44_DIR PR45_DIR PR46_DIR && variants="$variants all" || echo "SKIP all: PR31_DIR/PR44_DIR/PR45_DIR/PR46_DIR not all set"

for v in $variants; do
  echo "== variant $v"
  db="ajg_$v"; mk "$db"; prep "$db" "$v"; P -d "$db" -f "$here/support/fixtures.sql" >/dev/null
  out="$(PL -d "$db" -v variant="$v" -f "$here/tests.sql" 2>&1 | grep '^RESULT')"
  echo "$out" | sed 's/^RESULT //'
  n=$(echo "$out" | grep -c ' PASS '); f=$(echo "$out" | grep -c ' FAIL ')
  [ "$f" = 0 ] && [ "$n" -gt 0 ] && pass "$v: $n assertions" || bad "$v: $f failed / $n passed"

  # ---- parallel: 60 owner calls + 20 member calls against a fresh trial tenant (allowance 30) ----
  pdb="ajg_par_$v"; mk "$pdb"; prep "$pdb" "$v"; P -d "$pdb" -f "$here/support/fixtures.sql" >/dev/null
  P -d "$pdb" -c "insert into auth.users(id,email) values ('c2000000-0000-4000-8000-0000000000c2','member-c@example.invalid'); insert into user_profiles(id,tenant_id,nama,role) values ('c2000000-0000-4000-8000-0000000000c2','c0000000-0000-4000-8000-00000000000c','Member C','member')" >/dev/null
  export HOST PORT USER_ pdb
  { for i in $(seq 60); do echo c1000000-0000-4000-8000-0000000000c1; done; for i in $(seq 20); do echo c2000000-0000-4000-8000-0000000000c2; done; } \
    | xargs -P 20 -I{} "$here/par-call.sh" {} > "$here/.par.$v" 2>/dev/null
  t=$(grep -c '^true$' "$here/.par.$v"); rows=$(PA -d "$pdb" -c "select count(*) from prompter_ai_jobs where tenant_id='c0000000-0000-4000-8000-00000000000c'")
  rm -f "$here/.par.$v"
  [ "$t" = 30 ] && [ "$rows" = 30 ] && pass "$v: 80 parallel calls (60 owner + 20 member) -> exactly 30 allowed, 30 rows" || bad "$v: parallel allowed=$t rows=$rows (want 30/30)"
done

# ---- part 2 refuses to apply while authenticated still has DELETE (prerequisite fail-closed) ----
mk ajg_pre; g1 ajg_pre; P -d ajg_pre -f "$here/support/fixtures.sql" >/dev/null
o="$(PL -d ajg_pre -v ON_ERROR_STOP=1 -f "$root/supabase/migrations/$G2.sql" 2>&1 || true)"
if echo "$o" | grep -q "prerequisite missing: apply PR #31"; then pass "part 2 refuses without PR #31 (fail-closed prerequisite)"; else bad "part 2 applied without PR #31"; fi

# ---- apply-order hazard: guard applied BEFORE #31 is overwritten by #31's older RPC body -> part 2 must refuse ----
if need PR31_DIR; then
  mk ajg_rev; g1 ajg_rev; for m in $L31; do apm ajg_rev "$PR31_DIR" "$m"; done; P -d ajg_rev -f "$here/support/fixtures.sql" >/dev/null
  r1=$(PA -d ajg_rev -c "select position('ROLE_NOT_ALLOWED' in pg_get_functiondef('public.fn_create_ai_job_if_entitled(text,jsonb)'::regprocedure))")
  o="$(PL -d ajg_rev -v ON_ERROR_STOP=1 -f "$root/supabase/migrations/$G2.sql" 2>&1 || true)"
  if [ "$s1_redef" = 1 ]; then
    if [ "$r1" = 0 ] && echo "$o" | grep -q "part 1 (quota guard) is not live"; then pass "wrong order (guard, then #31) is DETECTED: guard overwritten, part 2 refuses"; else bad "order hazard not detected (r1=$r1)"; fi
    g1 ajg_rev; g2 ajg_rev && pass "re-applying part 1 repairs the order hazard; part 2 then applies" || bad "repair failed"
  else
    # S1 = PR #53: its migrations never redefine the RPC, so applying them AFTER the guard must leave the guard intact
    # (no hazard), compared byte-for-byte with the function as it was right after part 1.
    fb=$(PA -d ajg_rev -c "select md5(pg_get_functiondef('public.fn_create_ai_job_if_entitled(text,jsonb)'::regprocedure))")
    mk ajg_rev2; g1 ajg_rev2; fa=$(PA -d ajg_rev2 -c "select md5(pg_get_functiondef('public.fn_create_ai_job_if_entitled(text,jsonb)'::regprocedure))")
    if [ "$r1" -gt 0 ] && [ "$fb" = "$fa" ] && ! echo "$o" | grep -q "prerequisite missing"; then pass "wrong order (guard, then #53 S1) is HARMLESS: S1 leaves the guarded RPC byte-identical and part 2 applies"; else bad "S1 (#53) altered/removed the guard (r1=$r1 same_fn=$([ "$fb" = "$fa" ] && echo y || echo n))"; fi
  fi
fi

# ---- idempotency, rollback, re-apply, no privilege change (use the last integration variant available) ----
INCLUDE_FN=true; rv=main; need PR31_DIR && rv=pr31; need PR31_DIR PR44_DIR PR45_DIR PR46_DIR && rv=all
echo "== idempotent / rollback / reapply on variant $rv"
[ "$rv" = main ] && INCLUDE_FN=false   # on main the rollback intentionally keeps #31's fail-closed block (see rollback header)
# Same when S1 is #53: it never redefines the RPC, so the pre-state function is the older B10 body and the rollback
# intentionally lands on the stricter fail-closed body (never removes a security fix). Triggers, ACLs and the whole
# privilege matrix are still compared exactly, and the final check below still pins ENTITLEMENT_NOT_CONFIGURED present
# and ROLE_NOT_ALLOWED absent after rollback.
[ "$rv" != main ] && [ "$s1_redef" = 0 ] && INCLUDE_FN=false
sigq="select md5(string_agg(x, '|' order by x)) from (
  select 'f:'||md5(pg_get_functiondef(p.oid)) x from pg_proc p where p.proname='fn_create_ai_job_if_entitled' and p.pronamespace='public'::regnamespace and $INCLUDE_FN
  union all select 't:'||tgname from pg_trigger where tgrelid='public.prompter_ai_jobs'::regclass and not tgisinternal
  union all select 'g:'||tbl||role||priv||granted::text from t_matrix()
  union all select 'a:'||aclexplode.privilege_type||aclexplode.grantee::text||aclexplode.is_grantable::text from pg_class c, aclexplode(c.relacl) where c.oid='public.prompter_ai_jobs'::regclass
  union all select 'x:'||p.proname||has_function_privilege('anon',p.oid,'execute')::text||has_function_privilege('authenticated',p.oid,'execute')::text from pg_proc p where p.proname='fn_create_ai_job_if_entitled'
) s"
mk ajg_rb
case "$rv" in
  main) : ;;
  pr31) for m in $L31; do apm ajg_rb "$PR31_DIR" "$m"; done ;;
  all) for m in $L31; do apm ajg_rb "$PR31_DIR" "$m"; done; apm ajg_rb "$PR44_DIR" "$M44"; apm ajg_rb "$PR45_DIR" "$M45"; apm ajg_rb "$PR46_DIR" "$M46" ;;
esac
P -d ajg_rb -f "$here/support/fixtures.sql" >/dev/null
pre=$(PA -d ajg_rb -c "$sigq")
g1 ajg_rb; [ "$rv" != main ] && g2 ajg_rb
post=$(PA -d ajg_rb -c "$sigq")
g1 ajg_rb; [ "$rv" != main ] && g2 ajg_rb; g1 ajg_rb
again=$(PA -d ajg_rb -c "$sigq")
[ "$post" = "$again" ] && pass "migrations are idempotent (apply x2 -> identical function/trigger/ACL signature)" || bad "not idempotent"
[ "$pre" != "$post" ] && pass "migrations change the function/trigger set (sanity)" || bad "migration had no effect"
[ "$rv" != main ] && P -d ajg_rb -f "$root/supabase/rollback/$G2.down.sql"
P -d ajg_rb -f "$root/supabase/rollback/$G1.down.sql"
rolled=$(PA -d ajg_rb -c "$sigq")
[ "$rolled" = "$pre" ] && pass "rollback restores the exact pre-migration function, triggers and ACL/privilege matrix (no privilege re-opened)" || bad "rollback state differs from pre-migration state"
P -d ajg_rb -f "$root/supabase/rollback/$G2.down.sql" 2>/dev/null; P -d ajg_rb -f "$root/supabase/rollback/$G1.down.sql"   # rollback twice is harmless
[ "$(PA -d ajg_rb -c "$sigq")" = "$pre" ] && pass "rollback is itself idempotent" || bad "second rollback changed state"
g1 ajg_rb; [ "$rv" != main ] && g2 ajg_rb
[ "$(PA -d ajg_rb -c "$sigq")" = "$post" ] && pass "re-apply after rollback == first apply" || bad "re-apply differs"
# after rollback: no guard left, but the fail-closed entitlement block (a security fix) is still there
P -d ajg_rb -f "$root/supabase/rollback/$G1.down.sql" >/dev/null 2>&1
fnd=$(PA -d ajg_rb -c "select pg_get_functiondef('public.fn_create_ai_job_if_entitled(text,jsonb)'::regprocedure)")
if echo "$fnd" | grep -q ENTITLEMENT_NOT_CONFIGURED && ! echo "$fnd" | grep -q ROLE_NOT_ALLOWED; then pass "rolled-back RPC keeps the fail-closed entitlement block and has no guard"; else bad "rolled-back RPC wrong"; fi

[ "$fail" = 0 ] && echo "ALL PASSED" || { echo "SOME FAILED"; exit 1; }
