#!/usr/bin/env bash
# LOCAL-ONLY LINOE P0-2 (invoice / payment receipt) tests on a THROW-AWAY PostgreSQL with SYNTHETIC data. Never touches Supabase.
# Refuses non-local hosts and any credential env var. REQUIRE_PG_MAJOR=17 (set in CI) refuses any other major.
# Chain under test: B10 txn table + fn_apply v1 -> #74 -> B1 -> carryover -> B2 -> (real webhook-events table, real audit
# policies, Supabase default grants, REAL prompter_invoices table) -> P0-2.
# Proves: one PAID invoice per verified transaction (sequential, repeated and PARALLEL webhooks), the period equals the final
# subscription end after the carryover trigger, wrong amount / late payment / plan conflict / partial failures leave no invoice
# and no half-applied state, tenant isolation, client write lockout, tenant deletion still cascades, the pre-flight guard
# refuses a drifted function, B2 scenarios still pass on top of P0-2, B4 still applies on top of P0-2, and a fail-closed rollback.
set -uo pipefail
HOST="${PGHOST:-/tmp}"; PORT="${PGPORT:-5544}"; USER_="${PGUSER:-postgres}"
case "$HOST" in /*|localhost|127.0.0.1|::1) ;; *) echo "REFUSED: non-local PGHOST=$HOST" >&2; exit 2;; esac
for k in SUPABASE_SECRET_KEY SUPABASE_SERVICE_ROLE_KEY DATABASE_URL POSTGRES_URL TOKEN_ENCRYPTION_KEY; do
  if [ -n "${!k:-}" ]; then echo "REFUSED: $k is set" >&2; exit 2; fi
done
case "${PGDATABASE:-}" in *supabase*|*prod*) echo "REFUSED: PGDATABASE looks like a shared database" >&2; exit 2;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../../.." && pwd)"; b2s="$root/supabase/tests/b2-double-payment"
MIG="$root/supabase/migrations"
M74="$MIG/20261029220000_prompter_p0_subscription_plan_tampering_lockdown.sql"
M1="$MIG/20261030100000_prompter_b1_server_only_checkout.sql"
M1b="$MIG/20261030100100_prompter_b1_trial_remainder_carryover.sql"
M2="$MIG/20261030140000_prompter_b2_double_payment_safety.sql"
M4="$MIG/20261031100000_prompter_b4_payment_alerts.sql"
MINV="$MIG/20260901130513_prompter_billing_invoices.sql"
MP="$MIG/20261103170000_prompter_p0_2_payment_invoices.sql"
DP="$root/supabase/rollback/20261103170000_prompter_p0_2_payment_invoices.down.sql"
export PGOPTIONS="-c client_min_messages=warning"
export PGHOST="$HOST" PGPORT="$PORT" PGUSER="$USER_"  # the embedded python helpers call psql and read the same connection settings
PS() { psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q "$@"; }
P() { PS -v ON_ERROR_STOP=1 "$@"; }
PA() { PS -At "$@"; }
W="$(mktemp -d)"; fail=0; pass() { echo "PASS: $*"; }; bad() { echo "FAIL: $*"; fail=1; }
SRV=$(PA -d postgres -c "show server_version_num")
if [ -n "${REQUIRE_PG_MAJOR:-}" ]; then
  [ $((SRV/10000)) = "$REQUIRE_PG_MAJOR" ] || { echo "REFUSED: server_version_num=$SRV is not PostgreSQL $REQUIRE_PG_MAJOR" >&2; exit 2; }
  echo "PostgreSQL major $REQUIRE_PG_MAJOR confirmed (server_version_num=$SRV)"
fi

# real B10 table + fn_apply v1 + lifecycle sweeps (same extraction as the B2 suite), then the REAL webhook-events table and the REAL audit policies
python3 - "$root" "$W/real_b10.sql" "$W/real_webhook_audit.sql" <<'PY'
import re, sys
root, out, out2 = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(f"{root}/supabase/migrations/20260915051359_prompter_b10_payment_billing_core.sql").read()
a = s.index("create table if not exists public.prompter_payment_transactions")
endmark = "and paid_at is null\n  );"
b = s.index(endmark, s.index('create policy "Buat payment transaction tenant sendiri"')) + len(endmark)
parts = [s[a:b]]
n = "fn_apply_verified_payment"
m = re.search(r"create or replace function public\." + n + r"\(.*?\n\$\$;", s, re.S); assert m
parts.append(m.group(0))
parts += re.findall(r"^(?:revoke|grant)[^;]*function public\." + n + r"\([^;]*;", s, re.M)
l = open(f"{root}/supabase/migrations/20260926113000_prompter_payment_lifecycle_remediation.sql").read()
for fn in ("fn_apply_expired_subscriptions", "fn_expire_stale_payment_transactions"):
    mm = re.search(r"create or replace function public\." + fn + r"\(\).*?\n\$\$;", l, re.S); assert mm
    parts.append(mm.group(0))
open(out, "w").write("\n".join(parts) + "\n")
p4 = open(f"{root}/supabase/migrations/20260829104743_prompter_phase4_schema.sql").read()
wa = p4.index("create table if not exists public.prompter_webhook_events")
wb = p4.index('using (tenant_id = public.fn_current_tenant_id());', p4.index('create policy "Lihat webhook event tenant sendiri"')) + len('using (tenant_id = public.fn_current_tenant_id());')
f = open(f"{root}/supabase/migrations/20260829080127_prompter_foundation_schema.sql").read()
fa = f.index("alter table public.prompter_audit_logs enable row level security;")
fb = f.index("actor_user_id = auth.uid())\n  );", fa) + len("actor_user_id = auth.uid())\n  );")
open(out2, "w").write(p4[wa:wb] + "\n" + f[fa:fb] + "\n")
PY
[ -s "$W/real_b10.sql" ] && [ -s "$W/real_webhook_audit.sql" ] && pass "real B10 table, webhook-events table and audit policies extracted from the repository" || bad "extraction failed"
# Supabase grants ALL on NEW public objects to anon / authenticated / service_role by default; reproduce that BEFORE the real invoices table is created.
# (No blanket 'grant all on all tables': that would undo the B1 revokes on prompter_payment_transactions and is not what production has.)
cat > "$W/default_privs.sql" <<'SQL'
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
SQL

# chain up to and including B2, with the REAL invoices table (+ the global-edition billing_country column), without P0-2
mk() { P -d postgres -c "drop database if exists $1" -c "create database $1" >/dev/null \
  && P -d "$1" -f "$here/../s1-trial-quota/support/prod_snapshot.sql" >/dev/null \
  && P -d "$1" -f "$b2s/support/audit_stub.sql" >/dev/null && P -d "$1" -f "$W/real_b10.sql" >/dev/null \
  && P -d "$1" -f "$b2s/support/seed.sql" >/dev/null && P -1 -d "$1" -f "$M74" >/dev/null \
  && P -1 -d "$1" -f "$M1" >/dev/null && P -1 -d "$1" -f "$M1b" >/dev/null && P -1 -d "$1" -f "$M2" >/dev/null \
  && P -d "$1" -f "$W/real_webhook_audit.sql" >/dev/null && P -d "$1" -f "$W/default_privs.sql" >/dev/null \
  && P -d "$1" -f "$MINV" >/dev/null && P -d "$1" -c "alter table public.prompter_invoices add column if not exists billing_country text" >/dev/null; }
mp() { P -1 -d "$1" -f "$MP" >/dev/null; }
INVS="select md5(coalesce(string_agg(t::text,'|' order by id),'')) from prompter_invoices t"
LEG="select md5(coalesce(string_agg(t::text,'|' order by id),'')) from prompter_payment_transactions t"
SUBS="select md5(coalesce(string_agg(t::text,'|' order by tenant_id),'')) from prompter_subscriptions t"
SVC() { PA -d "$1" -c "set role service_role; $2" 2>&1 | grep -v '^SET$' | tail -1; }
conc_setup() { # <db> <tenant-suffix>
  local T="00000000-0000-0000-0000-00000f04$2"
  PA -d "$1" -c "insert into tenants(id,nama_usaha) values ('$T','C$2')" -c "insert into user_profiles values ('$T','$T','o','owner')" -c "insert into prompter_subscriptions(tenant_id,plan,status,current_period_start,current_period_end) values ('$T','FREE','TRIALING',now()-interval '1 day',now()+interval '13 days')" >/dev/null
  echo "$T"; }

# 0) the real invoices table is unchanged by the chain (guard against a stale harness)
mk p02_main || bad "mk p02_main"
[ "$(PA -d p02_main -c "select count(*) from information_schema.columns where table_name='prompter_invoices' and column_name='transaction_id'")" = 0 ] && pass "pre-P0-2 state: prompter_invoices has no transaction_id" || bad "unexpected pre-state"
[ "$(PA -d p02_main -c "select has_table_privilege('authenticated','public.prompter_invoices','insert')")" = t ] && pass "pre-P0-2 state reproduces the Supabase default grants (authenticated can INSERT at SQL level; only RLS blocks it)" || bad "default grants not reproduced"
I0=$(PA -d p02_main -c "$INVS"); L0=$(PA -d p02_main -c "$LEG"); S0=$(PA -d p02_main -c "$SUBS")

# 1) apply P0-2: one transaction, re-appliable, existing rows untouched, no backfill
mp p02_main && pass "P0-2 migration applies in one transaction" || bad "P0-2 migration failed"
mp p02_main && pass "P0-2 migration re-applies cleanly (idempotent; guard accepts the v3 body)" || bad "P0-2 re-apply failed"
[ "$I0" = "$(PA -d p02_main -c "$INVS")" ] && [ "$L0" = "$(PA -d p02_main -c "$LEG")" ] && [ "$S0" = "$(PA -d p02_main -c "$SUBS")" ] && pass "invoices, transactions and subscriptions byte-identical after P0-2 (no backfill, no rewrite)" || bad "P0-2 modified existing rows"
[ "$(PA -d p02_main -c "select count(*) from prompter_invoices")" = 0 ] && pass "no invoice was fabricated by the migration" || bad "invoices appeared"
[ "$(PA -d p02_main -c "select has_table_privilege('authenticated','public.prompter_invoices','insert') or has_table_privilege('authenticated','public.prompter_invoices','update') or has_table_privilege('authenticated','public.prompter_invoices','delete') or has_table_privilege('authenticated','public.prompter_invoices','truncate') or has_table_privilege('anon','public.prompter_invoices','insert')")" = f ] && pass "client write privileges on prompter_invoices revoked" || bad "client write privileges remain"
# the function signature / return shape / security attributes are unchanged
[ "$(PA -d p02_main -c "select prosecdef and proconfig::text like '%search_path=public%' from pg_proc where proname='fn_apply_verified_payment'")" = t ] && pass "fn_apply_verified_payment is still SECURITY DEFINER with search_path=public" || bad "function attributes changed"
[ "$(PA -d p02_main -c "select pg_get_function_result(oid) from pg_proc where proname='fn_apply_verified_payment'")" = 'TABLE(allowed boolean, reason text)' ] && pass "return shape unchanged (allowed boolean, reason text)" || bad "return shape changed"

# 2) sequential scenarios
if (cd "$here" && PGOPTIONS="-c client_min_messages=notice" P -d p02_main -f scenarios.sql >"$W/o.txt" 2>&1); then pass "P0-2 sequential scenarios: $(grep -c 'PASS:' "$W/o.txt") checks"; else bad "P0-2 sequential scenarios"; grep -E "FAIL|ERROR" "$W/o.txt" | head -8; fi

# 3) pre-flight guard: a drifted function body is never overwritten, and the abort leaves no trace
mk p02_drift || bad "mk p02_drift"
PA -d p02_drift -c "create or replace function public.fn_apply_verified_payment(p_transaction_id uuid, p_provider_payment_id text, p_provider_event_id text, p_verified_amount numeric, p_verified_currency text) returns table(allowed boolean, reason text) language plpgsql security definer set search_path = public as \$f\$ begin return query select true, null::text; end \$f\$" >/dev/null
if PS -d p02_drift -v ON_ERROR_STOP=1 -1 -f "$MP" >"$W/g.txt" 2>&1; then bad "migration ran over a drifted function"; else grep -q "DIBATALKAN: badan fn_apply_verified_payment" "$W/g.txt" && pass "guard aborts on a drifted fn_apply_verified_payment body" || bad "guard failed for another reason"; fi
[ "$(PA -d p02_drift -c "select count(*) from information_schema.columns where table_name='prompter_invoices' and column_name='transaction_id'")" = 0 ] && pass "the aborted migration left no column, index or privilege change" || bad "aborted migration left traces"
mk p02_nob2 || bad "mk p02_nob2"; PA -d p02_nob2 -c "drop function public.fn_resolve_review_payment(uuid,numeric,text,text,text)" >/dev/null
if PS -d p02_nob2 -v ON_ERROR_STOP=1 -1 -f "$MP" >"$W/g.txt" 2>&1; then bad "migration ran without B2"; else grep -q "DIBATALKAN" "$W/g.txt" && pass "guard aborts when B2 is not in place" || bad "guard (no B2) failed for another reason"; fi
# whitespace-only differences in the stored function body (e.g. CRLF from a pasted SQL editor script) are tolerated
mk p02_crlf || bad "mk p02_crlf"
python3 - "$W" "$MP" <<'PY'
import re, sys, subprocess
w, mp = sys.argv[1], sys.argv[2]
src = subprocess.check_output(["psql","-X","-d","p02_crlf","-At","-c","select prosrc from pg_proc where proname='fn_apply_verified_payment'"]).decode()
crlf = src.replace("\n", "\r\n")
sql = ("create or replace function public.fn_apply_verified_payment(p_transaction_id uuid, p_provider_payment_id text, p_provider_event_id text, p_verified_amount numeric, p_verified_currency text) returns table(allowed boolean, reason text) language plpgsql security definer set search_path = public as $zz$" + crlf + "$zz$;")
open(f"{w}/crlf.sql","w",newline="").write(sql)
PY
P -d p02_crlf -f "$W/crlf.sql" >/dev/null 2>&1 && mp p02_crlf && pass "guard tolerates whitespace / CRLF differences in the stored body" || bad "guard rejected a whitespace-only difference"

# 4) concurrency (separate DB)
mk p02_conc && mp p02_conc || bad "mk p02_conc"
# C. one webhook delivered 10x at once -> one applied, one invoice
T=$(conc_setup p02_conc 0001); ID=$(SVC p02_conc "select out_transaction_id from public.fn_begin_checkout('$T','$T','STARTER','midtrans')"); rm -f "$W"/c_*
for i in $(seq 1 10); do ( SVC p02_conc "select allowed::text||':'||coalesce(reason,'') from public.fn_apply_verified_payment('$ID','pay_c','evt_c',99000,'IDR')" > "$W/c_$i" ) & done; wait
a1=$(cat "$W"/c_* | grep -c '^true:$'); a9=$(cat "$W"/c_* | grep -c 'ALREADY_PROCESSED')
[ "$a1" = 1 ] && [ "$a9" = 9 ] && [ "$(PA -d p02_conc -c "select count(*) from prompter_invoices where transaction_id='$ID'")" = 1 ] \
  && [ "$(PA -d p02_conc -c "select count(*) from prompter_invoices where tenant_id='$T'")" = 1 ] \
  && [ "$(PA -d p02_conc -c "select (select period_end from prompter_invoices where transaction_id='$ID') = current_period_end and current_period_end between now()+interval '1 month'+interval '12 days 23 hours' and now()+interval '1 month'+interval '13 days 1 hour' from prompter_subscriptions where tenant_id='$T'")" = t ] \
  && pass "C: 10 parallel identical webhooks -> 1 applied + 9 ALREADY_PROCESSED, exactly 1 invoice, period = final subscription end" || bad "C parallel webhooks (applied=$a1 already=$a9 invoices=$(PA -d p02_conc -c "select count(*) from prompter_invoices where tenant_id='$T'"))"
# C2. 40 deliveries across 8 tenants at once (5 each) -> exactly 8 invoices, one per tenant
rm -f "$W"/m_*; declare_ids=""
for k in 1 2 3 4 5 6 7 8; do T=$(conc_setup p02_conc "010$k"); IDk=$(SVC p02_conc "select out_transaction_id from public.fn_begin_checkout('$T','$T','STARTER','midtrans')"); declare_ids="$declare_ids $IDk"
  for i in 1 2 3 4 5; do ( SVC p02_conc "select allowed::text||':'||coalesce(reason,'') from public.fn_apply_verified_payment('$IDk','pay_m$k','evt_m$k',99000,'IDR')" > "$W/m_${k}_$i" ) & done; done; wait
okm=$(cat "$W"/m_* | grep -c '^true:$'); alm=$(cat "$W"/m_* | grep -c 'ALREADY_PROCESSED')
[ "$okm" = 8 ] && [ "$alm" = 32 ] && [ "$(PA -d p02_conc -c "select count(*) from prompter_invoices where tenant_id::text like '00000000-0000-0000-0000-00000f04010%'")" = 8 ] \
  && [ "$(PA -d p02_conc -c "select count(distinct transaction_id) from prompter_invoices where tenant_id::text like '00000000-0000-0000-0000-00000f04010%'")" = 8 ] \
  && pass "C2: 40 parallel deliveries across 8 tenants -> 8 applied + 32 ALREADY_PROCESSED, exactly 8 invoices (one per transaction)" || bad "C2 multi-tenant parallel (applied=$okm already=$alm)"
# D1. 6 different invoices of one tenant paid at once (1 current PENDING + 5 superseded): 1 activates + 1 invoice, the other 5 go to REVIEW with no invoice
T=$(conc_setup p02_conc 0004); ids=""; for pl in STARTER GROWTH STARTER GROWTH STARTER GROWTH; do ids="$ids $(SVC p02_conc "select out_transaction_id from public.fn_begin_checkout('$T','$T','$pl','midtrans')")"; done
rm -f "$W"/d_*; n=0; for id in $ids; do n=$((n+1)); ( SVC p02_conc "select allowed::text||':'||coalesce(reason,'') from public.fn_apply_verified_payment('$id','pay_d$n','evt_d$n',case when '$id' = (select id::text from prompter_payment_transactions where id='$id' and plan='GROWTH') then 199000 else 99000 end,'IDR')" > "$W/d_$n" ) & done; wait
paid=$(PA -d p02_conc -c "select count(*) from prompter_payment_transactions where tenant_id='$T' and status='PAID'"); rev=$(PA -d p02_conc -c "select count(*) from prompter_payment_transactions where tenant_id='$T' and status='REVIEW'")
[ "$paid" = 1 ] && [ "$rev" = 5 ] && [ "$(PA -d p02_conc -c "select count(*) from prompter_invoices where tenant_id='$T'")" = 1 ] \
  && [ "$(PA -d p02_conc -c "select count(*) from prompter_invoices i join prompter_payment_transactions x on x.id=i.transaction_id where i.tenant_id='$T' and x.status='PAID'")" = 1 ] \
  && pass "D: 6 different invoices paid at the same instant -> 1 PAID + 1 invoice, 5 REVIEW with no invoice" || bad "D parallel different invoices (paid=$paid review=$rev)"
# D2. legacy tenant with several PENDING rows (index dropped, as in B2's defence-in-depth test): all pay concurrently -> one invoice each, contiguous periods
mk p02_leg && mp p02_leg || bad "mk p02_leg"
PA -d p02_leg -c "drop index public.uq_prompter_payment_txn_one_pending_per_tenant" >/dev/null
T=$(conc_setup p02_leg 0005); ids=""; for i in 1 2 3 4 5 6; do ids="$ids $(PA -d p02_leg -c "insert into prompter_payment_transactions(tenant_id,user_id,provider,plan,amount,currency) values ('$T','$T','midtrans','STARTER',99000,'IDR') returning id" | head -1)"; done
rm -f "$W"/e_*; n=0; for id in $ids; do n=$((n+1)); ( SVC p02_leg "select allowed::text||':'||coalesce(reason,'') from public.fn_apply_verified_payment('$id','pay_e$n','evt_e$n',99000,'IDR')" > "$W/e_$n" ) & done; wait
okc=$(cat "$W"/e_* | grep -c '^true:$')
[ "$okc" = 6 ] && [ "$(PA -d p02_leg -c "select count(*) from prompter_invoices where tenant_id='$T'")" = 6 ] && [ "$(PA -d p02_leg -c "select count(distinct transaction_id) from prompter_invoices where tenant_id='$T'")" = 6 ] \
  && [ "$(PA -d p02_leg -c "select count(*) from (select period_start, lag(period_end) over (order by period_start) pe from prompter_invoices where tenant_id='$T') x where pe is not null and period_start <> pe")" = 0 ] \
  && [ "$(PA -d p02_leg -c "select max(i.period_end) = s.current_period_end from prompter_invoices i join prompter_subscriptions s using (tenant_id) where i.tenant_id='$T' group by s.current_period_end")" = t ] \
  && pass "D2: 6 legacy PENDING invoices paid concurrently -> 6 invoices (one per transaction), periods contiguous, last end = subscription end" || bad "D2 legacy stacking (applied=$okc)"

# 5) composition: B2 scenarios (B2's own suite) still pass on top of P0-2; B4 applies on top of P0-2, in either order
mk p02_reg && mp p02_reg || bad "mk p02_reg"
if (cd "$b2s" && PGOPTIONS="-c client_min_messages=notice" P -d p02_reg -f scenarios.sql >"$W/o2.txt" 2>&1); then pass "B2 regression: all $(grep -c 'PASS:' "$W/o2.txt") B2 scenario checks pass on top of P0-2"; else bad "B2 scenarios fail on top of P0-2"; grep -E "FAIL|ERROR" "$W/o2.txt" | head -6; fi
mk p02_b4a && mp p02_b4a && P -1 -d p02_b4a -f "$M4" >/dev/null && pass "B4 applies on top of P0-2" || bad "B4 on top of P0-2"
mk p02_b4b && P -1 -d p02_b4b -f "$M4" >/dev/null && mp p02_b4b && pass "P0-2 applies on top of B4" || bad "P0-2 on top of B4"
if (cd "$here" && PGOPTIONS="-c client_min_messages=notice" P -d p02_b4b -f scenarios.sql >"$W/o3.txt" 2>&1); then pass "P0-2 scenarios also pass with B4 present: $(grep -c 'PASS:' "$W/o3.txt") checks"; else bad "P0-2 scenarios with B4 present"; grep -E "FAIL|ERROR" "$W/o3.txt" | head -6; fi

# 6) rollback: refuses while linked invoices exist; otherwise restores the B2 function and removes the link
if PS -d p02_main -v ON_ERROR_STOP=1 -f "$DP" >"$W/rb.txt" 2>&1; then bad "rollback ran while linked invoices exist"; else grep -q "rollback refused" "$W/rb.txt" && pass "rollback refuses while invoices are linked to transactions (no proof of payment can be lost)" || bad "rollback failed for another reason"; fi
[ "$(PA -d p02_main -c "select count(*) from prompter_invoices where transaction_id is not null")" -ge 1 ] && pass "...and it changed nothing (linked invoices intact)" || bad "rollback attempt altered invoices"
mk p02_rb && mp p02_rb || bad "mk p02_rb"
if P -d p02_rb -f "$DP" >/dev/null 2>&1; then pass "rollback applies when no linked invoice exists"; else bad "rollback failed"; fi
[ "$(PA -d p02_rb -c "select count(*) from information_schema.columns where table_name='prompter_invoices' and column_name='transaction_id'")" = 0 ] && [ "$(PA -d p02_rb -c "select count(*) from pg_indexes where indexname='uq_prompter_invoices_transaction'")" = 0 ] && pass "rollback removed the column and the unique index" || bad "rollback left P0-2 objects"
python3 - "$W" "$MIG" <<'PY'
import re, hashlib, subprocess, sys
w, mig = sys.argv[1:3]
src = subprocess.check_output(["psql","-X","-d","p02_rb","-At","-c","select prosrc from pg_proc where proname='fn_apply_verified_payment'"]).decode().rstrip("\n")
b2 = open(f"{mig}/20261030140000_prompter_b2_double_payment_safety.sql").read()
m = re.search(r"create or replace function public\.fn_apply_verified_payment\(.*?\n\$\$;", b2, re.S).group(0)
body = m[m.index("as $$")+5: m.rindex("$$;")]
n = lambda s: re.sub(r"\s+", "", s)
open(f"{w}/rb_same.txt","w").write("same" if n(src) == n(body) else "differs")
PY
[ "$(cat "$W/rb_same.txt")" = same ] && pass "rollback restored the exact B2 v2 function body" || bad "rollback did not restore the B2 body"
[ "$(PA -d p02_rb -c "select has_function_privilege('authenticated','public.fn_apply_verified_payment(uuid,text,text,numeric,text)','execute') or has_function_privilege('anon','public.fn_apply_verified_payment(uuid,text,text,numeric,text)','execute')")" = f ] && pass "rollback keeps the function service_role-only" || bad "rollback grants"
mp p02_rb && pass "P0-2 re-applies after a rollback" || bad "re-apply after rollback"
[ "$(grep -cE '^[[:space:]]*\\' "$DP")" = 0 ] && [ "$(grep -cE '^[[:space:]]*\\' "$MP")" = 0 ] && pass "migration and rollback are plain SQL (no psql meta-commands)" || bad "meta-commands found"
[ "$(sed 's/--.*$//' "$MP" | grep -ciE 'supabase_migrations|schema_migrations|pg_cron|cron\.|alter (system|role)|create role|drop table|drop schema|umkmpro|publoe|mitapeng')" = 0 ] && pass "migration touches no ledger, cron, role, table drop or other product" || bad "forbidden token in migration"
[ "$fail" = 0 ] && echo "ALL PASSED" || { echo "SOME FAILED"; exit 1; }
