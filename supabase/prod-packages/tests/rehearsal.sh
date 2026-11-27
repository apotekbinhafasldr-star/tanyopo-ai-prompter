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

# =====================================================================================================================
# --- 7) PIPELINE v2 (JALUR 3 / PR-1): fixture SINTETIS fx-n (pola L1 + Paket 3, bentuk N) di atas stub storage.
#     Kelas bukti: SANDBOX (PostgreSQL sementara + stub), BUKAN bukti hak/perilaku Supabase nyata.
# =====================================================================================================================
FXD=$PK/tests/fixtures; FXM=$FXD/manifest.json; FXP=supabase/prod-packages/tests/fixtures/fx-n
MIGP=$PK/tests/fixtures/fx-n/migration/20990101000000_fixture_native_txn.sql; DOWNP=$PK/tests/fixtures/fx-n/rollback/20990101000000_fixture_native_txn.down.sql
PW_SU="${PGPASSWORD:-}"; PW_MIG=rh_migrator_pw_4c7; PW_MEM=rh_member_pw_5d8; CANARY_RE='CANARY_OTHER_POLICY_zq81|canary-other-bucket-zq81|canary_other_tbl_zq81|fn_canary_other_zq81'
: > $W/fxlogs.txt
mkfx() { P -d postgres -c "drop database if exists $1" -c "create database $1" >/dev/null && P -d "$1" -f $FXD/sandbox_setup.sql >/dev/null; }
RF() { # <db> <user> <pw> <mode> [extra]  -> $W/fx.txt ; exit code returned
  local db=$1 us=$2 pw=$3 mode=$4; shift 4
  PGDATABASE=$db PGUSER=$us PGPASSWORD=$pw $RUN --package fx-n --manifest $FXM --root $root --mode "$mode" --target rehearsal --sha 0123456789abcdef0123456789abcdef01234567 --run-id fx-1 "$@" >$W/fx.txt 2>&1; local rc=$?
  cat $W/fx.txt >> $W/fxlogs.txt; return $rc; }
SNAPX() { { PA -d "$1" -F'|' -f $PK/tools/catalog_snapshot.sql; PA -d "$1" -F'|' -f $PK/tools/catalog_snapshot_ext.sql; } | sort; }
FPX() { PA -d "$1" -c "select (select md5(string_agg(a::text,'|' order by id)) from public.fx_audit_logs a)||(select md5(string_agg(e::text,'|' order by id)) from public.fx_evidence e)||(select count(*) from storage.objects)||(select md5(string_agg(b::text,'|' order by id)) from storage.buckets b where id not in ('fx-reserved-1','fx-reserved-2'))"; }
FXGUARD='no CANARY name in the logs'

$RUN --package fx-n --manifest $FXM --mode check-only >/dev/null && pass "fx-n check-only: allow-lists, shape N, checksums, ddl_targets" || bad "fx-n check-only"
$RUN --package p0-2 --mode check-only >/dev/null && pass "p0-2 still passes the stricter lint unchanged" || bad "p0-2 lint"
grep -q fx-n $PK/manifest.json && bad "fixture leaked into the production manifest" || pass "fixture is not in the production manifest"

