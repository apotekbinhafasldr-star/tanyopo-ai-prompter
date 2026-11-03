#!/usr/bin/env bash
# LOCAL/CI-ONLY rehearsal of the production-migration runner on a THROW-AWAY PostgreSQL with SYNTHETIC data.
# Never touches Supabase: refuses non-local hosts and any credential env var. It drives the SAME runner code path that the
# production workflow uses (run_package.py), so a mistake in the package, the state machine or the STOP logic shows up here first.
set -uo pipefail
HOST="${PGHOST:-/tmp}"; PORT="${PGPORT:-5544}"; USER_="${PGUSER:-postgres}"
case "$HOST" in /*|localhost|127.0.0.1|::1) ;; *) echo "REFUSED: non-local PGHOST=$HOST" >&2; exit 2;; esac
for k in SUPABASE_SECRET_KEY SUPABASE_SERVICE_ROLE_KEY DATABASE_URL POSTGRES_URL SUPABASE_ACCESS_TOKEN MIGRATION_DB_PASSWORD; do
  [ -z "${!k:-}" ] || { echo "REFUSED: $k is set" >&2; exit 2; }
done
case "${PGDATABASE:-}" in *supabase*|*prod*) echo "REFUSED: PGDATABASE looks like a shared database" >&2; exit 2;; esac
root="$(cd "$(dirname "$0")/../../.." && pwd)"; here=$root/supabase/tests/p0-2-invoices; b2s=$root/supabase/tests/b2-double-payment
PK=$root/supabase/prod-packages; RUN="python3 $PK/tools/run_package.py"; MIG=$root/supabase/migrations
export PGOPTIONS="-c client_min_messages=warning" PGHOST="$HOST" PGPORT="$PORT" PGUSER="$USER_"
PS() { psql -X -q "$@"; }; P() { PS -v ON_ERROR_STOP=1 "$@"; }; PA() { PS -At "$@"; }
W="$(mktemp -d)"; fail=0; pass() { echo "PASS: $*"; }; bad() { echo "FAIL: $*"; fail=1; }
SRV=$(PA -d postgres -c "show server_version_num")
if [ -n "${REQUIRE_PG_MAJOR:-}" ]; then
  [ $((SRV/10000)) = "$REQUIRE_PG_MAJOR" ] || { echo "REFUSED: server_version_num=$SRV is not PostgreSQL $REQUIRE_PG_MAJOR" >&2; exit 2; }
  echo "PostgreSQL major $REQUIRE_PG_MAJOR confirmed (server_version_num=$SRV)"
fi
# the REAL B10 table / webhook-events / audit policies, extracted from the repository exactly like the P0-2 suite does
sed -n '/^python3 - "\$root"/,/^PY$/p' $here/run-local.sh > $W/ex.sh
bash -c 'root='"$root"'; W='"$W"'; '"$(cat $W/ex.sh)" >/dev/null 2>&1
[ -s "$W/real_b10.sql" ] && [ -s "$W/real_webhook_audit.sql" ] && pass "real B10/webhook/audit extracted from the repository" || bad "extraction failed"
cat > $W/dp.sql <<'SQL'
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
SQL
mk() { P -d postgres -c "drop database if exists $1" -c "create database $1" >/dev/null \
  && P -d "$1" -f "$here/../s1-trial-quota/support/prod_snapshot.sql" >/dev/null \
  && P -d "$1" -f "$b2s/support/audit_stub.sql" >/dev/null && P -d "$1" -f "$W/real_b10.sql" >/dev/null \
  && P -d "$1" -f "$b2s/support/seed.sql" >/dev/null && P -1 -d "$1" -f "$MIG/20261029220000_prompter_p0_subscription_plan_tampering_lockdown.sql" >/dev/null \
  && P -1 -d "$1" -f "$MIG/20261030100000_prompter_b1_server_only_checkout.sql" >/dev/null && P -1 -d "$1" -f "$MIG/20261030100100_prompter_b1_trial_remainder_carryover.sql" >/dev/null \
  && P -1 -d "$1" -f "$MIG/20261030140000_prompter_b2_double_payment_safety.sql" >/dev/null \
  && P -d "$1" -f "$W/real_webhook_audit.sql" >/dev/null && P -d "$1" -f "$W/dp.sql" >/dev/null \
  && P -d "$1" -f "$MIG/20260901130513_prompter_billing_invoices.sql" >/dev/null && P -d "$1" -c "alter table public.prompter_invoices add column if not exists billing_country text" >/dev/null \
  && P -d "$1" <<'SQL' >/dev/null
create schema if not exists supabase_migrations;
create table supabase_migrations.schema_migrations(version text primary key, name text, statements text[], created_by text);
insert into supabase_migrations.schema_migrations(version,name) values ('20261030140000','b2'),('20261031100000','b4'),('20261101100000','b42');
create schema if not exists cron; create table cron.job(jobid serial, command text);
select * from public.fn_apply_verified_payment('00000000-0000-0000-0000-0000000e0001','xnd_pay_1','xnd_ev_1',299000,'IDR');
select * from public.fn_apply_verified_payment('00000000-0000-0000-0000-0000000e0003','xnd_pay_3','xnd_ev_3',299000,'IDR');
SQL
}
FP() { PA -d "$1" -c "select (select md5(coalesce(string_agg(t::text,'|' order by id),'')) from prompter_payment_transactions t)||(select md5(coalesce(string_agg(t::text,'|' order by tenant_id),'')) from prompter_subscriptions t)||(select count(*) from prompter_invoices)||(select count(*) from prompter_audit_logs)"; }
R() { # <db> <mode> [extra args]  -> runner output in $W/out.txt, exit code returned
  local db=$1 mode=$2; shift 2
  PGDATABASE=$db $RUN --package p0-2 --mode "$mode" --target rehearsal --sha 0123456789abcdef0123456789abcdef01234567 --run-id rehearsal-1 "$@" >$W/out.txt 2>&1; }
SNAP() { PA -d "$1" -F'|' -f $PK/tools/catalog_snapshot.sql | sort; }

# --- 0) static + unit
$RUN --package p0-2 --mode check-only >/dev/null && pass "check-only: files, checksums, lint and object allow-lists" || bad "check-only"
python3 -m unittest discover -s $PK/tests -p 'test_*.py' >$W/ut.txt 2>&1 && pass "python unit tests (approval, expectations, connection policy, lint, tamper cases)" || { bad "unit tests"; tail -15 $W/ut.txt; }

# --- 1) full apply through the runner, state-aware verify before and after
M=rh1; mk $M && pass "chain B10..B2 + real invoices table + 2 historical PAID (Xendit) + stubs" || bad "setup"
[ "$(PA -d $M -c "select count(*) from prompter_payment_transactions where status='PAID'")" = 2 ] && pass "pre-state: 2 PAID, 0 invoices" || bad "pre-state"
R $M verify-only && grep -q "state: PRE" $W/out.txt && grep -q "PASS A preflight" $W/out.txt && pass "verify-only on a pre-apply database runs the PREFLIGHT (A) and passes" || { bad "verify-only PRE"; cat $W/out.txt; }
R $M owner-audit && grep -q "login_role" $W/out.txt && pass "owner-audit mode runs read-only" || { bad "owner-audit"; cat $W/out.txt; }
F0=$(FP $M); SNAP $M > $W/snap0.txt
R $M apply && grep -q "RESULT: PASS" $W/out.txt && pass "apply: A -> B -> C(compared with A) -> D -> F all hold" || { bad "apply"; cat $W/out.txt; }
[ "$F0" = "$(FP $M)" ] && pass "transactions, subscriptions, invoices (0) and audit byte-identical: the 2 historical PAID are untouched, no backfill" || bad "data changed"
SNAP $M > $W/snap1.txt
python3 - "$W/snap0.txt" "$W/snap1.txt" "$PK/manifest.json" <<'PY' && pass "catalog diff = EXACTLY the manifest's expected_effects (nothing else changed)" || bad "catalog diff differs from expected_effects"
import json, sys
def load(p): return dict(l.rstrip("\n").rsplit("|", 1) for l in open(p) if l.strip())
a, b = load(sys.argv[1]), load(sys.argv[2])
changed = sorted(k for k in set(a) | set(b) if a.get(k) != b.get(k))
exp = sorted(json.load(open(sys.argv[3]))["packages"]["p0-2"]["expected_effects"])
if changed != exp:
    print("changed:", changed); print("expected:", exp); sys.exit(1)
PY
[ "$(PA -d $M -c "select created_by from supabase_migrations.schema_migrations where version='20261103170000'")" = "github-actions:rehearsal-1:0123456789ab" ] && pass "ledger row records the run id and SHA (audit trail)" || bad "ledger created_by"
R $M apply && bad "apply ran twice" || { grep -q "apply refused: state is DONE" $W/out.txt && pass "second apply is refused (state DONE), nothing run"; }
R $M verify-only && grep -q "state: DONE" $W/out.txt && grep -q "PASS F final" $W/out.txt && pass "verify-only after apply runs the FINAL check (F)" || { bad "verify-only DONE"; cat $W/out.txt; }
# a NEW payment makes exactly one invoice, a replay of an old webhook changes nothing, and rollback refuses while a linked invoice exists
T=$(PA -d $M -c "set role service_role; select out_transaction_id from public.fn_begin_checkout('00000000-0000-0000-0000-0000000000d1'::uuid,'00000000-0000-0000-0000-0000000000d2'::uuid,'PRO','midtrans')" 2>&1 | grep -E '^[0-9a-f]{8}-' | tail -1)
AM=$(PA -d $M -c "select amount||'/'||currency from prompter_payment_transactions where id='$T'")
for i in 1 2; do PA -d $M -c "select * from public.fn_apply_verified_payment('$T','pay_new','ev_new',${AM%/*},'${AM#*/}')" >/dev/null; done
PA -d $M -c "select * from public.fn_apply_verified_payment('00000000-0000-0000-0000-0000000e0001','xnd_pay_1','xnd_ev_1',299000,'IDR')" >/dev/null
[ "$(PA -d $M -c "select count(*) from prompter_invoices")" = 1 ] && [ "$(PA -d $M -c "select count(*) from prompter_invoices where transaction_id='$T'")" = 1 ] && pass "new payment (applied twice) = exactly one invoice; replay of an OLD paid webhook adds none" || bad "invoice behaviour"
R $M rollback && bad "rollback ran with a linked invoice" || { grep -q "rollback refused" $W/out.txt && pass "rollback STOPs while a linked invoice exists (customer proof of payment)"; }
[ "$(PA -d $M -c "select md5(regexp_replace(prosrc,'\s+','','g')) from pg_proc where proname='fn_apply_verified_payment'")" = fed9cc40c66292168cf7d26b53adaec0 ] && pass "refused rollback left v3 in place" || bad "fn changed"

