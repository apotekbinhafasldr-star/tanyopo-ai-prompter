#!/usr/bin/env bash
# LOCAL-ONLY tests of the quota-guard wrapper (supabase/tools/quota-guard-wrapper) on a THROW-AWAY PostgreSQL with
# SYNTHETIC data and a synthetic ledger. Never touches Supabase. Refuses non-local hosts and credential env vars.
# REQUIRE_PG_MAJOR=17 (set in CI) refuses any other PostgreSQL major.
set -uo pipefail
HOST="${PGHOST:-/tmp}"; PORT="${PGPORT:-5544}"; USER_="${PGUSER:-postgres}"
case "$HOST" in /*|localhost|127.0.0.1|::1) ;; *) echo "REFUSED: non-local PGHOST=$HOST" >&2; exit 2;; esac
for k in SUPABASE_SECRET_KEY SUPABASE_SERVICE_ROLE_KEY DATABASE_URL POSTGRES_URL TOKEN_ENCRYPTION_KEY; do
  if [ -n "${!k:-}" ]; then echo "REFUSED: $k is set" >&2; exit 2; fi
done
case "${PGDATABASE:-}" in *supabase*|*prod*) echo "REFUSED: PGDATABASE looks like a shared database" >&2; exit 2;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../../.." && pwd)"
GEN="$root/supabase/tools/quota-guard-wrapper/generate.mjs"; TOOLS="$root/supabase/tools/quota-guard-wrapper"
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

V1=20261021120000; V2=20261021120100
BEFORE=$(node -e 'process.stdout.write(require(process.argv[1]).expect.rpcMd5Before)' "$TOOLS/manifest.json")
AFTER1=$(node -e 'process.stdout.write(require(process.argv[1]).expect.rpcMd5AfterPart1)' "$TOOLS/manifest.json")

# template = production shape: full main chain (S1 included) WITHOUT the guard files + a synthetic ledger
G1=20261021120000_prompter_ai_jobs_quota_guard; G2=20261021120100_prompter_ai_jobs_delete_guard
PS -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists qgw_tpl" -c "create database qgw_tpl" >/dev/null
PS -v ON_ERROR_STOP=1 -d qgw_tpl -f "$here/support/base.sql" >/dev/null
for f in "$root"/supabase/migrations/2026*.sql; do
  b="$(basename "$f" .sql)"; case "$b" in $G1|$G2) continue;; esac
  PS -d qgw_tpl -f "$f" >/dev/null 2>&1 || true
done
PS -v ON_ERROR_STOP=1 -d qgw_tpl >/dev/null <<'SQL'
create schema supabase_migrations;
create table supabase_migrations.schema_migrations(version text primary key, statements text[], name text,
  created_by text, idempotency_key text unique, rollback text[]);
insert into supabase_migrations.schema_migrations(version,name,statements,created_by)
  select v,'synthetic_'||v,array['select 1'],'synthetic' from unnest(array['20260815052549','20261015144639','20261019100000','20261019100100','20261019100200','20261103170000']) v;
create table public.other_product_marker(a int);
SQL
chk "template RPC md5 == manifest rpcMd5Before (live B10 body)" "$(PA -d qgw_tpl -c "select md5(pg_get_functiondef('public.fn_create_ai_job_if_entitled(text,jsonb)'::regprocedure))")" "$BEFORE"
mk() { PS -d postgres -c "drop database if exists $1" -c "create database $1 template qgw_tpl" >/dev/null 2>&1; }
gen() { node "$GEN" generate "$1" > "$W/w_$1.sql" 2>"$W/gen.err"; }
run() { PS -v ON_ERROR_STOP=1 -d "$1" -c "$(cat "$2")" >"$W/o.txt" 2>&1; echo $?; }   # whole wrapper = ONE query string
ap() { gen "$2" || { echo gen-failed; return; }; run "$1" "$W/w_$2.sql"; }
err() { grep -c "$1" "$W/o.txt"; }
led() { PA -d "$1" -c "select coalesce(string_agg(version,',' order by version),'-') from supabase_migrations.schema_migrations where version in ('$V1','$V2')"; }
rpc() { PA -d "$1" -c "select md5(pg_get_functiondef('public.fn_create_ai_job_if_entitled(text,jsonb)'::regprocedure))"; }
trg() { PA -d "$1" -c "select count(*) from pg_trigger where tgrelid='public.prompter_ai_jobs'::regclass and not tgisinternal"; }
acl() { PA -d "$1" -c "select md5(coalesce(string_agg(x,',' order by x),'')) from (select c.relacl::text x from pg_class c where c.oid='public.prompter_ai_jobs'::regclass union all select att.attname||att.attacl::text from pg_attribute att where att.attrelid='public.prompter_ai_jobs'::regclass and att.attacl is not null union all select proacl::text from pg_proc where oid='public.fn_create_ai_job_if_entitled(text,jsonb)'::regprocedure) q"; }
verdict() { PA -d "$1" -f "$TOOLS/$2_readonly.sql" | grep '^99|' | cut -d'|' -f3; }
fp() { echo "$(rpc "$1")/trg=$(trg "$1")/led=$(led "$1")/acl=$(acl "$1")"; }

# ---- 1) happy path: preflight -> part 1 -> postflight -> preflight -> part 2 -> postflight ----
mk qgw1
chk "preflight verdict before part 1" "$(verdict qgw1 preflight)" "READY_FOR_PART1"
A0=$(acl qgw1)
chk "apply part 1 (one query)" "$(ap qgw1 $V1)" "0"
chk "part 1: RPC md5 == manifest rpcMd5AfterPart1" "$(rpc qgw1)" "$AFTER1"
chk "part 1: ledger row" "$(led qgw1)" "$V1"
chk "part 1: ACL (table, columns, RPC) unchanged" "$(acl qgw1)" "$A0"
chk "postflight verdict after part 1" "$(verdict qgw1 postflight)" "POST_OK_PART1"
chk "preflight verdict after part 1" "$(verdict qgw1 preflight)" "READY_FOR_PART2"
chk "apply part 2 (one query)" "$(ap qgw1 $V2)" "0"
chk "part 2: ledger rows" "$(led qgw1)" "$V1,$V2"
chk "part 2: RPC md5 unchanged" "$(rpc qgw1)" "$AFTER1"
chk "part 2: three triggers" "$(trg qgw1)" "3"
chk "part 2: ACL unchanged" "$(acl qgw1)" "$A0"
chk "postflight verdict after part 2" "$(verdict qgw1 postflight)" "POST_OK_ALL"
chk "preflight verdict when done" "$(verdict qgw1 preflight)" "DONE"
chk "ledger row content == migration file (sha256)" "$(PA -d qgw1 -c "select encode(sha256(convert_to(statements[1],'UTF8')),'hex') from supabase_migrations.schema_migrations where version='$V1'")" "$(sha256sum "$root/supabase/migrations/$G1.sql" | cut -d' ' -f1)"
chk "unrelated ledger versions untouched" "$(PA -d qgw1 -c "select count(*) from supabase_migrations.schema_migrations where version not in ('$V1','$V2')")" "6"
chk "unrelated product table untouched" "$(PA -d qgw1 -c "select count(*) from public.other_product_marker")" "0"
chk "second run of part 1 is refused (already recorded)" "$(ap qgw1 $V1)$(err 'STOP\[already-recorded\]')" "11"

# ---- 2) STOP paths: nothing applied, nothing recorded ----
mk qgw2; B=$(fp qgw2)
chk "part 2 before part 1 -> STOP[prerequisite-missing]" "$(ap qgw2 $V2)$(err 'STOP\[prerequisite-missing\]')" "11"; chk "  state unchanged" "$(fp qgw2)" "$B"
mk qgw3; PS -d qgw3 -c "delete from supabase_migrations.schema_migrations where version='20261019100100'" >/dev/null; B=$(fp qgw3)
chk "S1 not fully recorded -> STOP[s1-missing]" "$(ap qgw3 $V1)$(err 'STOP\[s1-missing\]')" "11"; chk "  state unchanged" "$(fp qgw3)" "$B"
mk qgw4; PS -d qgw4 -c "grant delete on public.prompter_ai_jobs to authenticated" >/dev/null; B=$(fp qgw4)
chk "S1 recorded but a client write privilege is back -> STOP[s1-state]" "$(ap qgw4 $V1)$(err 'STOP\[s1-state\]')" "11"; chk "  state unchanged" "$(fp qgw4)" "$B"
mk qgw5; PS -d qgw5 -c "create or replace function public.fn_create_ai_job_if_entitled(p_job_type text, p_input_reference jsonb default '{}'::jsonb) returns table(job_id uuid, allowed boolean, reason text, used_count integer, allowance integer) language sql security definer as \$\$ select null::uuid,false,'X'::text,0,0 \$\$" >/dev/null; B=$(fp qgw5)
chk "RPC differs from the live B10 body -> STOP[rpc-drift]" "$(ap qgw5 $V1)$(err 'STOP\[rpc-drift\]')" "11"; chk "  state unchanged" "$(fp qgw5)" "$B"
mk qgw6; PS -d qgw6 -c "create function public.fn_guard_ai_job_delete() returns trigger language plpgsql as \$\$ begin return old; end \$\$" >/dev/null; B=$(fp qgw6)
chk "guard function pre-exists without ledger -> STOP[state-drift]" "$(ap qgw6 $V1)$(err 'STOP\[state-drift\]')" "11"; chk "  state unchanged" "$(fp qgw6)" "$B"
mk qgw7; PS -d qgw7 -c "update supabase_migrations.schema_migrations set name='prompter_ai_jobs_quota_guard' where version='20260815052549'" >/dev/null; B=$(fp qgw7)
chk "name already in ledger under another version -> STOP[name-recorded]" "$(ap qgw7 $V1)$(err 'STOP\[name-recorded\]')" "11"

# ---- 3) failure injection: SQL OK but a later check fails -> whole transaction (incl. ledger) rolled back ----
inject() { python3 - "$1" "$2" "$3" <<'PY'
import sys
src=open(sys.argv[1]).read(); marker="-- QG-WRAPPER: MIGRATION END"
i=src.index(marker); j=src.index("\n",i)+1
open(sys.argv[2],"w").write(src[:j]+sys.argv[3]+"\n"+src[j:])
PY
}
mk qgw8; B=$(fp qgw8); gen $V1
inject "$W/w_$V1.sql" "$W/inj1.sql" "grant insert on public.prompter_ai_jobs to anon;"
chk "an extra GRANT during the migration -> STOP[new-privilege]" "$(run qgw8 "$W/inj1.sql")$(err 'STOP\[new-privilege\]')" "11"; chk "  everything rolled back (RPC, triggers, ledger, ACL)" "$(fp qgw8)" "$B"
inject "$W/w_$V1.sql" "$W/inj2.sql" "revoke update (status) on public.prompter_ai_jobs from authenticated;"
chk "a lost column privilege -> STOP[lost-privilege]" "$(run qgw8 "$W/inj2.sql")$(err 'STOP\[lost-privilege\]')" "11"; chk "  everything rolled back" "$(fp qgw8)" "$B"
inject "$W/w_$V1.sql" "$W/inj3.sql" "delete from public.prompter_ai_jobs;"
PS -d qgw8 -c "insert into tenants(id,nama_usaha) values ('a0000000-0000-4000-8000-00000000000a','T'); insert into prompter_ai_jobs(tenant_id,job_type,status) values ('a0000000-0000-4000-8000-00000000000a','CONTENT_GENERATION','COMPLETED')" >/dev/null
chk "a row deleted during the migration -> STOP[rows-changed]" "$(run qgw8 "$W/inj3.sql")$(err 'STOP\[rows-changed\]')" "11"; chk "  the row is still there" "$(PA -d qgw8 -c "select count(*) from prompter_ai_jobs")" "1"
inject "$W/w_$V1.sql" "$W/inj4.sql" "insert into supabase_migrations.schema_migrations(version,name,statements) values ('20261021120000','dup',array['x']);"
chk "ledger conflict -> whole transaction fails" "$(run qgw8 "$W/inj4.sql" | sed 's/^[1-9].*/nonzero/')" "nonzero"; chk "  nothing applied" "$(fp qgw8)" "$B"
chk "then a clean retry of the SAME wrapper succeeds" "$(run qgw8 "$W/w_$V1.sql")" "0"

