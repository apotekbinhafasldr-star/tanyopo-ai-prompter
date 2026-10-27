#!/usr/bin/env bash
# LOCAL/CI-ONLY integration test of the four LINOE finance migrations (100000, 110000, 120000, 130000), applied in order on a
# THROW-AWAY PostgreSQL with SYNTHETIC data. Never touches Supabase or any shared database.
set -uo pipefail
HOST="${PGHOST:-/tmp}"; PORT="${PGPORT:-5544}"; USER_="${PGUSER:-postgres}"
case "$HOST" in /*|localhost|127.0.0.1|::1) ;; *) echo "REFUSED: non-local PGHOST=$HOST" >&2; exit 2;; esac
for k in SUPABASE_SECRET_KEY SUPABASE_SERVICE_ROLE_KEY DATABASE_URL POSTGRES_URL TOKEN_ENCRYPTION_KEY; do
  if [ -n "${!k:-}" ]; then echo "REFUSED: $k is set" >&2; exit 2; fi
done
case "${PGDATABASE:-}" in *supabase*|*prod*) echo "REFUSED: PGDATABASE looks like a shared database" >&2; exit 2;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../../.." && pwd)"
MIGS="20261027100000_linoe_finance_foundation 20261027110000_linoe_admin_center_access 20261027120000_linoe_accounting_ledger 20261027130000_linoe_tax_optimization_approvals"
PS() { psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q "$@"; }
P() { PS -v ON_ERROR_STOP=1 "$@"; }
PA() { PS -At "$@"; }
fail=0; pass() { echo "PASS: $*"; }; bad() { echo "FAIL: $*"; fail=1; }
SRV=$(PA -d postgres -c "show server_version_num")
if [ -n "${REQUIRE_PG_MAJOR:-}" ]; then
  [ $((SRV/10000)) = "$REQUIRE_PG_MAJOR" ] || { echo "REFUSED: server_version_num=$SRV is not PostgreSQL $REQUIRE_PG_MAJOR" >&2; exit 2; }
  echo "PostgreSQL major $REQUIRE_PG_MAJOR confirmed (server_version_num=$SRV)"
fi
mk() { P -d postgres -c "drop database if exists $1" -c "create database $1" >/dev/null && P -d "$1" -f "$root/supabase/tests/tax-approvals/support.sql" >/dev/null; }
# Stand-ins for objects that already exist in a shared database (tenant data, PUBLOE and Apotek tables). They must come out unchanged.
legacy() { P -d "$1" >/dev/null <<'SQL'
create table public.tenants (id uuid primary key default gen_random_uuid(), name text not null);
create table public.subscriptions (id uuid primary key default gen_random_uuid(), tenant_id uuid references public.tenants(id), plan text);
create table public.publoe_posts (id uuid primary key default gen_random_uuid(), body text);
create table public.apotek_items (id uuid primary key default gen_random_uuid(), sku text);
alter table public.tenants enable row level security;
create policy tenants_own on public.tenants for select using (true);
grant select on public.tenants to authenticated;
insert into public.tenants (name) values ('Tenant sintetis');
create function public.fn_legacy() returns int language sql as 'select 1';
SQL
}
# Everything that is not part of the finance chain, serialised: tables, columns, constraints, indexes, triggers, policies, privileges, functions, row data.
snap() { PA -d "$1" <<'SQL' | md5sum | cut -d' ' -f1
select string_agg(x, E'\n' order by x) from (
  select ('col:' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '')) as x from information_schema.columns
    where table_schema = 'public' and table_name !~ '^(acct_|finance_|tax_opt_)'
  union all select 'con:' || conrelid::regclass || ':' || pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace and conrelid::regclass::text !~ '(acct_|finance_|tax_opt_)'
  union all select 'idx:' || indexdef from pg_indexes where schemaname = 'public' and tablename !~ '^(acct_|finance_|tax_opt_)'
  union all select 'trg:' || tgrelid::regclass || ':' || tgname from pg_trigger where not tgisinternal and tgrelid::regclass::text !~ '(acct_|finance_|tax_opt_)'
  union all select 'pol:' || tablename || ':' || policyname || ':' || coalesce(qual, '') from pg_policies where schemaname = 'public' and tablename !~ '^(acct_|finance_|tax_opt_)'
  union all select 'rls:' || relname || ':' || relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname !~ '^(acct_|finance_|tax_opt_)'
  union all select 'prv:' || table_name || ':' || grantee || ':' || privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name !~ '^(acct_|finance_|tax_opt_)'
  union all select 'fn:' || proname || ':' || md5(prosrc) from pg_proc where pronamespace = 'public'::regnamespace and proname !~ '^(fn_acct_|fn_finance_|fn_tax_opt_|tax_opt_)'
  union all select 'row:' || name from public.tenants
) s
SQL
}
apply() { for m in $MIGS; do P -d "$1" -f "$root/supabase/migrations/$m.sql" >/dev/null || return 1; done; }
undo()  { for m in $(echo $MIGS | tr ' ' '\n' | tac); do P -d "$1" -f "$root/supabase/rollback/$m.down.sql" >/dev/null || return 1; done; }

# 1) apply all four in order; legacy objects untouched; whole chain re-applies cleanly
mk chain_a; legacy chain_a; BEFORE=$(snap chain_a)
apply chain_a && pass "four migrations apply in order" || bad "ordered apply"
[ "$(snap chain_a)" = "$BEFORE" ] && pass "existing tenant, PUBLOE and Apotek stand-in objects are byte-identical after the chain" || bad "legacy objects changed"
# negative control: the snapshot really detects a change to a legacy object
P -d chain_a -c "alter table public.apotek_items add column zz int" >/dev/null; [ "$(snap chain_a)" != "$BEFORE" ] && pass "negative control: a change to a legacy table is detected" || bad "snapshot cannot detect changes"
P -d chain_a -c "alter table public.apotek_items drop column zz" >/dev/null
apply chain_a && pass "the whole chain re-applies cleanly (idempotent)" || bad "re-apply"

# 2) cross-module behaviour (journal integrity, access, RLS, grants, audit)
if P -d chain_a -f "$here/chain.sql" >/tmp/chain_tests_$$.txt 2>&1; then pass "chain suite: $(grep -c 'PASS:' /tmp/chain_tests_$$.txt) checks"
else bad "chain suite"; grep -E "FAILED|ERROR" /tmp/chain_tests_$$.txt | head -8; fi

# 2b) privileges. The migrations run on a database that carries Supabase-like DEFAULT PRIVILEGES (tax-approvals/support.sql), as in production,
#     where a bare CREATE TABLE is handed to anon, authenticated and service_role. A GRANT alone would then leave service_role with
#     DELETE/TRUNCATE/UPDATE; every object must be REVOKEd explicitly and granted only what it needs.
mk chain_p; apply chain_p
if P -d chain_p -f "$here/privileges.sql" >/tmp/chain_priv_$$.txt 2>&1; then pass "privilege suite: $(grep -c 'PASS:' /tmp/chain_priv_$$.txt) checks (anon, authenticated, PUBLIC, service_role on tables, sequences and functions; legitimate flows; append-only guards)"
else bad "privilege suite"; grep -E "FAILED|ERROR|open:|service_role can|cannot" /tmp/chain_priv_$$.txt | head -8; fi
if PA -d chain_p -f "$here/acl_matrix.sql" | diff -u "$here/acl_expected.txt" - >/tmp/chain_acl_$$.txt; then pass "privilege matrix of all 21 tables, 5 sequences and 15 functions equals the reviewed golden file ($(wc -l < "$here/acl_expected.txt") lines)"
else bad "privilege matrix differs from acl_expected.txt (review every line before updating the golden file)"; head -30 /tmp/chain_acl_$$.txt; fi
# negative controls: widening any one privilege must be noticed by BOTH the matrix and the behaviour suite
for stmt in "grant delete on public.finance_settlements to service_role" "grant truncate on public.acct_journals to service_role" \
            "grant update on sequence public.finance_audit_logs_id_seq to service_role" "grant execute on function public.fn_finance_audit() to anon" \
            "grant select on public.finance_audit_logs to authenticated" "grant insert on public.tax_opt_decisions to service_role"; do
  mk chain_n; apply chain_n; P -d chain_n -c "$stmt" >/dev/null
  if PA -d chain_n -f "$here/acl_matrix.sql" | diff -q "$here/acl_expected.txt" - >/dev/null; then bad "matrix did not notice: $stmt"; else pass "negative control: matrix detects '$stmt'"; fi
  if P -d chain_n -f "$here/privileges.sql" >/dev/null 2>&1; then bad "privilege suite did not notice: $stmt"; else pass "negative control: privilege suite fails on '$stmt'"; fi
done

# 3) approvals behaviour suite on top of the full chain (including the accounting migration)
mk chain_b; apply chain_b
if P -d chain_b -f "$root/supabase/tests/tax-approvals/tests.sql" >/tmp/chain_tax_$$.txt 2>&1; then pass "approvals suite on the full chain: $(grep -c 'PASS:' /tmp/chain_tax_$$.txt) checks"
else bad "approvals suite on full chain"; grep -E "FAILED|ERROR" /tmp/chain_tax_$$.txt | head -5; fi

# 4) rollback in reverse order restores the starting state; data blocks the rollback
mk chain_c; legacy chain_c; START=$(snap chain_c); apply chain_c
undo chain_c && pass "rollback runs in reverse order on an empty chain" || bad "reverse rollback"
[ "$(snap chain_c)" = "$START" ] && pass "after rollback the database equals its starting state" || bad "state differs after rollback"
LEFT=$(PA -d chain_c -c "select count(*) from pg_class where relnamespace='public'::regnamespace and relname ~ '^(acct_|finance_|tax_opt_)'")
[ "$LEFT" = "0" ] && pass "no finance, accounting or approval object remains after rollback" || bad "$LEFT objects remain"
apply chain_c && pass "the chain can be applied again after a rollback" || bad "apply after rollback"
P -d chain_c -c "insert into auth.users (id) values ('11111111-1111-4111-8111-111111111111')" -c "insert into public.acct_period_events (period_key,action,actor_id) values ('2026-09','CLOSE','11111111-1111-4111-8111-111111111111')" >/dev/null
if P -d chain_c -f "$root/supabase/rollback/20261027120000_linoe_accounting_ledger.down.sql" >/dev/null 2>&1; then bad "accounting rollback ran although data exists"; else pass "accounting rollback refuses while data exists"; fi

for d in chain_a chain_b chain_c chain_p chain_n; do P -d postgres -c "drop database if exists $d" >/dev/null; done
[ "$fail" = 0 ] && echo "ALL FINANCE CHAIN CHECKS PASSED" || { echo "SOME CHECKS FAILED"; exit 1; }