# 7a) success path as a NON-superuser member of the owner roles (R1-equivalent rights): A -> probes -> B -> C -> D -> ledger check -> F
M=fx1; mkfx $M && pass "(setup) sandbox: roles, stub storage, fx tables, CANARY objects of 'other products'" || bad "fx setup"
S0=$(SNAPX $M); D0=$(FPX $M)
RF $M linoe_member $PW_MEM verify-only && grep -q "state: PRE" $W/fx.txt && grep -q "PASS A preflight" $W/fx.txt && grep -q "0 BLOCK, 0 UNKNOWN" $W/fx.txt && pass "verify-only (PRE): A passes and every privilege probe is PASS" || { bad "fx verify PRE"; cat $W/fx.txt; }
[ "$S0" = "$(SNAPX $M)" ] && pass "verify-only (A + probes) wrote nothing (catalog identical)" || bad "verify-only changed the catalog"
RF $M linoe_member $PW_MEM owner-audit && grep -q "probes:" $W/fx.txt && pass "owner-audit prints the probe summary" || { bad "fx owner-audit"; cat $W/fx.txt; }
RF $M linoe_member $PW_MEM apply && grep -q "RESULT: PASS" $W/fx.txt && grep -q "PASS ledger row" $W/fx.txt && pass "apply (shape N, allow-list): A, probes, B, C(vs A), D, ledger check, F" || { bad "fx apply"; cat $W/fx.txt; }
[ "$D0" = "$(FPX $M)" ] && pass "audit/evidence rows and bucket rows (non-listed columns) untouched" || bad "fx data changed"
SNAPX $M > $W/fxs1.txt; echo "$S0" > $W/fxs0.txt
python3 - $W/fxs0.txt $W/fxs1.txt $FXM <<'PY' && pass "catalog diff = EXACTLY the fixture's expected_effects (storage policies, bucket flags, trigger, ACL, comment, functions)" || bad "fx catalog diff differs from expected_effects"
import json, sys
def load(p): return dict(l.rstrip("\n").rsplit("|", 1) for l in open(p) if l.strip())
a, b = load(sys.argv[1]), load(sys.argv[2])
ch = sorted(k for k in set(a) | set(b) if a.get(k) != b.get(k)); exp = sorted(json.load(open(sys.argv[3]))["packages"]["fx-n"]["expected_effects"])
if ch != exp: print("changed:", ch); print("expected:", exp); sys.exit(1)
PY
[ "$(PA -d $M -c "select count(*) from supabase_migrations.schema_migrations where version='20990101000000'")" = 1 ] && pass "ledger: exactly one fx row" || bad "ledger count"
[ "$(PA -d $M -c "select created_by from supabase_migrations.schema_migrations where version='20990101000000'")" = "github-actions:fx-1:0123456789ab" ] && pass "ledger created_by = run id + sha" || bad "ledger created_by"
# behaviour (SANDBOX): trigger refuses UPDATE, INSERT still works, purge is the only delete path and is locked to everyone
PA -d $M -c "update public.fx_audit_logs set action='x'" >/dev/null 2>&1 && bad "audit UPDATE allowed" || pass "behaviour: UPDATE of the audit table is refused by the trigger"
PA -d $M -c "insert into public.fx_audit_logs(action) values ('c')" >/dev/null 2>&1 && pass "behaviour: INSERT into the audit table still works" || bad "audit INSERT"
PA -d $M -c "set role service_role; delete from public.fx_audit_logs" >/dev/null 2>&1 && bad "service_role DELETE allowed" || pass "behaviour: service_role cannot DELETE audit rows (ACL)"
[ "$(PA -d $M -c "select public.fn_fx_evidence_purge(now() - interval '1 day')")" = 1 ] && pass "behaviour: the allow-listed purge function deletes only evidence older than the cut-off" || bad "purge"
# 7b) idempotence: apply again / record-ledger again are refused and change nothing
S1=$(SNAPX $M)
RF $M linoe_member $PW_MEM apply && bad "second apply ran" || { grep -q "apply refused: state is DONE" $W/fx.txt && pass "idempotent: second apply refused (DONE), nothing run"; }
RF $M linoe_member $PW_MEM record-ledger && bad "record-ledger ran twice" || pass "idempotent: record-ledger refused once recorded"
RF $M linoe_member $PW_MEM verify-only && grep -q "state: DONE" $W/fx.txt && grep -q "PASS F final" $W/fx.txt && pass "verify-only DONE runs F" || { bad "fx verify DONE"; cat $W/fx.txt; }
[ "$S1" = "$(SNAPX $M)" ] && pass "repeat runs left the catalog byte-identical" || bad "repeat changed the catalog"
# raw ACL check: a REVOKE that silently did nothing (non-owner) is caught by F
P -d $M -c "grant update on public.fx_audit_logs to service_role" >/dev/null
RF $M linoe_member $PW_MEM verify-only && bad "F passed with a restored UPDATE grant" || { grep -q "acl_audit_tulis_harus_0" $W/fx.txt && pass "raw-ACL check: a no-op REVOKE (UPDATE still granted) is caught by F"; }