# --- 2) applied but not recorded -> record-ledger
M=rh2; mk $M && P -d $M -f $PK/p0-2/B_p02_apply_sql_editor.sql >/dev/null && pass "(setup) B applied by hand, ledger not recorded"
R $M verify-only && grep -q "state: APPLIED_UNRECORDED" $W/out.txt && grep -q "PASS C verification" $W/out.txt && grep -q "NEXT: run mode record-ledger" $W/out.txt && pass "verify-only in the applied-but-unrecorded state runs C and points at record-ledger" || { bad "verify APPLIED_UNRECORDED"; cat $W/out.txt; }
R $M apply && bad "apply ran on an applied database" || { grep -q "apply refused: state is APPLIED_UNRECORDED" $W/out.txt && pass "apply refuses on an applied-but-unrecorded database"; }
R $M record-ledger && grep -q "RESULT: PASS" $W/out.txt && pass "record-ledger: C -> D -> F" || { bad "record-ledger"; cat $W/out.txt; }
R $M record-ledger && bad "record-ledger twice" || pass "record-ledger refuses once recorded"

# --- 3) unknown / drifted state: STOP, nothing run
M=rh3; mk $M && P -d $M -c "create or replace function public.fn_apply_verified_payment(p_transaction_id uuid, p_provider_payment_id text, p_provider_event_id text, p_verified_amount numeric, p_verified_currency text) returns table(allowed boolean, reason text) language plpgsql security definer set search_path=public as \$\$ begin return query select false, 'DRIFT'::text; end \$\$" >/dev/null
F3=$(FP $M)
for md in verify-only apply record-ledger rollback; do R $M $md && bad "$md ran on a drifted database" || { grep -q "UNKNOWN\|refused" $W/out.txt && pass "$md STOPs on a drifted fn_apply_verified_payment"; }; done
[ "$(PA -d $M -c "select count(*) from information_schema.columns where table_name='prompter_invoices' and column_name='transaction_id'")" = 0 ] && [ "$F3" = "$(FP $M)" ] && pass "drifted database untouched" || bad "drift db changed"

