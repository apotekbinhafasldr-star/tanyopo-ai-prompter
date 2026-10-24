#!/usr/bin/env bash
# LOCAL-ONLY tests of the S1 migration wrapper (supabase/tools/s1-wrapper) on a THROW-AWAY PostgreSQL with SYNTHETIC
# data. Never touches Supabase. Refuses non-local hosts and credential env vars other than the CI-local PGPASSWORD.
# REQUIRE_PG_MAJOR=17 (set in CI) refuses to run on any other PostgreSQL major.
set -uo pipefail
HOST="${PGHOST:-/tmp}"; PORT="${PGPORT:-5544}"; USER_="${PGUSER:-postgres}"
case "$HOST" in /*|localhost|127.0.0.1|::1) ;; *) echo "REFUSED: non-local PGHOST=$HOST" >&2; exit 2;; esac
for k in SUPABASE_SECRET_KEY SUPABASE_SERVICE_ROLE_KEY DATABASE_URL POSTGRES_URL TOKEN_ENCRYPTION_KEY; do
  if [ -n "${!k:-}" ]; then echo "REFUSED: $k is set" >&2; exit 2; fi
done
case "${PGDATABASE:-}" in *supabase*|*prod*) echo "REFUSED: PGDATABASE looks like a shared database" >&2; exit 2;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../../.." && pwd)"
GEN="$root/supabase/tools/s1-wrapper/generate.mjs"
SNAP="$root/supabase/tests/s1-trial-quota/support/prod_snapshot.sql"
MD="$root/supabase/migrations"
PS() { psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q "$@"; }
PA() { PS -At "$@"; }
W="$(mktemp -d)"; fail=0
pass() { echo "PASS: $*"; }; bad() { echo "FAIL: $*"; fail=1; }
chk() { if [ "$2" = "$3" ]; then pass "$1 [$2]"; else bad "$1 expected=[$3] got=[$2]"; fi; }
SRV=$(PA -d postgres -c "show server_version_num")
if [ -n "${REQUIRE_PG_MAJOR:-}" ]; then
  [ $((SRV/10000)) = "$REQUIRE_PG_MAJOR" ] || { echo "REFUSED: server_version_num=$SRV is not PostgreSQL $REQUIRE_PG_MAJOR" >&2; exit 2; }
  echo "PostgreSQL major $REQUIRE_PG_MAJOR confirmed (server_version_num=$SRV)"
fi
echo "psql: $(psql --version | head -1) | server_version_num=$SRV"

V1=20261019100000; V2=20261019100100; V3=20261019100200
F1=${V1}_prompter_p0_ai_jobs_lockdown; F2=${V2}_prompter_p0_subscription_trial_insert_guard; F3=${V3}_prompter_p0_plan_entitlements_lockdown
declare -A FILE=([$V1]=$F1 [$V2]=$F2 [$V3]=$F3)

mk() { # synthetic production-like DB + a ledger of the same shape holding fake older versions
  PS -d postgres -c "drop database if exists $1" -c "create database $1" >/dev/null 2>&1
  PS -v ON_ERROR_STOP=1 -d "$1" -f "$SNAP" >/dev/null || return 1
  PS -v ON_ERROR_STOP=1 -d "$1" >/dev/null <<'SQL'
create schema supabase_migrations;
create table supabase_migrations.schema_migrations(version text primary key, statements text[], name text,
  created_by text, idempotency_key text unique, rollback text[]);
insert into supabase_migrations.schema_migrations(version,name,statements,created_by)
  select v,'synthetic_'||v,array['select 1'],'synthetic' from unnest(array['20260815052549','20260928161604','20261015144639']) v;
-- an unrelated "other product" table that must never be touched, and an unrelated pending migration file
create table public.other_product_marker(a int);
SQL
}
gen() { node "$GEN" generate "$1" > "$W/w_$1.sql" 2>"$W/gen.err"; }
# Apply = send the WHOLE wrapper as ONE query string (one simple-query message = one implicit transaction).
run() { PS -v ON_ERROR_STOP=1 -d "$1" -c "$(cat "$2")" >"$W/o.txt" 2>&1; echo $?; }
ap() { gen "$2" || { echo gen-failed; return; }; run "$1" "$W/w_$2.sql"; }   # <db> <version> -> rc
inject() { # <in> <out> <sql>: insert SQL right after the migration text (test fixture for failure injection)
  python3 - "$1" "$2" "$3" <<'PY'
import sys
src=open(sys.argv[1]).read(); marker="-- S1-WRAPPER: MIGRATION END"
i=src.index(marker); j=src.index("\n",i)+1
open(sys.argv[2],"w").write(src[:j]+sys.argv[3]+"\n"+src[j:])
PY
}
ACLQ="select coalesce(string_agg(r, ',' order by r),'') from (
 select c.relname||'|'||case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end||'|'||a.privilege_type||'|' r
   from pg_class c join pg_namespace n on n.oid=c.relnamespace, lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
   where n.nspname='public' and c.relname in ('prompter_ai_jobs','prompter_subscriptions','prompter_plan_entitlements')
 union all
 select c.relname||'|'||case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end||'|'||a.privilege_type||'|'||att.attname
   from pg_class c join pg_namespace n on n.oid=c.relnamespace
   join pg_attribute att on att.attrelid=c.oid and att.attnum>0 and not att.attisdropped, lateral aclexplode(att.attacl) a
   where n.nspname='public' and c.relname in ('prompter_ai_jobs','prompter_subscriptions','prompter_plan_entitlements') and att.attacl is not null) q"
acl() { PA -d "$1" -c "$ACLQ"; }
aclmd5() { PA -d "$1" -c "select md5(($ACLQ))"; }
led() { PA -d "$1" -c "select coalesce(string_agg(version,',' order by version),'-') from supabase_migrations.schema_migrations where version>'20261015144639'"; }
trg() { PA -d "$1" -c "select count(*) from pg_trigger where tgname='trg_prompter_subscriptions_enforce_trial_insert'"; }
fnx() { PA -d "$1" -c "select to_regprocedure('public.fn_enforce_trial_subscription_insert()') is not null"; }
fp() { echo "$(aclmd5 "$1")/trg=$(trg "$1")/fn=$(fnx "$1")/led=$(led "$1")"; }
err() { grep -c "$1" "$W/o.txt"; }
denied() { # <db> <role> <stmt>: must fail with permission denied
  PS -d "$1" -c "set role $2; $3" >"$W/d.txt" 2>&1; local rc=$?
  if [ $rc -ne 0 ] && grep -q "permission denied" "$W/d.txt"; then pass "$2 denied: $3"; else bad "$2 NOT denied: $3 (rc=$rc)"; fi
}

# ---- 0) the environment really gives "one query string = one transaction" (otherwise nothing below is meaningful) ----
mk w0 || { echo "cannot create synthetic DB"; exit 1; }
PS -d w0 -c "create table t_probe(a int); insert into t_probe values (1); select 1/0;" >/dev/null 2>&1
chk "psql -c with several statements is ONE transaction (t_probe rolled back)" "$(PA -d w0 -c "select to_regclass('public.t_probe') is null")" t

# ---- 1) successful, ordered application ----
mk wa; PRE_ACL=$(aclmd5 wa); PRE_FP=$(fp wa)
chk "baseline: no S1 ledger rows" "$(led wa)" "-"
chk "1a 100000 rc" "$(ap wa $V1)" 0
chk "1a ledger" "$(led wa)" "$V1"
chk "1b 100100 rc" "$(ap wa $V2)" 0
chk "1c 100200 rc" "$(ap wa $V3)" 0
chk "1 ledger = exactly the three S1 versions" "$(led wa)" "$V1,$V2,$V3"
for v in $V1 $V2 $V3; do
  want=$(sha256sum "$MD/${FILE[$v]}.sql" | cut -d' ' -f1)
  got=$(PA -d wa -c "select cardinality(statements)||'|'||name||'|'||encode(sha256(convert_to(statements[1],'UTF8')),'hex') from supabase_migrations.schema_migrations where version='$v'")
  chk "1 ledger row $v: 1 statement, name, sha256 == repo file" "$got" "1|${FILE[$v]#*_}|$want"
done
chk "1 other ledger rows untouched" "$(PA -d wa -c "select count(*) from supabase_migrations.schema_migrations where version<='20261015144639'")" 3
chk "1 other pending migration (manual_ad_metrics) NOT applied" "$(PA -d wa -c "select to_regclass('public.prompter_manual_ad_metrics') is null")" t
chk "1 ... and NOT in the ledger" "$(PA -d wa -c "select count(*) from supabase_migrations.schema_migrations where version like '20261018%'")" 0
chk "1 trigger present" "$(trg wa)" 1
FINAL_ACL=$(aclmd5 wa)

# ---- 2) privilege / trigger verification, independent of the wrapper's own checks ----
for t in "truncate public.prompter_ai_jobs" "delete from public.prompter_ai_jobs" "insert into public.prompter_ai_jobs(tenant_id) values (gen_random_uuid())" \
         "truncate public.prompter_subscriptions" "delete from public.prompter_subscriptions" "truncate public.prompter_plan_entitlements" \
         "insert into public.prompter_plan_entitlements(plan) values ('X')" "update public.prompter_plan_entitlements set plan='X'"; do
  denied wa authenticated "$t"
done
denied wa anon "insert into public.prompter_subscriptions(tenant_id) values (gen_random_uuid())"
denied wa anon "truncate public.prompter_ai_jobs"
chk "2 authenticated UPDATE columns on ai_jobs = the 10 allowed" "$(PA -d wa -c "select count(*) from pg_attribute a where a.attrelid='public.prompter_ai_jobs'::regclass and a.attnum>0 and not a.attisdropped and has_column_privilege('authenticated','public.prompter_ai_jobs'::regclass,a.attnum,'UPDATE')")" 10
chk "2 anon holds NO privilege on the three tables' write paths" "$(PA -d wa -c "select count(*) from unnest(array['prompter_ai_jobs','prompter_subscriptions','prompter_plan_entitlements']) t, unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p where has_table_privilege('anon','public.'||t,p)")" 0
chk "2 nobody (anon/authenticated) has TRUNCATE anywhere on the three tables" "$(PA -d wa -c "select count(*) from unnest(array['prompter_ai_jobs','prompter_subscriptions','prompter_plan_entitlements']) t, unnest(array['anon','authenticated']) r where has_table_privilege(r,'public.'||t,'TRUNCATE')")" 0
chk "2 trigger: BEFORE INSERT ROW, enabled, SECURITY INVOKER" "$(PA -d wa -c "select t.tgtype::text||'|'||t.tgenabled::text||'|'||p.prosecdef::text from pg_trigger t join pg_proc p on p.oid=t.tgfoid where t.tgname='trg_prompter_subscriptions_enforce_trial_insert'")" "7|O|false"
PS -d wa -c "insert into public.tenants(id) values ('00000000-0000-0000-0000-0000000000a1')" >/dev/null 2>&1
PS -d wa -c "set role authenticated; insert into public.prompter_subscriptions(tenant_id, status, plan, current_period_end) values ('00000000-0000-0000-0000-0000000000a1','ACTIVE','AGENCY','2099-01-01')" >/dev/null 2>&1
chk "2 trigger really forces a client insert to a 14-day FREE trial (or RLS blocks it)" "$(PA -d wa -c "select coalesce((select plan||'|'||status||'|'||(current_period_end < now()+interval '15 days')::text from public.prompter_subscriptions where tenant_id='00000000-0000-0000-0000-0000000000a1'),'FREE|TRIALING|true')")" "FREE|TRIALING|true"

# ---- 3) migration SQL fails before commit (injected AFTER the whole real migration ran) ----
mk wb; ap wb $V1 >/dev/null; B_FP=$(fp wb)
inject "$W/w_$V2.sql" "$W/w_fail.sql" "create table public.s1_probe_midfail(a int); select 1/0;"
chk "3 rc (error)" "$(run wb "$W/w_fail.sql")" 1
chk "3 division_by_zero surfaced" "$(err 'division by zero')" 1
chk "3 NO state change at all (privileges, trigger, function, ledger)" "$(fp wb)" "$B_FP"
chk "3 probe table rolled back too" "$(PA -d wb -c "select to_regclass('public.s1_probe_midfail') is null")" t
chk "3 no idle-in-transaction session left behind" "$(PA -d postgres -c "select count(*) from pg_stat_activity where state like 'idle in transaction%'")" 0

# ---- 4) ledger write fails -> migration cancelled; 5) retry afterwards ----
mk wc; ap wc $V1 >/dev/null; C_FP=$(fp wc)
PS -d wc -c "create function supabase_migrations.boom() returns trigger language plpgsql as \$\$ begin raise exception 'ledger write refused'; end \$\$;
             create trigger boom before insert on supabase_migrations.schema_migrations for each row when (new.version='$V2') execute function supabase_migrations.boom();" >/dev/null
chk "4 rc (error)" "$(ap wc $V2)" 1
chk "4 ledger error surfaced" "$(err 'ledger write refused')" 1
chk "4 migration cancelled: NO state change" "$(fp wc)" "$C_FP"
# a ledger that silently alters what is stored must also cancel everything (post-insert verification)
PS -d wc -c "drop trigger boom on supabase_migrations.schema_migrations;
             create function supabase_migrations.tamper() returns trigger language plpgsql as \$\$ begin new.statements := array['select 1']; return new; end \$\$;
             create trigger tamper before insert on supabase_migrations.schema_migrations for each row when (new.version='$V2') execute function supabase_migrations.tamper();" >/dev/null
chk "4b tampered ledger row rc (error)" "$(ap wc $V2)" 1
chk "4b ledger-verify STOP" "$(err 'STOP\[ledger-verify\]')" 1
chk "4b NO state change" "$(fp wc)" "$C_FP"
PS -d wc -c "drop trigger tamper on supabase_migrations.schema_migrations" >/dev/null
chk "5 retry after ledger failure rc" "$(ap wc $V2)" 0
chk "5 retry ledger" "$(led wc)" "$V1,$V2"
chk "5 retry after migration failure (wb) rc" "$(ap wb $V2)" 0
mk wref; ap wref $V1 >/dev/null; ap wref $V2 >/dev/null
chk "5 retries end in the same privileges as a clean run (no extra, no missing)" "$(aclmd5 wb)/$(aclmd5 wc)" "$(aclmd5 wref)/$(aclmd5 wref)"
denied wc authenticated "truncate public.prompter_subscriptions"
denied wc anon "delete from public.prompter_ai_jobs"

# ---- 6) already recorded -> refused, nothing re-executed ----
S6=$(fp wa)
chk "6 re-run 100100 rc" "$(ap wa $V2)" 1
chk "6 STOP[already-recorded]" "$(err 'STOP\[already-recorded\]')" 1
chk "6 no state change" "$(fp wa)" "$S6"
# the same name recorded under another (platform-assigned) version is also refused
mk wn; PS -d wn -c "insert into supabase_migrations.schema_migrations(version,name,statements) values ('20261020000001','prompter_p0_ai_jobs_lockdown',array['x'])" >/dev/null
chk "6b same name under another version rc" "$(ap wn $V1)" 1
chk "6b STOP[name-recorded]" "$(err 'STOP\[name-recorded\]')" 1

# ---- 7) wrong order ----
mk wo; O_FP=$(fp wo)
chk "7a 100200 first rc" "$(ap wo $V3)" 1; chk "7a STOP[prerequisite-missing]" "$(err 'STOP\[prerequisite-missing\]')" 1
chk "7b 100100 first rc" "$(ap wo $V2)" 1; chk "7b STOP[prerequisite-missing]" "$(err 'STOP\[prerequisite-missing\]')" 1
chk "7 nothing changed, files stay pending" "$(fp wo)" "$O_FP"
ap wo $V1 >/dev/null
chk "7c 100200 before 100100 rc" "$(ap wo $V3)" 1
chk "7c 100100 still pending, next in line works" "$(ap wo $V2)" 0
mk wp; PS -d wp -c "insert into supabase_migrations.schema_migrations(version,name,statements) values ('$V3','x','{}')" >/dev/null
chk "7d later S1 version already recorded: 100000 refused rc" "$(ap wp $V1)" 1
chk "7d STOP[later-recorded]" "$(err 'STOP\[later-recorded\]')" 1

# ---- 8) wrong checksum / not allowed / tampered source: refused by the GENERATOR, no SQL is produced ----
tree() { rm -rf "$W/t"; mkdir -p "$W/t/supabase/tools" "$W/t/supabase/migrations"; cp -r "$root/supabase/tools/s1-wrapper" "$W/t/supabase/tools/"; cp "$MD"/*.sql "$W/t/supabase/migrations/"; }
tree; printf -- '-- tampered\n' >> "$W/t/supabase/migrations/$F2.sql"
node "$W/t/supabase/tools/s1-wrapper/generate.mjs" generate $V2 >"$W/t.out" 2>"$W/t.err"; rc=$?
chk "8a tampered file: generator rc" "$rc" 1; chk "8a no SQL emitted" "$(wc -c < "$W/t.out")" 0; chk "8a says size/sha mismatch" "$(grep -c 'locked' "$W/t.err")" 1
node "$W/t/supabase/tools/s1-wrapper/generate.mjs" verify >/dev/null 2>&1; chk "8a verify rc" "$?" 1
tree
for bad_v in 20261018160000 20261019100300 20261021120000 "../../etc/passwd" "" "*" all "20261019100000 20261019100100"; do
  node "$GEN" generate "$bad_v" >"$W/t.out" 2>"$W/t.err"; rc=$?
  chk "8b not allowed [$bad_v]: rc" "$rc" 1; chk "8b not allowed [$bad_v]: no SQL emitted" "$(wc -c < "$W/t.out")" 0
done
cp "$MD/$F1.sql" "$W/t/supabase/migrations/${V1}_shadow_duplicate.sql"
node "$W/t/supabase/tools/s1-wrapper/generate.mjs" generate $V1 >"$W/t.out" 2>"$W/t.err"; chk "8c duplicate file for the same version: rc" "$?" 1
tree; echo "select 1;" > "$W/t/supabase/migrations/20261019100300_extra.sql"
node "$W/t/supabase/tools/s1-wrapper/generate.mjs" generate 20261019100300 >/dev/null 2>&1; chk "8c unlisted S1-looking file: rc" "$?" 1
tree; printf 'begin;\n' | cat - "$MD/$F3.sql" > "$W/t/supabase/migrations/$F3.sql"
node -e '
const fs=require("fs"),c=require("crypto");const d=process.argv[1];const f=d+"/supabase/migrations/'$F3'.sql";const b=fs.readFileSync(f);
const mp=d+"/supabase/tools/s1-wrapper/manifest.json";const m=JSON.parse(fs.readFileSync(mp));m.files["'$V3'"].sha256=c.createHash("sha256").update(b).digest("hex");m.files["'$V3'"].bytes=b.length;fs.writeFileSync(mp,JSON.stringify(m));' "$W/t"
node "$W/t/supabase/tools/s1-wrapper/generate.mjs" generate $V3 >"$W/t.out" 2>"$W/t.err"; chk "8d migration containing BEGIN (even with matching manifest): rc" "$?" 1
chk "8d no SQL emitted" "$(wc -c < "$W/t.out")" 0
node "$GEN" generate $V1 --out "$MD/zz.sql" >/dev/null 2>&1; chk "8e --out inside supabase/migrations refused" "$?" 1
node "$GEN" generate $V1 --out "$GEN" >/dev/null 2>&1; chk "8e --out over an existing file refused" "$?" 1
node "$GEN" generate $V1 --foo >/dev/null 2>&1; chk "8f unknown flag refused" "$?" 2

# ---- 9) DB-side guard against a hostile/edited migration even if someone also edits the manifest ----
hostile() { # <version> <extra sql> -> wrapper file in $W/w_h.sql
  tree; printf '%s\n' "$2" >> "$W/t/supabase/migrations/${FILE[$1]}.sql"
  node -e '
const fs=require("fs"),c=require("crypto");const d=process.argv[1];const f=d+"/supabase/migrations/'${FILE[$1]}'.sql";const b=fs.readFileSync(f);
const mp=d+"/supabase/tools/s1-wrapper/manifest.json";const m=JSON.parse(fs.readFileSync(mp));m.files["'$1'"].sha256=c.createHash("sha256").update(b).digest("hex");m.files["'$1'"].bytes=b.length;fs.writeFileSync(mp,JSON.stringify(m));' "$W/t"
  node "$W/t/supabase/tools/s1-wrapper/generate.mjs" generate "$1" > "$W/w_h.sql"
}
mk wh; ap wh $V1 >/dev/null; H_FP=$(fp wh)
hostile $V2 "grant insert on public.prompter_subscriptions to anon;"
chk "9a hostile (grant anon INSERT) rc" "$(run wh "$W/w_h.sql")" 1; chk "9a STOP (re-granted privilege caught by the end-state check)" "$(grep -c 'STOP\[\(new-privilege\|privilege\)\]' "$W/o.txt")" 1
chk "9a nothing applied/recorded" "$(fp wh)" "$H_FP"
mk wh2; ap wh2 $V1 >/dev/null; ap wh2 $V2 >/dev/null; H2_FP=$(fp wh2)
hostile $V3 "grant truncate on public.prompter_plan_entitlements to authenticated;"
chk "9b hostile (re-grant TRUNCATE) rc" "$(run wh2 "$W/w_h.sql")" 1; chk "9b STOP (new-privilege or privilege)" "$(grep -c 'STOP\[\(new-privilege\|privilege\)\]' "$W/o.txt")" 1
chk "9b nothing applied/recorded" "$(fp wh2)" "$H2_FP"
mk wh3; hostile $V1 "create or replace function public.fn_create_ai_job_if_entitled(p_job_type text, p_input_reference jsonb default '{}'::jsonb) returns table(job_id uuid, allowed boolean, reason text, used_count int, allowance int) language sql as 'select null::uuid, true, null::text, 0, 0';"
chk "9c hostile (redefines the RPC) rc" "$(run wh3 "$W/w_h.sql")" 1; chk "9c STOP[rpc-changed]" "$(err 'STOP\[rpc-changed\]')" 1
chk "9c ledger still empty of S1" "$(led wh3)" "-"

# ---- 10) the wrapper refuses to run when the statements are NOT one transaction (e.g. a client that splits them) ----
mk ws; S_FP=$(fp ws); gen $V1
PS -d ws -v ON_ERROR_STOP=1 -f "$W/w_$V1.sql" >"$W/o.txt" 2>&1; rc=$?
chk "10 psql -f (statement-by-statement autocommit): rc" "$rc" 3
chk "10 STOP[not-single-transaction] before ANY migration SQL" "$(err 'STOP\[not-single-transaction\]')" 1
chk "10 nothing applied" "$(fp ws)" "$S_FP"

# ---- 11) lock timeout: fail fast, whole wrapper cancelled, no queueing behind a writer, retry works ----
mk wl; ap wl $V1 >/dev/null; L_FP=$(fp wl)
( PS -d wl -c "begin; lock table public.prompter_subscriptions in row exclusive mode; select pg_sleep(9); commit" >/dev/null 2>&1 ) &
sleep 1.5; gen $V2; t0=$(date +%s.%N); rc=$(run wl "$W/w_$V2.sql"); t1=$(date +%s.%N)
el=$(python3 -c "print(round($t1-$t0,1))")
chk "11 blocked CREATE TRIGGER: rc (error)" "$rc" 1
chk "11 error is lock_not_available (55P03)" "$(err 'lock timeout')" 1
chk "11 failed fast (3s <= elapsed < 6s)" "$(python3 -c "print(3.0<=$el<6.0)")" True
chk "11 nothing applied, nothing recorded" "$(fp wl)" "$L_FP"
wait
chk "11 retry after the writer finished rc" "$(ap wl $V2)" 0
# GRANT/REVOKE take no table lock in PostgreSQL, so the lock that can stall 100000/100200 is the wrapper's own advisory lock
mk wl2; ( PS -d wl2 -c "begin; select pg_advisory_xact_lock(hashtextextended('linoe:s1-migration-wrapper',0)); select pg_sleep(8); commit" >/dev/null 2>&1 ) &
sleep 1.5; t0=$(date +%s.%N); rc=$(ap wl2 $V1); t1=$(date +%s.%N); el=$(python3 -c "print(round($t1-$t0,1))")
chk "11b wrapper blocked on its advisory lock: rc" "$rc" 1; chk "11b lock timeout" "$(err 'lock timeout')" 1
chk "11b failed fast (3s <= elapsed < 6s)" "$(python3 -c "print(3.0<=$el<6.0)")" True
chk "11b nothing recorded" "$(led wl2)" "-"; wait
chk "11b retry after the lock is gone rc" "$(ap wl2 $V1)" 0

# ---- 12) idempotency & concurrency ----
mk wi; ap wi $V1 >/dev/null; ap wi $V2 >/dev/null
PS -v ON_ERROR_STOP=1 -d wi -f "$MD/$F2.sql" >/dev/null 2>&1   # re-applying the raw file changes nothing
chk "12 raw re-apply of an idempotent file leaves ACL identical" "$(aclmd5 wi)" "$(aclmd5 wi)"
mk wd; ap wd $V1 >/dev/null
PS -v ON_ERROR_STOP=1 -d wd -f "$MD/$F2.sql" >/dev/null 2>&1                    # drift: SQL applied out-of-band, no ledger row
chk "12 drift detected: SQL applied, ledger lacks 100100" "$(led wd)|$(trg wd)" "$V1|1"
chk "12 wrapper reconciles the drift rc" "$(ap wd $V2)" 0
chk "12 ledger now has 100100, still exactly one trigger" "$(led wd)|$(trg wd)" "$V1,$V2|1"
chk "12 drift recovery ends in the clean-run ACL for these two files" "$(aclmd5 wd)" "$(aclmd5 wi)"
mk wq; gen $V1
( run wq "$W/w_$V1.sql" > "$W/c1.rc" ) & ( run wq "$W/w_$V1.sql" > "$W/c2.rc" ) & wait
chk "12 two concurrent runs: exactly one succeeds" "$(cat "$W/c1.rc" "$W/c2.rc" | sort | tr '\n' ' ')" "0 1 "
chk "12 exactly one ledger row" "$(led wq)" "$V1"

# ---- 13) end state equals applying the three raw files in order (wrapper does not change SQL semantics) ----
mk wr; for f in $F1 $F2 $F3; do PS -v ON_ERROR_STOP=1 -1 -d wr -f "$MD/$f.sql" >/dev/null || bad "raw $f"; done
chk "13 wrapper path == raw path: identical ACL" "$(aclmd5 wa)" "$(aclmd5 wr)"
chk "13 identical trigger/function state" "$(trg wa)/$(fnx wa)" "$(trg wr)/$(fnx wr)"
chk "13 wrapper path differs from the pre-state (sanity)" "$([ "$(aclmd5 wa)" != "$PRE_ACL" ] && echo yes)" yes

echo
if [ $fail -eq 0 ]; then echo "ALL S1 WRAPPER CHECKS PASSED"; else echo "S1 WRAPPER CHECKS FAILED"; exit 1; fi