# 7c) rollback (E) + G + state afterwards; the ledger row stays and blocks a blind re-apply
M=fx2; mkfx $M; RF $M linoe_member $PW_MEM apply >/dev/null || bad "fx2 apply"
RF $M linoe_member $PW_MEM rollback && grep -q "RESULT: PASS" $W/fx.txt && grep -q "PASS G state after rollback" $W/fx.txt && grep -q "state after rollback: ROLLED_BACK" $W/fx.txt && pass "rollback: E, then G verifies the restored state, state = ROLLED_BACK" || { bad "fx rollback"; cat $W/fx.txt; }
RF $M linoe_member $PW_MEM apply && bad "apply ran after rollback" || { grep -q "state is ROLLED_BACK" $W/fx.txt && pass "re-apply refused after rollback (ledger row = stale-record guard)"; }
RF $M linoe_member $PW_MEM rollback && bad "rollback twice" || pass "rollback refused when not applied"
M=fx3; mkfx $M; S3=$(SNAPX $M); RF $M linoe_member $PW_MEM rollback && bad "rollback on PRE" || pass "rollback refused on a pre-apply database"

# 7d) applied by hand (SQL Editor style) but not recorded -> record-ledger
M=fx4; mkfx $M && P -d $M -f $MIGP >/dev/null
RF $M linoe_member $PW_MEM verify-only && grep -q "state: APPLIED_UNRECORDED" $W/fx.txt && grep -q "NEXT: run mode record-ledger" $W/fx.txt && pass "applied-not-recorded: verify-only runs C and points at record-ledger" || { bad "fx verify unrecorded"; cat $W/fx.txt; }
RF $M linoe_member $PW_MEM apply && bad "apply on applied db" || pass "apply refused on an applied-but-unrecorded database"
RF $M linoe_member $PW_MEM record-ledger && grep -q "PASS ledger row" $W/fx.txt && grep -q "RESULT: PASS" $W/fx.txt && pass "record-ledger: C, D, ledger check, F" || { bad "fx record-ledger"; cat $W/fx.txt; }
# ledger verification against the manifest: tampered statements, duplicate name
LV() { PA -d $M -F, -f /dev/stdin -v ver=20990101000000 -v nm=fixture_native_txn -v sha=$(sha256sum $MIGP | cut -d' ' -f1) <$PK/tools/ledger_verify_readonly.sql; }
[ "$(LV)" = "1,1,t,t" ] && pass "ledger verify: one row, name and migration SHA-256 match the manifest" || bad "ledger verify baseline: $(LV)"
P -d $M -c "update supabase_migrations.schema_migrations set statements = array['x'] where version='20990101000000'" >/dev/null
[ "$(LV)" = "1,1,t,f" ] && pass "ledger verify: a row whose statements do not carry the manifest SHA-256 is detected" || bad "ledger sha tamper: $(LV)"
P -d $M -c "insert into supabase_migrations.schema_migrations(version,name) values ('20990101000001','fixture_native_txn')" >/dev/null
[ "$(LV | cut -d, -f2)" = 2 ] && pass "ledger verify: a duplicate name is detected" || bad "ledger dup"

