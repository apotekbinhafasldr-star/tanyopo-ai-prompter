#!/usr/bin/env bash
# LOCAL-ONLY tests for the AI Jobs quota guard on a THROW-AWAY PostgreSQL with SYNTHETIC data.
# Refuses non-local hosts and any credential env var. Never touches Supabase / production.
# Variants (rebased on main@f740e47, where the S1 migrations 20261019100000/100/200 are ALREADY part of supabase/migrations):
#   s1      = production shape: every main migration incl. S1 (+ B1/B2/plan-tampering/P0-2), then guard part 1 + part 2
#   pre_s1  = S1 migrations left out (production BEFORE S1): guard part 1 only; part 2 must refuse
#   repo_order = the guard applied at its own file position (20261021...) inside the full chain, i.e. BEFORE the later
#             migrations (20261027...-20261103...): proves no later migration overwrites or removes the guard
# No other PR checkout is needed any more (#31/#44/#45/#46 were superseded; S1 is in the tree).
set -uo pipefail
HOST="${PGHOST:-/tmp}"; PORT="${PGPORT:-5544}"; USER_="${PGUSER:-postgres}"
case "$HOST" in /*|localhost|127.0.0.1) ;; *) echo "REFUSED: non-local PGHOST=$HOST" >&2; exit 2;; esac
for k in SUPABASE_SECRET_KEY SUPABASE_SERVICE_ROLE_KEY DATABASE_URL POSTGRES_URL; do
  if [ -n "${!k:-}" ]; then echo "REFUSED: $k is set" >&2; exit 2; fi
done
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../../.." && pwd)"
G1=20261021120000_prompter_ai_jobs_quota_guard; G2=20261021120100_prompter_ai_jobs_delete_guard
S1FILES="20261019100000_prompter_p0_ai_jobs_lockdown 20261019100100_prompter_p0_subscription_trial_insert_guard 20261019100200_prompter_p0_plan_entitlements_lockdown"
P() { psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -v ON_ERROR_STOP=1 "$@"; }
PL() { psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q "$@"; }
PA() { psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -At "$@"; }
fail=0; pass() { echo "PASS: $*"; }; bad() { echo "FAIL: $*"; fail=1; }

# Build two templates from the REAL migration chain (guard files excluded): with S1 and without S1.
# Stand-ins for objects owned by sibling products live in support/base.sql. Individual migration errors are
# tolerated only for files unrelated to this test, but S1 and the tables under test must exist (checked below).
build_tpl() { # <db> <with_s1:1|0>
  P -d postgres -c "drop database if exists $1" -c "create database $1" >/dev/null
  P -d "$1" -f "$here/support/base.sql" >/dev/null
  for f in "$root"/supabase/migrations/2026*.sql; do
    b="$(basename "$f" .sql)"
    case "$b" in $G1|$G2) continue;; esac
    if [ "$2" = 0 ]; then case " $S1FILES " in *" $b "*) continue;; esac; fi
    PL -d "$1" -f "$f" >/dev/null 2>&1 || echo "NOTE: $b did not apply cleanly on the synthetic base (ignored)"
  done
}
build_tpl ajg_tpl_s1 1; build_tpl ajg_tpl_pre 0
for t in ajg_tpl_s1 ajg_tpl_pre; do
  [ "$(PA -d $t -c "select to_regclass('public.prompter_ai_jobs') is not null and to_regprocedure('public.fn_create_ai_job_if_entitled(text,jsonb)') is not null and to_regclass('public.prompter_plan_prices') is not null")" = t ] \
    || { echo "FAIL: template $t incomplete"; exit 1; }
done
[ "$(PA -d ajg_tpl_s1 -c "select has_table_privilege('authenticated','public.prompter_ai_jobs','DELETE')")" = f ] && pass "template s1: S1 applied (authenticated has no DELETE)" || bad "template s1 lacks S1"
[ "$(PA -d ajg_tpl_pre -c "select has_table_privilege('authenticated','public.prompter_ai_jobs','DELETE')")" = t ] && pass "template pre_s1: S1 absent (authenticated still has DELETE)" || bad "template pre_s1 unexpectedly has S1"
[ "$(PA -d ajg_tpl_s1 -c "select position('ROLE_NOT_ALLOWED' in pg_get_functiondef('public.fn_create_ai_job_if_entitled(text,jsonb)'::regprocedure))")" = 0 ] && pass "S1 and later main migrations do not contain the guard (RPC is still the B10 body)" || bad "RPC already guarded before the guard migration"

mk() { P -d postgres -c "drop database if exists $1" -c "create database $1 template $2" >/dev/null; }
ap() { P -d "$1" -f "$2" >/dev/null; }
g1() { ap "$1" "$root/supabase/migrations/$G1.sql"; }
g2() { ap "$1" "$root/supabase/migrations/$G2.sql"; }
prep() { case "$2" in s1) g1 "$1"; g2 "$1";; pre_s1) g1 "$1";; esac; }
tplof() { case "$1" in s1) echo ajg_tpl_s1;; pre_s1) echo ajg_tpl_pre;; esac; }

for v in s1 pre_s1; do
  echo "== variant $v"
  db="ajg_$v"; mk "$db" "$(tplof $v)"; prep "$db" "$v"; P -d "$db" -f "$here/support/fixtures.sql" >/dev/null
  out="$(PL -d "$db" -v variant="$v" -f "$here/tests.sql" 2>&1 | grep '^RESULT')"
  echo "$out" | sed 's/^RESULT //'
  n=$(echo "$out" | grep -c ' PASS '); f=$(echo "$out" | grep -c ' FAIL ')
  [ "$f" = 0 ] && [ "$n" -gt 0 ] && pass "$v: $n assertions" || bad "$v: $f failed / $n passed"

  # ---- parallel: 60 owner calls + 20 member calls against a fresh trial tenant (allowance 30) ----
  pdb="ajg_par_$v"; mk "$pdb" "$(tplof $v)"; prep "$pdb" "$v"; P -d "$pdb" -f "$here/support/fixtures.sql" >/dev/null
  P -d "$pdb" -c "insert into auth.users(id,email) values ('c2000000-0000-4000-8000-0000000000c2','member-c@example.invalid'); insert into user_profiles(id,tenant_id,nama,role) values ('c2000000-0000-4000-8000-0000000000c2','c0000000-0000-4000-8000-00000000000c','Member C','member')" >/dev/null
  export HOST PORT USER_ pdb
  { for i in $(seq 60); do echo c1000000-0000-4000-8000-0000000000c1; done; for i in $(seq 20); do echo c2000000-0000-4000-8000-0000000000c2; done; } \
    | xargs -P 20 -I{} "$here/par-call.sh" {} > "$here/.par.$v" 2>/dev/null
  t=$(grep -c '^true$' "$here/.par.$v"); rows=$(PA -d "$pdb" -c "select count(*) from prompter_ai_jobs where tenant_id='c0000000-0000-4000-8000-00000000000c'")
  rm -f "$here/.par.$v"
  [ "$t" = 30 ] && [ "$rows" = 30 ] && pass "$v: 80 parallel calls (60 owner + 20 member) -> exactly 30 allowed, 30 rows" || bad "$v: parallel allowed=$t rows=$rows (want 30/30)"
done

# ---- billing-behaviour parity: owner results identical before (live B10 body) and after the guard ----
mk ajg_par_pre ajg_tpl_s1; P -d ajg_par_pre -f "$here/support/fixtures.sql" >/dev/null
PL -d ajg_par_pre -f "$here/parity.sql" 2>&1 | grep '^PARITY' > "$here/.parity.before"
g1 ajg_par_pre; g2 ajg_par_pre
PL -d ajg_par_pre -f "$here/parity.sql" 2>&1 | grep '^PARITY' > "$here/.parity.after"
nl=$(wc -l < "$here/.parity.before")
if [ "$nl" -ge 9 ] && cmp -s "$here/.parity.before" "$here/.parity.after"; then pass "billing parity: $nl subscription scenarios (trial, limit, expired, PAST_DUE, CANCELED, plan!=trial, carryover) identical for owners before/after the guard"; else bad "billing parity differs"; diff "$here/.parity.before" "$here/.parity.after"; fi
rm -f "$here/.parity.before" "$here/.parity.after"

# ---- part 2 refuses to apply while authenticated still has DELETE (prerequisite fail-closed: S1 first) ----
mk ajg_pre ajg_tpl_pre; g1 ajg_pre; P -d ajg_pre -f "$here/support/fixtures.sql" >/dev/null
o="$(PL -d ajg_pre -v ON_ERROR_STOP=1 -f "$root/supabase/migrations/$G2.sql" 2>&1 || true)"
if echo "$o" | grep -q "prerequisite missing: apply PR #31"; then pass "part 2 refuses without S1 (authenticated still has DELETE): fail-closed prerequisite"; else bad "part 2 applied without S1"; fi
# part 2 also refuses when part 1 is not live (S1 present, guard function missing)
mk ajg_nog1 ajg_tpl_s1
o="$(PL -d ajg_nog1 -v ON_ERROR_STOP=1 -f "$root/supabase/migrations/$G2.sql" 2>&1 || true)"
if echo "$o" | grep -q "part 1 (quota guard) is not live"; then pass "part 2 refuses when part 1 is not live"; else bad "part 2 applied without part 1"; fi

# ---- repo order: guard at its own file position, followed by every later migration (B1, B2, plan-tampering, P0-2...) ----
P -d postgres -c "drop database if exists ajg_order" -c "create database ajg_order" >/dev/null
P -d ajg_order -f "$here/support/base.sql" >/dev/null
for f in "$root"/supabase/migrations/2026*.sql; do PL -d ajg_order -f "$f" >/dev/null 2>&1 || true; done
fnd=$(PA -d ajg_order -c "select pg_get_functiondef('public.fn_create_ai_job_if_entitled(text,jsonb)'::regprocedure)")
mk ajg_alone ajg_tpl_s1; g1 ajg_alone; g2 ajg_alone
a=$(PA -d ajg_order -c "select md5(pg_get_functiondef('public.fn_create_ai_job_if_entitled(text,jsonb)'::regprocedure))")
b=$(PA -d ajg_alone -c "select md5(pg_get_functiondef('public.fn_create_ai_job_if_entitled(text,jsonb)'::regprocedure))")
tr=$(PA -d ajg_order -c "select count(*) from pg_trigger where tgrelid='public.prompter_ai_jobs'::regclass and tgname in ('trg_prompter_ai_jobs_immutable','trg_prompter_ai_jobs_no_truncate','trg_prompter_ai_jobs_no_delete')")
[ "$a" = "$b" ] && [ "$tr" = 3 ] && echo "$fnd" | grep -q ROLE_NOT_ALLOWED && pass "guard applied at its repo position survives every later migration (RPC md5 == standalone apply; 3 triggers present)" || bad "later migration altered the guard (md5 $a vs $b, triggers=$tr)"

# ---- idempotency, rollback, re-apply, no privilege change (variant s1) ----
echo "== idempotent / rollback / reapply on variant s1 (RPC compared byte-for-byte with the B10 body)"
sigq="select md5(string_agg(x, '|' order by x)) from (
  select 'f:'||md5(pg_get_functiondef(p.oid)) x from pg_proc p where p.proname='fn_create_ai_job_if_entitled' and p.pronamespace='public'::regnamespace
  union all select 't:'||tgname from pg_trigger where tgrelid='public.prompter_ai_jobs'::regclass and not tgisinternal
  union all select 'g:'||tbl||role||priv||granted::text from t_matrix()
  union all select 'a:'||aclexplode.privilege_type||aclexplode.grantee::text||aclexplode.is_grantable::text from pg_class c, aclexplode(c.relacl) where c.oid='public.prompter_ai_jobs'::regclass
  union all select 'x:'||p.proname||has_function_privilege('anon',p.oid,'execute')::text||has_function_privilege('authenticated',p.oid,'execute')::text||has_function_privilege('service_role',p.oid,'execute')::text from pg_proc p where p.proname='fn_create_ai_job_if_entitled'
  union all select 'o:'||pg_get_userbyid(p.proowner)||p.prosecdef::text from pg_proc p where p.proname='fn_create_ai_job_if_entitled'
) s"
mk ajg_rb ajg_tpl_s1
P -d ajg_rb -f "$here/support/fixtures.sql" >/dev/null
pre=$(PA -d ajg_rb -c "$sigq")
g1 ajg_rb; g2 ajg_rb
post=$(PA -d ajg_rb -c "$sigq")
g1 ajg_rb; g2 ajg_rb; g1 ajg_rb
again=$(PA -d ajg_rb -c "$sigq")
[ "$post" = "$again" ] && pass "migrations are idempotent (apply x2 -> identical function/trigger/ACL signature)" || bad "not idempotent"
[ "$pre" != "$post" ] && pass "migrations change the function/trigger set (sanity)" || bad "migration had no effect"
P -d ajg_rb -f "$root/supabase/rollback/$G2.down.sql"
P -d ajg_rb -f "$root/supabase/rollback/$G1.down.sql"
rolled=$(PA -d ajg_rb -c "$sigq")
[ "$rolled" = "$pre" ] && pass "rollback restores the exact pre-migration (live B10) function, triggers and ACL/privilege matrix (no privilege re-opened)" || bad "rollback state differs from pre-migration state"
P -d ajg_rb -f "$root/supabase/rollback/$G2.down.sql" 2>/dev/null; P -d ajg_rb -f "$root/supabase/rollback/$G1.down.sql"   # rollback twice is harmless
[ "$(PA -d ajg_rb -c "$sigq")" = "$pre" ] && pass "rollback is itself idempotent" || bad "second rollback changed state"
g1 ajg_rb; g2 ajg_rb
[ "$(PA -d ajg_rb -c "$sigq")" = "$post" ] && pass "re-apply after rollback == first apply" || bad "re-apply differs"

[ "$fail" = 0 ] && echo "ALL PASSED" || { echo "SOME FAILED"; exit 1; }