# --- 4) rollback path (no linked invoice), re-apply afterwards
M=rh4; mk $M && R $M apply && pass "(setup) applied through the runner" || bad "rh4 apply"
R $M rollback && grep -q "RESULT: PASS" $W/out.txt && pass "rollback restores B2 v2 and drops the column/index" || { bad "rollback"; cat $W/out.txt; }
[ "$(PA -d $M -c "select md5(regexp_replace(prosrc,'\s+','','g')) from pg_proc where proname='fn_apply_verified_payment'")" = dbd3a48a43c2959bbc02ad0575b23803 ] && pass "function is B2 v2 again" || bad "fn not v2"
R $M apply && bad "apply ran after rollback with the ledger row still present" || pass "apply stays refused while the ledger row exists (stale-record guard)"
M=rh5; mk $M && R $M rollback && bad "rollback on pre-apply" || pass "rollback refused on a pre-apply database"

# --- 5) tampering: edited package never reaches the database
TD=$(mktemp -d); for d in supabase/prod-packages supabase/migrations supabase/rollback; do mkdir -p $TD/$d && cp -r $root/$d/. $TD/$d/; done
echo "-- edited" >> $TD/supabase/prod-packages/p0-2/A_p02_preflight_readonly.sql
M=rh6; mk $M; F6=$(FP $M)
R $M apply --root $TD && bad "tampered package ran" || { grep -q "SHA-256 does not match" $W/out.txt && pass "a tampered file (checksum mismatch) STOPs before any database connection"; }
python3 - "$TD" <<'PY'
import hashlib, json, sys
td = sys.argv[1]; p = td + "/supabase/prod-packages/manifest.json"; m = json.load(open(p)); k = m["packages"]["p0-2"]
a = td + "/" + k["files"]["A"]["path"]; k["files"]["A"]["sha256"] = hashlib.sha256(open(a, "rb").read()).hexdigest()
json.dump(m, open(p, "w"))
PY
R $M verify-only --root $TD && pass "(control) a legitimately re-hashed READ-ONLY comment edit is accepted by the checksum, as designed" || { bad "control"; cat $W/out.txt; }
printf 'insert into public.prompter_invoices default values;\n' >> $TD/supabase/prod-packages/p0-2/A_p02_preflight_readonly.sql
python3 - "$TD" <<'PY'
import hashlib, json, sys
td = sys.argv[1]; p = td + "/supabase/prod-packages/manifest.json"; m = json.load(open(p)); k = m["packages"]["p0-2"]
a = td + "/" + k["files"]["A"]["path"]; k["files"]["A"]["sha256"] = hashlib.sha256(open(a, "rb").read()).hexdigest()
json.dump(m, open(p, "w"))
PY
R $M apply --root $TD && bad "re-hashed write in a read-only file ran" || { grep -q "read-only file contains" $W/out.txt && pass "a WRITE hidden in a read-only file STOPs even though its checksum was regenerated (checksum is not the only guard)"; }
[ "$F6" = "$(FP $M)" ] && [ "$(PA -d $M -c "select count(*) from prompter_invoices")" = 0 ] && pass "database untouched by tampered packages" || bad "tamper db changed"