# 7e) R1: a login with NO privileges (not owner, not member). Probes report BLOCK, apply is refused BEFORE any write, nothing escalates
M=fx5; mkfx $M && P -d $M -f $FXD/grant_migrator_reads.sql >/dev/null; S5=$(SNAPX $M)
RF $M linoe_migrator $PW_MIG verify-only && bad "verify-only passed for a role with no privileges" || { grep -q "BLOCK" $W/fx.txt && grep -q "refused before any write" $W/fx.txt && pass "R1: verify-only reports BLOCK probes and STOPs (no privilege escalation attempted)"; }
RF $M linoe_migrator $PW_MIG apply && bad "apply ran for a role with no privileges" || { grep -q "refused before any write" $W/fx.txt && ! grep -q "PASS B apply" $W/fx.txt && pass "R1: apply is cancelled at the probe gate, B never ran"; }
RF $M linoe_migrator $PW_MIG owner-audit && grep -q "HOLD: privilege probes are not all PASS" $W/fx.txt && pass "R1: owner-audit reports HOLD (report only, exit 0)" || { bad "fx owner-audit R1"; cat $W/fx.txt; }
grep -q "tbl1.owner: BLOCK\|owner: BLOCK" $W/fx.txt && pass "per-probe status lines carry no object names" || bad "probe lines"
[ "$S5" = "$(SNAPX $M)" ] && pass "R1: catalog identical after the refused runs" || bad "R1 changed the catalog"
# even with the probe gate bypassed (B fed straight to psql, like a manual SQL Editor paste): the transaction fails whole, nothing changes
PGUSER=linoe_migrator PGPASSWORD=$PW_MIG PS -v ON_ERROR_STOP=1 -d $M -f $MIGP >$W/b.txt 2>&1 && bad "B ran for a role with no privileges" || pass "bypass: B as the unprivileged role fails (42501)"
grep -q "42501\|must be owner\|permission denied" $W/b.txt && pass "bypass failure is a privilege error" || bad "bypass error kind"
[ "$S5" = "$(SNAPX $M)" ] && pass "bypass: the failed B left the catalog byte-identical (atomic)" || bad "bypass changed the catalog"
# no-select variant: preflight A itself is refused (privilege error), still no write
M=fx6; mkfx $M; RF $M linoe_migrator $PW_MIG apply && bad "apply ran with no grants" || { grep -q "SQLSTATE 42501" $W/fx.txt && pass "R1 (no read rights): A stops with SQLSTATE 42501, no raw error text"; }

# 7f) atomic failure LATE in B (after policies were dropped/created): a function owned by someone else blocks CREATE OR REPLACE at the end
M=fx7; mkfx $M && P -d $M -c "create function public.fn_fx_evidence_purge(timestamptz) returns bigint language sql as 'select 1::bigint'" >/dev/null; S7=$(SNAPX $M)
RF $M linoe_member $PW_MEM apply && bad "late failure did not stop" || { grep -q "state after the failed B: PRE" $W/fx.txt && pass "late failure in B: STOP and the runner reports state PRE afterwards"; }
[ "$S7" = "$(SNAPX $M)" ] && pass "late failure in B: every earlier statement was rolled back (catalog identical)" || bad "late failure left partial state"

# 7g) lock_timeout: another session holds an exclusive lock on storage.objects -> STOP by timeout, no effect
M=fx8; mkfx $M; S8=$(SNAPX $M)
( PS -d $M -c "begin; lock table storage.objects in access exclusive mode; select pg_sleep(9); commit" >/dev/null 2>&1 ) & LK=$!; sleep 1.5
RF $M linoe_member $PW_MEM apply && bad "ran under a held lock" || { grep -q "SQLSTATE 55P03" $W/fx.txt && pass "lock_timeout: STOP with SQLSTATE 55P03 while another session holds the lock"; }
wait $LK; [ "$S8" = "$(SNAPX $M)" ] && pass "lock_timeout: no effect on the catalog" || bad "lock timeout changed the catalog"

# 7h) drift / UNKNOWN state: every mode STOPs, nothing runs
M=fx9; mkfx $M && P -d $M -c 'drop policy "FX tenant all" on storage.objects' >/dev/null; S9=$(SNAPX $M)
for md in verify-only apply record-ledger rollback; do RF $M linoe_member $PW_MEM $md && bad "$md ran in UNKNOWN" || { grep -q "UNKNOWN\|refused" $W/fx.txt && pass "$md STOPs in state UNKNOWN"; }; done
[ "$S9" = "$(SNAPX $M)" ] && pass "UNKNOWN state untouched" || bad "unknown state changed"