# ---- 4) split execution is detected (psql -f runs statements one by one) ----
mk qgw9; B=$(fp qgw9); gen $V1
PS -v ON_ERROR_STOP=1 -d qgw9 -f "$W/w_$V1.sql" >"$W/o.txt" 2>&1; rc=$?
chk "psql -f (not one query) -> STOP[not-single-transaction] or no change at all" "$([ $rc -ne 0 ] && grep -q 'STOP\[not-single-transaction\]' "$W/o.txt" && echo stop || echo "rc=$rc")" "stop"
chk "  RPC and ledger untouched by the split run" "$(rpc qgw9)/$(led qgw9)" "$BEFORE/-"

# ---- 5) the migrations alone leave the product working (RPC still serves an owner) ----
mk qgw10; ap qgw10 $V1 >/dev/null; ap qgw10 $V2 >/dev/null
PS -v ON_ERROR_STOP=1 -d qgw10 -f "$here/support/fixtures.sql" >/dev/null
chk "owner of a trial tenant can still create an AI job after the wrapped apply" "$(PA -d qgw10 -c "select set_config('request.jwt.claims', json_build_object('sub','c1000000-0000-4000-8000-0000000000c1','role','authenticated')::text, false); set local role authenticated; select allowed from public.fn_create_ai_job_if_entitled('CONTENT_GENERATION','{}')" 2>&1 | tail -1)" "t"

rm -rf "$W"
[ "$fail" = 0 ] && echo "ALL QUOTA-GUARD WRAPPER CHECKS PASSED" || { echo "SOME FAILED"; exit 1; }