# --- 6) connection policy and secrecy
PGDATABASE=rh6 PGPASSWORD=CANARY_pw_9f3 $RUN --package p0-2 --mode apply --target production >$W/out.txt 2>&1 && bad "production target accepted a local host" || { grep -q "production host must be the Supavisor pooler" $W/out.txt && pass "production target refuses a non-pooler host"; }
grep -q CANARY_pw_9f3 $W/out.txt && bad "password leaked in the log" || pass "password never appears in the log"
PGDATABASE=no_such_db_x PGPASSWORD=CANARY_pw_9f3 $RUN --package p0-2 --mode verify-only --target rehearsal >$W/out.txt 2>&1 && bad "connected to a missing db" || { grep -q CANARY_pw_9f3 $W/out.txt && bad "password leaked in an error" || pass "connection error output is free of the password"; }
cp $W/out.txt $W/all_logs.txt
[ "$(grep -cE "SUPABASE_ACCESS_TOKEN|SERVICE_ROLE_KEY|SUPABASE_SECRET|DATABASE_URL" $PK/tools/run_package.py)" = 0 ] && pass "runner references no service key, access token or connection URL" || bad "unexpected credential reference in the runner"
echo "EXIT fail=$fail"; [ $fail = 0 ] && echo "ALL PASSED"; exit $fail