# 7i) "other products" canaries: guard raises with the canary NAME inside the message; the public log must not show it
M=fx10; mkfx $M && P -d $M -c "create policy \"CANARY_OTHER_POLICY_zq81\" on storage.objects for insert with check (bucket_id = 'fx-reserved-1')" >/dev/null 2>&1 || P -d $M -c "drop policy \"CANARY_OTHER_POLICY_zq81\" on storage.objects" -c "create policy \"CANARY_OTHER_POLICY_zq81\" on storage.objects for insert with check (bucket_id = 'fx-reserved-1')" >/dev/null
RF $M linoe_member $PW_MEM apply && bad "apply ran with another party's policy on a reserved bucket" || { grep -q "policy_pihak_lain_cadangan_harus_0" $W/fx.txt && pass "preflight STOPs on another party's policy that mentions a reserved bucket (count only)"; }
PGUSER=linoe_member PGPASSWORD=$PW_MEM PS -d $M -f $MIGP >$W/b.txt 2>&1; grep -q "CANARY_OTHER_POLICY_zq81" $W/b.txt && pass "(control) raw PostgreSQL error text DOES contain the canary name: the redaction below is what protects the log" || bad "control: canary not in raw error"
PGDATABASE=CANARY_db_zq81 PGUSER=linoe_member PGPASSWORD=$PW_MEM $RUN --package fx-n --manifest $FXM --root $root --mode verify-only --target rehearsal >$W/fx.txt 2>&1; cat $W/fx.txt >> $W/fxlogs.txt
grep -q "database not found" $W/fx.txt && ! grep -q "CANARY_db" $W/fx.txt && pass "connection error: reason only, the database name is not echoed" || bad "db name echoed"
grep -E "$CANARY_RE|CANARY_db|$PW_MEM|$PW_MIG" $W/fxlogs.txt >/dev/null && { bad "a canary name or password appears in the runner logs"; grep -nE "$CANARY_RE|CANARY_db|$PW_MEM|$PW_MIG" $W/fxlogs.txt | head -3; } || pass "$(wc -l < $W/fxlogs.txt) runner log lines over all scenarios: no policy/bucket/table/function name of another party, no password"
grep -E "storage\.(objects|buckets)|FX tenant|fx_audit|fx_evidence|fx-reserved" $W/fxlogs.txt >/dev/null && { bad "an object name appears in the runner logs"; grep -nE "storage\.(objects|buckets)|FX tenant|fx_audit|fx_evidence|fx-reserved" $W/fxlogs.txt | head -3; } || pass "the runner log carries no object names at all (counts, hashes and ok/fail only)"

# 7j) tamper: a statement outside the allow-list never reaches the database even when every checksum is regenerated
TD=$(mktemp -d); for d in supabase/prod-packages supabase/migrations supabase/rollback; do mkdir -p $TD/$d && cp -r $root/$d/. $TD/$d/; done
TF=$TD/$FXP/migration/20990101000000_fixture_native_txn.sql
python3 - "$TF" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
open(p, "w").write(s.replace("\ncommit;", '\ndrop policy if exists "CANARY_OTHER_POLICY_zq81" on storage.objects;\ncommit;'))
PY
python3 - "$TD" <<'PY'
import hashlib, json, sys
td = sys.argv[1]; p = td + "/supabase/prod-packages/tests/fixtures/manifest.json"; m = json.load(open(p)); k = m["packages"]["fx-n"]
for e in [k["migration"], k["rollback"]] + list(k["files"].values()): e["sha256"] = hashlib.sha256(open(td + "/" + e["path"], "rb").read()).hexdigest()
json.dump(m, open(p, "w"))
PY
M=fx11; mkfx $M; S11=$(SNAPX $M)
PGDATABASE=$M PGUSER=linoe_member PGPASSWORD=$PW_MEM $RUN --package fx-n --manifest $TD/supabase/prod-packages/tests/fixtures/manifest.json --root $TD --mode apply --target rehearsal >$W/fx.txt 2>&1 && bad "out-of-allow-list statement ran" || { grep -q "is not in the package allow-list" $W/fx.txt && pass "a regenerated-checksum package with a drop policy OUTSIDE the allow-list STOPs in static lint"; }
[ "$S11" = "$(SNAPX $M)" ] && pass "tampered package never reached the database" || bad "tamper changed db"

# 7k) production policy still refuses: privileged/unsafe logins and hosts (unit-tested; here the CLI path)
PGDATABASE=$M PGUSER=linoe_member PGPASSWORD=x PGHOST=localhost $RUN --package fx-n --manifest $FXM --root $root --mode apply --target production >$W/fx.txt 2>&1 && bad "production target accepted a rehearsal login" || { grep -q "FAIL connection" $W/fx.txt && pass "production target refuses the rehearsal login/host"; }

# =====================================================================================================================
# --- 8) QA independen #188: regresi (SANDBOX). Trik tokenizer, COMMIT dini, role NOINHERIT, nama ledger ganda, hasil kosong.
# =====================================================================================================================
TMPK() { # <path relatif di fx-n> <teks lama> <teks baru> -> $TDX = salinan paket fixture yang diubah, SEMUA checksum dibuat ulang (kasus terbaik penyerang)
  TDX=$(mktemp -d); for d in supabase/prod-packages supabase/migrations supabase/rollback; do mkdir -p $TDX/$d && cp -r $root/$d/. $TDX/$d/; done
  python3 - "$TDX" "$1" "$2" "$3" <<'PY'
import hashlib, json, sys
td, rel, old, new = sys.argv[1:5]
p = td + "/supabase/prod-packages/tests/fixtures/fx-n/" + rel; s = open(p).read(); assert old == "@ALL" or old in s, old; open(p, "w").write(new + "\n" if old == "@ALL" else s.replace(old, new, 1))
mp = td + "/supabase/prod-packages/tests/fixtures/manifest.json"; m = json.load(open(mp)); k = m["packages"]["fx-n"]
for e in [k["migration"], k["rollback"]] + list(k["files"].values()): e["sha256"] = hashlib.sha256(open(td + "/" + e["path"], "rb").read()).hexdigest()
json.dump(m, open(mp, "w"))
PY
}
RT() { # <db> <mode>: jalankan paket fixture hasil TMPK ($TDX) sebagai linoe_member
  PGDATABASE=$1 PGUSER=linoe_member PGPASSWORD=$PW_MEM $RUN --package fx-n --manifest $TDX/supabase/prod-packages/tests/fixtures/manifest.json --root $TDX --mode "$2" --target rehearsal --run-id fx-qa >$W/fx.txt 2>&1; local rc=$?
  cat $W/fx.txt >> $W/fxlogs.txt; return $rc; }
MIGREL=migration/20990101000000_fixture_native_txn.sql; DOWNREL=rollback/20990101000000_fixture_native_txn.down.sql
MARK=$W/pwned_marker

# 8a) KONTROL: psql MEMANG menjalankan \! setelah pembuka komentar palsu di dalam string (jadi serangannya nyata, bukan teori)
printf "select '/*';\n\\\\! touch %s\nselect '*/';\n" "$W/ctrl_marker" > $W/trick_ctrl.sql
P -d postgres -f $W/trick_ctrl.sql >/dev/null 2>&1; [ -e "$W/ctrl_marker" ] && pass "(kontrol) psql menjalankan meta-perintah \\! yang disembunyikan di balik '/*' dalam string (serangan QA nyata)" || bad "kontrol: marker tidak terbentuk"
M=fx12; mkfx $M; S12=$(SNAPX $M)
for t in "meta" "dollar" "qid" "dropcanary" "commit"; do
  case $t in
    meta)       TRK=$(printf "select '/*';\n\\\\! touch %s\nselect '*/';" "$MARK");;
    dollar)     TRK=$(printf 'select $$/*$$;\n\\\\! touch %s\nselect $$*/$$;' "$MARK");;
    qid)        TRK=$(printf 'select 1 as "/*";\n\\\\! touch %s\nselect 1 as "*/";' "$MARK");;
    dropcanary) TRK=$(printf "select '/*';\ndrop policy \"CANARY_OTHER_POLICY_zq81\" on storage.objects;\nselect '*/';");;
    commit)     TRK=$(printf "select '/*';\ncommit;\ncreate table public.fx_qa_outside_txn (a int);\nselect '*/';");;
  esac
  TMPK $MIGREL "
commit;" "
$TRK
commit;"
  RT $M apply && bad "8a trik $t: apply berjalan" || { grep -q "FAIL static" $W/fx.txt && ! grep -q "PASS B apply" $W/fx.txt && pass "QA trik '$t' (semua checksum dibuat ulang): STOP di lint statis, B tidak pernah jalan"; }
  [ ! -e "$MARK" ] && [ "$S12" = "$(SNAPX $M)" ] && pass "QA trik '$t': tidak ada meta-perintah dijalankan, katalog identik" || bad "QA trik $t menyentuh sistem/db"
done

# 8b) role NOINHERIT yang ANGGOTA role pemilik: MEMBER akan bilang PASS, tetapi haknya tidak diwarisi -> probe harus BLOCK
M=fx13; mkfx $M && P -d $M -c "do \$\$ begin if not exists (select 1 from pg_roles where rolname = 'linoe_noinh') then create role linoe_noinh login nosuperuser noinherit password 'rh_noinh_pw_6e9'; end if; end \$\$" -c "grant supabase_storage_admin, sb_owner to linoe_noinh" -c "grant usage on schema storage, supabase_migrations to linoe_noinh" -c "grant select on storage.objects, storage.buckets, public.fx_audit_logs, public.fx_evidence to linoe_noinh" -c "grant select, insert on supabase_migrations.schema_migrations to linoe_noinh" >/dev/null 2>&1; S13=$(SNAPX $M)
[ "$(PA -d $M -c "select pg_has_role('linoe_noinh', 'supabase_storage_admin', 'MEMBER')::text||pg_has_role('linoe_noinh', 'supabase_storage_admin', 'USAGE')::text")" = "truefalse" ] && pass "(kontrol) role NOINHERIT: MEMBER=true tetapi USAGE=false (hak tidak diwarisi)" || bad "kontrol NOINHERIT"
RF $M linoe_noinh rh_noinh_pw_6e9 apply && bad "apply berjalan untuk role NOINHERIT" || { grep -q "BLOCK" $W/fx.txt && grep -q "refused before any write" $W/fx.txt && ! grep -q "PASS B apply" $W/fx.txt && pass "probe pemilik memakai USAGE: role NOINHERIT = BLOCK, apply dibatalkan sebelum B"; }
[ "$S13" = "$(SNAPX $M)" ] && pass "role NOINHERIT: katalog identik" || bad "NOINHERIT mengubah katalog"

# 8c) nama ledger ganda (versi lain) -> D akan diam-diam tidak mencatat; cek awal menolak SEBELUM B
M=fx14; mkfx $M && P -d $M -c "insert into supabase_migrations.schema_migrations(version,name) values ('20990101000009','fixture_native_txn')" >/dev/null; S14=$(SNAPX $M)
RF $M linoe_member $PW_MEM apply && bad "apply berjalan dengan nama ledger ganda" || { grep -q "FAIL ledger pre-check" $W/fx.txt && ! grep -q "PASS B apply" $W/fx.txt && pass "nama migrasi sudah ada di ledger (versi lain): STOP di cek awal ledger, sebelum B"; }
[ "$S14" = "$(SNAPX $M)" ] && pass "nama ledger ganda: katalog identik" || bad "nama ganda mengubah katalog"

# 8d) hasil kosong / tanpa kolom _harus_ = GAGAL (bukan lolos)
M=fx15; mkfx $M; S15=$(SNAPX $M)
for f in A_preflight_readonly.sql; do
  TMPK $f "@ALL" "select 1 as hanya_info"
  RT $M apply && bad "$f tanpa kolom _harus_ lolos" || { grep -q "no _harus_\* expectation column" $W/fx.txt && ! grep -q "PASS B apply" $W/fx.txt && pass "hasil $f tanpa kolom _harus_ = GAGAL (bukan lolos kosong), STOP sebelum B"; }
done
python3 - $root <<'PY' && pass "evaluate(require_harus): hasil kosong atau tanpa _harus_ ditolak, hasil sah diterima" || bad "evaluate menerima hasil kosong"
import sys
sys.path.insert(0, sys.argv[1] + "/supabase/prod-packages/tools")
import run_package as rp
assert rp.evaluate([], [], require_harus=True)[0] and rp.evaluate(["ok_info"], ["1"], require_harus=True)[0]
assert not rp.evaluate(["a_harus_1"], ["1"], require_harus=True)[0]
PY
[ "$S15" = "$(SNAPX $M)" ] && pass "hasil kosong: katalog identik" || bad "hasil kosong mengubah katalog"

# 8e) gerbang read-only di sisi server: file A/C/F/S/G tidak bisa menulis walau lint dilewati
PGOPTIONS="-c default_transaction_read_only=on" PS -d $M -c "create table public.zz_ro(a int)" >/dev/null 2>&1 && bad "transaksi read-only menerima CREATE TABLE" || pass "default_transaction_read_only=on menolak tulis (lapisan kedua di luar lint)"

# 8f) pulih setelah rollback (docs: "Setelah rollback: cara pulih"): hapus baris ledger (oleh Founder, bukan runner) -> PRE -> apply lagi
M=fx16; mkfx $M; RF $M linoe_member $PW_MEM apply >/dev/null || bad "fx16 apply"; RF $M linoe_member $PW_MEM rollback >/dev/null || bad "fx16 rollback"
RF $M linoe_member $PW_MEM apply && bad "apply setelah rollback" || grep -q "state is ROLLED_BACK" $W/fx.txt || bad "fx16 bukan ROLLED_BACK"
P -d $M -c "delete from supabase_migrations.schema_migrations where version = '20990101000000'" >/dev/null
RF $M linoe_member $PW_MEM verify-only && grep -q "state: PRE" $W/fx.txt && pass "langkah pulih: setelah baris ledger dihapus (manual), verify-only = state PRE" || { bad "pulih: bukan PRE"; cat $W/fx.txt; }
RF $M linoe_member $PW_MEM apply && grep -q "RESULT: PASS" $W/fx.txt && pass "langkah pulih: apply ulang berhasil dan tercatat (DONE)" || { bad "pulih: apply ulang"; cat $W/fx.txt; }

# 9) structural controls proven on the same throw-away server (search_path, READ ONLY + snapshot, -c, effects before COMMIT)
python3 -B $PK/tests/rehearsal_structural.py > $W/struct.txt 2>&1; grep -E "^(PASS|FAIL)" $W/struct.txt
grep -q "^STRUCTURAL OK" $W/struct.txt || { bad "structural controls"; cat $W/struct.txt; }

# 10) differential fuzz with this server as the oracle (fixed seed; counts are printed): accepted statements must execute NO user function in the runner session
FUZZ_N=${FUZZ_N:-20000} python3 -B $PK/tests/fuzz_oracle.py > $W/fuzz.txt 2>&1; cat $W/fuzz.txt
grep -q "^FUZZ OK" $W/fuzz.txt && pass "fuzz oracle: 0 accepted statements executed a user function in the runner session (seed and counts above)" || bad "fuzz oracle"

echo "EXIT fail=$fail"; [ $fail = 0 ] && echo "ALL PASSED"; exit $fail
