#!/usr/bin/env bash
# LOCAL-ONLY tes 4r (retention vault, Opsi A) pada PostgreSQL SEMENTARA dengan data SINTETIS. Tidak pernah menyentuh Supabase.
# Menolak host non-lokal dan env kredensial apa pun. REQUIRE_PG_MAJOR=16|17 (CI) menolak major lain.
# SQL yang diuji: migrasi + rollback ASLI dari repositori. Tabel billing = rantai migrasi ASLI repo (B10 -> #74 -> B1 -> carryover -> B2 -> invoices -> P0-2)
# lewat ekstraksi yang sama dengan suite p0-2-invoices; skema Supabase (auth, tenants, role) adalah STUB: bukti kelas SANDBOX, bukan REAL.
# Tabel billing dimiliki peran non-superuser (mig4r) dan migrasi dijalankan sebagai peran itu, seperti pola produksi (pemilik tabel bukan superuser).
set -uo pipefail
HOST="${PGHOST:-/tmp}"; PORT="${PGPORT:-5544}"; USER_="${PGUSER:-postgres}"
case "$HOST" in /*|localhost|127.0.0.1|::1) ;; *) echo "REFUSED: non-local PGHOST=$HOST" >&2; exit 2;; esac
for k in SUPABASE_SECRET_KEY SUPABASE_SERVICE_ROLE_KEY DATABASE_URL POSTGRES_URL TOKEN_ENCRYPTION_KEY; do
  if [ -n "${!k:-}" ]; then echo "REFUSED: $k is set" >&2; exit 2; fi
done
case "${PGDATABASE:-}" in *supabase*|*prod*) echo "REFUSED: PGDATABASE looks like a shared database" >&2; exit 2;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../../.." && pwd)"; b2s="$root/supabase/tests/b2-double-payment"
MIG="$root/supabase/migrations"; RB="$root/supabase/rollback"
M74="$MIG/20261029220000_prompter_p0_subscription_plan_tampering_lockdown.sql"
M1="$MIG/20261030100000_prompter_b1_server_only_checkout.sql"
M1b="$MIG/20261030100100_prompter_b1_trial_remainder_carryover.sql"
M2="$MIG/20261030140000_prompter_b2_double_payment_safety.sql"
MINV="$MIG/20260901130513_prompter_billing_invoices.sql"
MP="$MIG/20261103170000_prompter_p0_2_payment_invoices.sql"
M4R="$MIG/20261128090000_prompter_retention_vault.sql"
D4R="$RB/20261128090000_prompter_retention_vault.down.sql"
D4RS="$RB/20261128090000_prompter_retention_vault.down-soft.sql"
export PGOPTIONS="-c client_min_messages=warning"
export PGHOST="$HOST" PGPORT="$PORT" PGUSER="$USER_"
PS() { psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q "$@"; }
P() { PS -v ON_ERROR_STOP=1 "$@"; }
PA() { PS -At "$@"; }
W="$(mktemp -d)"; fail=0; npass=0
pass() { echo "PASS: $*"; npass=$((npass+1)); }; bad() { echo "FAIL: $*"; fail=1; }
SRV=$(PA -d postgres -c "show server_version_num")
if [ -n "${REQUIRE_PG_MAJOR:-}" ]; then
  [ $((SRV/10000)) = "$REQUIRE_PG_MAJOR" ] || { echo "REFUSED: server_version_num=$SRV is not PostgreSQL $REQUIRE_PG_MAJOR" >&2; exit 2; }
  echo "PostgreSQL major $REQUIRE_PG_MAJOR confirmed (server_version_num=$SRV)"
fi
echo "SANDBOX: PostgreSQL server_version_num=$SRV, stub auth/tenants/role (bukan Supabase nyata); tabel billing dari migrasi asli repo"

# ---------- rantai asli (diekstrak apa adanya, sama dengan suite p0-2-invoices) ----------
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
[ -s "$W/real_b10.sql" ] && [ -s "$W/real_webhook_audit.sql" ] && pass "T00 tabel transaksi, webhook, dan policy audit diekstrak dari migrasi asli repo" || bad "T00 ekstraksi gagal"
cat > "$W/default_privs.sql" <<'SQL'
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
SQL
cat > "$W/extra_stub.sql" <<'SQL'
-- tabel "produk lain" palsu ber-FK ke tenants (bukan nama objek produk nyata); hanya untuk membuktikan perilaku cascade tidak berubah
create table public.other_product_t (id uuid primary key default gen_random_uuid(), tenant_id uuid references public.tenants(id) on delete cascade, v text);
create table public.other_product_u (id uuid primary key default gen_random_uuid(), tenant_id uuid references public.tenants(id) on delete cascade, v text);
-- pemilik migrasi non-superuser seperti produksi: pemilik tiga tabel billing, SELECT pada tenants (dimiliki peran lain), hak membuat objek di public
-- mig4r meniru peran pemilik migrasi dengan BYPASSRLS (peran postgres Supabase memilikinya; peran migrasi produksi LINOE = UNKNOWN, lihat docs); mig4r_nb = tanpa BYPASSRLS
do $$ begin if not exists (select 1 from pg_roles where rolname = 'mig4r') then create role mig4r nologin bypassrls; end if; if not exists (select 1 from pg_roles where rolname = 'mig4r_nb') then create role mig4r_nb nologin; end if; end $$;
alter role mig4r bypassrls; alter role mig4r_nb nobypassrls;
grant usage, create on schema public to mig4r_nb;
grant select on public.tenants to mig4r_nb;
grant usage, create on schema public to mig4r;
grant select on public.tenants to mig4r;
alter default privileges for role mig4r in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role mig4r in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges for role mig4r in schema public grant all on sequences to anon, authenticated, service_role;
alter table public.prompter_subscriptions owner to mig4r;
alter table public.prompter_invoices owner to mig4r;
alter table public.prompter_payment_transactions owner to mig4r;
SQL

# rantai sampai (dan termasuk) P0-2, atau sampai invoices tanpa P0-2 (tanpa kolom transaction_id)
mkchain() { # <db> <with_p02: 1|0>
  P -d postgres -c "drop database if exists $1" -c "create database $1" >/dev/null \
  && P -d "$1" -f "$here/../s1-trial-quota/support/prod_snapshot.sql" >/dev/null \
  && P -d "$1" -f "$b2s/support/audit_stub.sql" >/dev/null && P -d "$1" -f "$W/real_b10.sql" >/dev/null \
  && P -d "$1" -f "$b2s/support/seed.sql" >/dev/null && P -1 -d "$1" -f "$M74" >/dev/null \
  && P -1 -d "$1" -f "$M1" >/dev/null && P -1 -d "$1" -f "$M1b" >/dev/null && P -1 -d "$1" -f "$M2" >/dev/null \
  && P -d "$1" -f "$W/real_webhook_audit.sql" >/dev/null && P -d "$1" -f "$W/default_privs.sql" >/dev/null \
  && P -d "$1" -f "$MINV" >/dev/null && P -d "$1" -c "alter table public.prompter_invoices add column if not exists billing_country text" >/dev/null \
  && { [ "$2" = 1 ] && P -1 -d "$1" -f "$MP" >/dev/null || [ "$2" = 0 ]; } \
  && P -d "$1" -f "$W/extra_stub.sql" >/dev/null; }
mkchain rv_tpl 1 && mkchain rv_tpl0 0 && pass "T00 rantai asli (B10..P0-2) + pemilik non-superuser siap (template dengan dan tanpa P0-2)" || { bad "T00 rantai gagal"; echo "SOME TESTS FAILED"; exit 1; }
mk() { P -d postgres -c "drop database if exists $1" -c "create database $1 template ${2:-rv_tpl}" >/dev/null; }

# ---------- helper ----------
up() { P -d "$1" -c "set role mig4r" -f "$M4R" >/dev/null 2>"$W/err.txt"; }
down() { P -d "$1" -c "set role mig4r" -f "$D4R" >/dev/null 2>"$W/err_down.txt"; }
downsoft() { P -d "$1" -c "set role mig4r" -f "$D4RS" >/dev/null 2>"$W/err_down.txt"; }
eq() { [ "$2" = "$3" ] && pass "$1" || bad "$1 (got '$2', want '$3')"; }
ERRIS() { case "$2" in *ERR*) pass "$1";; *) bad "$1 (got '$2')";; esac; }
# jalankan sebagai role (set session authorization: session_user = role); klaim JWT untuk pengguna; keluaran = hasil atau "ERR:<sqlstate/pesan>"
as() { local db="$1" role="$2" uid="$3" sql="$4" out claims='{}'
  [ -n "$uid" ] && claims="{\"sub\":\"$uid\",\"role\":\"$role\"}"
  if out=$(PA -v ON_ERROR_STOP=1 -v VERBOSITY=terse -d "$db" -c "set session authorization $role" -c "set request.jwt.claims = '$claims'" -c "$sql" 2>"$W/as_err.txt"); then echo "$out"; else echo "ERR:$(tr '\n' ' ' <"$W/as_err.txt")"; fi; }
sq() { PA -d "$1" -c "$2"; }
vault() { sq "$1" "select count(*) from public.prompter_retention_vault $2"; }
TA=aaaaaaaa-0000-0000-0000-00000000000a; TB=bbbbbbbb-0000-0000-0000-00000000000b; TC=cccccccc-0000-0000-0000-00000000000c
UA=11111111-0000-0000-0000-00000000000a; UB=22222222-0000-0000-0000-00000000000b
XA1=aaaa0001-0000-0000-0000-00000000000a; XA2=aaaa0002-0000-0000-0000-00000000000a; XB1=bbbb0001-0000-0000-0000-00000000000b
seed() { # <db> <with_txn_link 1|0>
  local link="'$XA1'"; [ "$2" = 0 ] && link=""
  P -d "$1" >/dev/null <<SQL || { bad "seed $1 gagal"; return 1; }
set session_replication_role = replica;   -- hanya untuk menanam data sintetis (guard insert transaksi mensyaratkan PENDING); skenario uji berjalan normal
insert into public.tenants(id,nama_usaha) values ('$TA','Tenant A'),('$TB','Tenant B');
insert into public.user_profiles(id,tenant_id,nama,role) values ('$UA','$TA','Pengguna A','owner'),('$UB','$TB','Pengguna B','owner');
insert into public.prompter_subscriptions(tenant_id,plan,status,billing_provider,current_period_start,current_period_end,billing_country,invoice_currency,payment_provider_customer_reference,tax_metadata,success_fee_rate_bps,provider_subscription_id)
 values ('$TA','STARTER','ACTIVE','midtrans',now()-interval '5 days',now()+interval '25 days','ID','IDR','CANARY-CUST-A','{"npwp":"CANARY-NPWP-A"}',250,'sub-a'),
        ('$TB','STARTER','ACTIVE','midtrans',now()-interval '5 days',now()+interval '25 days','ID','IDR','CANARY-CUST-B','{"npwp":"CANARY-NPWP-B"}',250,'sub-b')
 on conflict (tenant_id) do update set plan=excluded.plan, payment_provider_customer_reference=excluded.payment_provider_customer_reference, tax_metadata=excluded.tax_metadata;
insert into public.prompter_payment_transactions(id,tenant_id,user_id,provider,provider_payment_id,provider_event_id,plan,amount,currency,status,failure_reason,metadata,paid_at)
 values ('$XA1','$TA','$UA','midtrans','pay-a1','evt-a1','STARTER',99000,'IDR','PAID','CANARY-FAIL-A','{"email":"CANARY-MAIL-A@x.test"}',now()),
        ('$XA2','$TA','$UA','midtrans',null,null,'GROWTH',199000,'IDR','FAILED','CANARY-FAIL-A2','{"k":"CANARY-META-A2"}',null),
        ('$XB1','$TB','$UB','midtrans','pay-b1','evt-b1','STARTER',99000,'IDR','PAID','CANARY-FAIL-B','{"email":"CANARY-MAIL-B@x.test"}',now());
insert into public.prompter_invoices(tenant_id,provider,external_invoice_id,status,amount,currency,description,period_start,period_end,issued_at,paid_at$( [ "$2" = 1 ] && echo ',transaction_id' ))
 values ('$TA','midtrans','inv-a1','PAID',99000,'IDR','CANARY-DESC-A',now()-interval '5 days',now()+interval '25 days',now(),now()$( [ "$2" = 1 ] && echo ",'$XA1'" )),
        ('$TB','midtrans','inv-b1','PAID',99000,'IDR','CANARY-DESC-B',now()-interval '5 days',now()+interval '25 days',now(),now()$( [ "$2" = 1 ] && echo ",'$XB1'" ));
insert into public.other_product_t(tenant_id,v) values ('$TA','x'),('$TB','y');
insert into public.other_product_u(tenant_id,v) values ('$TA','x'),('$TB','y');
SQL
}
CNTT() { echo "select (select count(*) from public.prompter_subscriptions where tenant_id='$1')||'/'||(select count(*) from public.prompter_invoices where tenant_id='$1')||'/'||(select count(*) from public.prompter_payment_transactions where tenant_id='$1')"; }
CNT="select (select count(*) from public.prompter_subscriptions)||'/'||(select count(*) from public.prompter_invoices)||'/'||(select count(*) from public.prompter_payment_transactions)"
ALLCNT="select (select count(*) from public.tenants)||'/'||(select count(*) from public.user_profiles)||'/'||(select count(*) from public.prompter_subscriptions)||'/'||(select count(*) from public.prompter_invoices)||'/'||(select count(*) from public.prompter_payment_transactions)||'/'||(select count(*) from public.other_product_t)||'/'||(select count(*) from public.other_product_u)||'/'||(select count(*) from public.prompter_audit_logs)"
CATCNT="select (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')||'/'||(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public')||'/'||(select count(*) from pg_trigger where not tgisinternal)"
BILL="('public.prompter_subscriptions'::regclass,'public.prompter_invoices'::regclass,'public.prompter_payment_transactions'::regclass)"
RLSSNAP="select md5(coalesce((select string_agg(concat_ws('/',c.relname,c.relrowsecurity::text,c.relforcerowsecurity::text),'|' order by c.relname) from pg_class c where c.oid in $BILL),'') || '#' || coalesce((select string_agg(concat_ws('/',tablename,policyname,cmd,roles::text,coalesce(qual,''),coalesce(with_check,'')),'|' order by tablename,policyname) from pg_policies where tablename in ('prompter_subscriptions','prompter_invoices','prompter_payment_transactions')),''))"
ACLSNAP="select md5(coalesce((select string_agg(concat_ws('/',c.relname,coalesce(c.relacl::text,'NULL'),c.relowner::regrole::text),'|' order by c.relname) from pg_class c where c.oid in $BILL),'') || '#' || coalesce((select string_agg(concat_ws('/',a.attrelid::regclass::text,a.attname,a.attacl::text),'|' order by a.attrelid::regclass::text,a.attname) from pg_attribute a where a.attrelid in $BILL and a.attacl is not null),''))"
FNSNAP="select md5(coalesce((select string_agg(proname||':'||md5(prosrc)||':'||prosecdef::text||':'||coalesce(proconfig::text,''),'|' order by proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('fn_apply_verified_payment','fn_create_ai_job_if_entitled','fn_begin_checkout','fn_resolve_review_payment')),''))"

# ======================================================================================================================
# S1: apply, idempoten, snapshot RLS/ACL/fungsi sebelum-sesudah (T15, T17, T18, T22, T26), kunci (T25 sebagian)
# ======================================================================================================================
mk g1; seed g1 1
CAT0=$(sq g1 "$CATCNT"); RLS0=$(sq g1 "$RLSSNAP"); ACL0=$(sq g1 "$ACLSNAP"); FN0=$(sq g1 "$FNSNAP")
TEN0=$(sq g1 "select md5(string_agg(t::text,'|' order by id)) from public.tenants t"); CNT0=$(sq g1 "$CNT")
[ "$(sq g1 "select count(*) from pg_trigger where tgname like '%retention%'")" = 0 ] && pass "S1 keadaan awal: nol objek 4r" || bad "S1 keadaan awal tidak bersih"
[ "$(sq g1 "select count(*) from information_schema.columns where table_name='prompter_invoices' and column_name='transaction_id'")" = 1 ] && pass "S1 rantai membawa kolom transaction_id (P0-2) dan FK NO ACTION ke transaksi" || bad "S1 rantai tanpa P0-2"
up g1 && pass "T22 apply pertama berhasil (sebagai pemilik non-superuser)" || bad "T22 apply: $(cat "$W/err.txt")"
S1A=$(sq g1 "$CATCNT"); up g1 && eq "T22 apply kedua idempoten (katalog sama)" "$(sq g1 "$CATCNT")" "$S1A" || bad "T22 apply kedua: $(cat "$W/err.txt")"
up g1 && eq "T22 apply ketiga idempoten" "$(sq g1 "$CATCNT")" "$S1A" || bad "T22 apply ketiga"
eq "T15 RLS dan policy tiga tabel billing identik sebelum/sesudah 4r" "$(sq g1 "$RLSSNAP")" "$RLS0"
eq "T17 relforcerowsecurity tiga tabel billing tidak berubah (snapshot ikut RLSSNAP) dan tidak FORCE" "$(sq g1 "select count(*) from pg_class where oid in $BILL and relforcerowsecurity")" 0
eq "T18 relacl dan ACL kolom tiga tabel billing identik sebelum/sesudah 4r" "$(sq g1 "$ACLSNAP")" "$ACL0"
eq "T26 badan fn_apply_verified_payment, fn_create_ai_job_if_entitled, fn_begin_checkout, fn_resolve_review_payment tidak berubah" "$(sq g1 "$FNSNAP")" "$FN0"
eq "S1 baris tenants dan baris billing tidak berubah oleh migrasi" "$(sq g1 "select md5(string_agg(t::text,'|' order by id)) from public.tenants t")|$(sq g1 "$CNT")" "$TEN0|$CNT0"
eq "T15 vault: RLS aktif dan nol policy" "$(sq g1 "select c.relrowsecurity::text||':'||(select count(*) from pg_policies where tablename='prompter_retention_vault') from pg_class c where c.oid='public.prompter_retention_vault'::regclass")" "true:0"
eq "S1 vault tanpa foreign key (keluar maupun masuk)" "$(sq g1 "select count(*) from pg_constraint where contype='f' and (conrelid='public.prompter_retention_vault'::regclass or confrelid='public.prompter_retention_vault'::regclass)")" 0
eq "S1 retain_until nullable tanpa default (tidak ada durasi retensi)" "$(sq g1 "select is_nullable||':'||coalesce(column_default,'NULL') from information_schema.columns where table_name='prompter_retention_vault' and column_name='retain_until'")" "YES:NULL"
eq "S1 tidak ada fungsi purge/penghapus otomatis dan tidak ada pg_cron job baru" "$(sq g1 "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (proname ilike '%purge%' or proname ilike '%retention%') and proname not in ('fn_prompter_retention_vault_capture','fn_prompter_retention_block_truncate','fn_prompter_retention_vault_immutable','fn_prompter_retention_vault_status')")" 0
eq "T13 status(): ok, trigger 3/3/3, penjaga vault 2, ENABLE ALWAYS 3, vault kosong" "$(sq g1 "select (s->>'ok')||':'||(s->>'capture_triggers_enabled')||(s->>'capture_triggers_always')||(s->>'truncate_guards_enabled')||(s->>'vault_guards_enabled')||':'||(s->>'vault_rows') from (select public.fn_prompter_retention_vault_status() s) x")" "true:3332:0"
# T19 hak: vault, urutan identity, dan keempat fungsi, untuk semua peran klien
bad_priv=0
for r in public anon authenticated service_role; do
  for pr in select insert update delete truncate references trigger; do
    [ "$(sq g1 "select has_table_privilege('$r','public.prompter_retention_vault','$pr')")" = f ] || { bad_priv=1; echo "  hak $r/$pr pada vault ada"; }
  done
  [ "$(sq g1 "select has_sequence_privilege('$r', pg_get_serial_sequence('public.prompter_retention_vault','id'), 'usage')")" = f ] || { bad_priv=1; echo "  hak USAGE urutan vault untuk $r ada"; }
  for fn in fn_prompter_retention_vault_capture fn_prompter_retention_block_truncate fn_prompter_retention_vault_immutable fn_prompter_retention_vault_status; do
    [ "$(sq g1 "select has_function_privilege('$r','public.$fn()','execute')")" = f ] || { bad_priv=1; echo "  EXECUTE $r/$fn ada"; }
  done
done
[ "$bad_priv" = 0 ] && pass "T19 vault, urutan identity, dan 4 fungsi: nol hak untuk public/anon/authenticated/service_role" || bad "T19 ada hak klien"
eq "T19 ACL vault hanya pemilik" "$(sq g1 "select count(*) from pg_class c, aclexplode(c.relacl) a where c.oid='public.prompter_retention_vault'::regclass and a.grantee <> c.relowner")" 0
eq "T21 fn capture: SECURITY DEFINER, pemilik mig4r, search_path berakhir pg_temp" "$(sq g1 "select prosecdef::text||':'||proowner::regrole::text||':'||(proconfig::text like '%search_path=pg_catalog, public, pg_temp%')::text from pg_proc where proname='fn_prompter_retention_vault_capture'")" "true:mig4r:true"
eq "T21 tiga fungsi lain SECURITY INVOKER dengan search_path berakhir pg_temp" "$(sq g1 "select count(*) from pg_proc where proname in ('fn_prompter_retention_block_truncate','fn_prompter_retention_vault_immutable','fn_prompter_retention_vault_status') and not prosecdef and proconfig::text like '%search_path=pg_catalog, public, pg_temp%'")" 3
eq "T21 tidak ada fungsi yang meng-UPDATE/DELETE vault" "$(sq g1 "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and prosrc ~* '(delete\\s+from|update)\\s+(public\\.)?prompter_retention_vault'")" 0

# ======================================================================================================================
# S2: penghapusan tenant (T1, T3, T5, T20), penghapusan langsung (T2), allowlist (T5), kolom opsional (T6)
# ======================================================================================================================
deltenant() { # <db> <tenant> : hapus profil (FK tanpa cascade di rantai uji) lalu tenant, sebagai superuser
  P -d "$1" -c "delete from public.user_profiles where tenant_id='$2'" -c "delete from public.tenants where id='$2'" >/dev/null 2>"$W/del_err.txt"; }
VSUM="select coalesce(string_agg(source_table||':'||archive_reason||':'||n,',' order by source_table,archive_reason),'-') from (select source_table,archive_reason,count(*) n from public.prompter_retention_vault group by 1,2) x"
mk g2; seed g2 1; up g2 || bad "S2 apply: $(cat "$W/err.txt")"
P -d g2 -c "delete from public.user_profiles where tenant_id='$TA'" >/dev/null
OUT=$(as g2 service_role "" "with d as (delete from public.tenants where id='$TA' returning 1) select count(*) from d")
eq "T20 service_role tetap dapat DELETE tenants (kontrak produk lain tidak berubah)" "$OUT" 1
eq "T1 hapus tenant A oleh service_role: vault = 1 langganan + 2 transaksi + 1 invoice, semua TENANT_CASCADE" "$(sq g2 "$VSUM")" "prompter_invoices:TENANT_CASCADE:1,prompter_payment_transactions:TENANT_CASCADE:2,prompter_subscriptions:TENANT_CASCADE:1"
eq "T1 deleted_by = service_role (session_user, tanpa PII)" "$(sq g2 "select string_agg(distinct deleted_by,',') from public.prompter_retention_vault")" service_role
eq "T1 baris billing tenant A hilang dari tabel sumber (perilaku cascade tetap)" "$(sq g2 "select (select count(*) from public.prompter_subscriptions where tenant_id='$TA')+(select count(*) from public.prompter_invoices where tenant_id='$TA')+(select count(*) from public.prompter_payment_transactions where tenant_id='$TA')")" 0
eq "T12 tenant B utuh (1 langganan/1 invoice/1 transaksi) dan vault tidak memuat tenant_id B" "$(sq g2 "$(CNTT $TB)")|$(vault g2 "where tenant_id='$TB'")" "1/1/1|0"
eq "T3 invoice tertaut transaksi (FK NO ACTION): hapus tenant berhasil, transaction_id tersalin dan transaksinya juga tersalin" "$(sq g2 "select (i.row_data->>'transaction_id') = (t.row_data->>'id') from public.prompter_retention_vault i join public.prompter_retention_vault t on t.source_table='prompter_payment_transactions' and t.source_pk='$XA1' where i.source_table='prompter_invoices'")" t
eq "T5 pk dan tenant_id kolom vault benar" "$(sq g2 "select count(*) from public.prompter_retention_vault where source_pk is null or tenant_id <> '$TA'")" 0
eq "S2 capture_txid sama untuk satu pernyataan DELETE (satu transaksi), archived_at terisi, retain_until NULL, allowlist_ver 1" "$(sq g2 "select count(distinct capture_txid)||':'||count(archived_at)||':'||count(retain_until)||':'||min(allowlist_ver)||max(allowlist_ver) from public.prompter_retention_vault")" "1:4:0:11"
# T5 isi row_data: tepat kolom allowlist, nilai benar, nol kanari
exp_sub="billing_provider,cancel_at_period_end,created_at,current_period_end,current_period_start,plan,provider_subscription_id,status,tenant_id,updated_at"
exp_inv="amount,created_at,currency,external_invoice_id,id,issued_at,paid_at,period_end,period_start,provider,status,tenant_id,transaction_id,updated_at"
exp_txn="amount,created_at,currency,id,paid_at,plan,provider,provider_event_id,provider_payment_id,status,tenant_id,updated_at"
keys() { sq "$1" "select string_agg(k,',' order by k) from (select distinct jsonb_object_keys(row_data) k from public.prompter_retention_vault where source_table='$2') x"; }
eq "T5 kunci row_data langganan = allowlist persis" "$(keys g2 prompter_subscriptions)" "$exp_sub"
eq "T5 kunci row_data invoice = allowlist persis" "$(keys g2 prompter_invoices)" "$exp_inv"
eq "T5 kunci row_data transaksi = allowlist persis" "$(keys g2 prompter_payment_transactions)" "$exp_txn"
eq "T5 nol kanari (kolom bebas/rahasia) di seluruh vault" "$(sq g2 "select count(*) from public.prompter_retention_vault where row_data::text ~* 'CANARY|npwp|metadata|failure_reason|description|customer_reference|tax_metadata|user_id|success_fee|billing_country|invoice_currency|@x.test'")" 0
eq "T5 nilai penting tersalin utuh (nominal, pengenal penyedia, rencana)" "$(sq g2 "select (row_data->>'amount')||':'||(row_data->>'provider_payment_id')||':'||(row_data->>'plan') from public.prompter_retention_vault where source_table='prompter_payment_transactions' and source_pk='$XA1'")" "99000.00:pay-a1:STARTER"
# kolom baru di masa depan TIDAK otomatis tersalin
P -d g2 -c "alter table public.prompter_payment_transactions add column future_note text" -c "alter table public.prompter_subscriptions add column future_note text" >/dev/null
P -d g2 -c "set session_replication_role=replica" -c "insert into public.prompter_payment_transactions(id,tenant_id,provider,plan,amount,status,future_note) values ('bbbb0002-0000-0000-0000-00000000000b','$TB','midtrans','STARTER',1,'FAILED','CANARY-FUTURE')" >/dev/null
deltenant g2 "$TB" && pass "T5 hapus tenant B dengan kolom baru terpasang berhasil" || bad "T5 hapus B: $(cat "$W/del_err.txt")"
eq "T5 kolom baru future_note tidak tersalin (allowlist, bukan denylist)" "$(sq g2 "select count(*) from public.prompter_retention_vault where row_data::text ~ 'future_note|CANARY-FUTURE'")" 0
eq "T1 vault akhir: tenant A 4 baris + tenant B 4 baris (1 langganan, 1 invoice, 2 transaksi)" "$(vault g2 "where tenant_id='$TA'")/$(vault g2 "where tenant_id='$TB'")" "4/4"

# hapus oleh authenticated dengan hak hapus (fiktif) dan oleh pemilik/superuser
mk g2b; seed g2b 1; up g2b
P -d g2b -c "grant delete on public.tenants to authenticated" -c 'create policy rv_del on public.tenants for delete to authenticated using (true)' -c 'create policy rv_sel on public.tenants for select to authenticated using (true)' -c "delete from public.user_profiles where tenant_id='$TB'" >/dev/null
OUT=$(as g2b authenticated "$UA" "with d as (delete from public.tenants where id='$TB' returning 1) select count(*) from d")
eq "T1 authenticated dengan hak hapus (policy uji) menghapus tenant B: berhasil" "$OUT" 1
eq "T1 vault tenant B: 3 baris, deleted_by authenticated, TENANT_CASCADE" "$(sq g2b "$VSUM")|$(sq g2b "select string_agg(distinct deleted_by,',') from public.prompter_retention_vault")" "prompter_invoices:TENANT_CASCADE:1,prompter_payment_transactions:TENANT_CASCADE:1,prompter_subscriptions:TENANT_CASCADE:1|authenticated"
mk g2c; seed g2c 1; up g2c; deltenant g2c "$TA" && eq "T1 pemilik/superuser menghapus tenant A: vault 4 baris, deleted_by postgres" "$(vault g2c "")|$(sq g2c "select string_agg(distinct deleted_by,',') from public.prompter_retention_vault")" "4|$USER_" || bad "T1 superuser: $(cat "$W/del_err.txt")"

# T2 DELETE langsung per tabel = ROW_DELETE; massal 10.000 baris
mk g3; seed g3 1; up g3
P -d g3 -c "delete from public.prompter_invoices where external_invoice_id='inv-a1'" -c "delete from public.prompter_payment_transactions where id='$XA2'" -c "delete from public.prompter_subscriptions where tenant_id='$TA'" >/dev/null 2>"$W/e.txt" || bad "T2 hapus langsung: $(cat "$W/e.txt")"
eq "T2 DELETE langsung per tabel: ROW_DELETE tersalin (invoice, transaksi, langganan)" "$(sq g3 "$VSUM")" "prompter_invoices:ROW_DELETE:1,prompter_payment_transactions:ROW_DELETE:1,prompter_subscriptions:ROW_DELETE:1"
eq "T2 source_pk langganan = tenant_id; transaksi = id" "$(sq g3 "select string_agg(source_pk,',' order by source_table) from public.prompter_retention_vault where source_table in ('prompter_subscriptions','prompter_payment_transactions')")" "$XA2,$TA"
P -d g3 -c "set session_replication_role=replica" -c "insert into public.prompter_payment_transactions(id,tenant_id,provider,plan,amount,status) select gen_random_uuid(),'$TB','midtrans','STARTER',1,'FAILED' from generate_series(1,10000)" >/dev/null
T0=$(date +%s%N); P -d g3 -c "delete from public.prompter_payment_transactions where tenant_id='$TB' and amount=1" >/dev/null 2>"$W/e.txt" || bad "T2 hapus massal: $(cat "$W/e.txt")"; T1_=$(date +%s%N); MS=$(( (T1_-T0)/1000000 ))
eq "T2 hapus massal 10.000 baris: vault +10.000 (${MS} ms)" "$(vault g3 "where tenant_id='$TB' and source_table='prompter_payment_transactions'")" 10000
[ "$MS" -lt 120000 ] && pass "T2 hapus massal 10.000 baris selesai < 120 s (${MS} ms; satu INSERT per baris, volume produksi jauh lebih kecil)" || bad "T2 hapus massal terlalu lambat (${MS} ms)"

# T6 kolom opsional belum ada (tanpa P0-2: invoices tanpa transaction_id)
mk g4 rv_tpl0; seed g4 0; up g4 || bad "T6 apply tanpa P0-2: $(cat "$W/err.txt")"
deltenant g4 "$TA" && pass "T6 tanpa kolom transaction_id: hapus tenant berhasil tanpa galat" || bad "T6 $(cat "$W/del_err.txt")"
eq "T6 row_data invoice tanpa transaction_id (kolom belum ada), vault 4 baris" "$(sq g4 "select (row_data ? 'transaction_id')::text from public.prompter_retention_vault where source_table='prompter_invoices'")|$(vault g4 "")" "false|4"

# ======================================================================================================================
# S3: fail-closed (T4), trigger lain (T7), TRUNCATE (T8), mode replica (T9), perilaku produk lain (T10), alasan tanpa BYPASSRLS
# ======================================================================================================================
failcase() { # <label> <sql setup sebagai superuser> <sql hitung vault sesudah> [gucs untuk sesi hapus]
  local label="$1" setup="$2" vq="$3" pre="${4:-select 1}" out
  mk fc; seed fc 1; up fc || { bad "T4 $label apply"; return; }
  P -d fc -c "$setup" >/dev/null 2>"$W/e.txt" || { bad "T4 $label setup: $(cat "$W/e.txt")"; return; }
  P -d fc -c "delete from public.user_profiles where tenant_id='$TA'" >/dev/null
  local c0; c0=$(sq fc "$(CNTT $TA)")
  out=$(PS -v ON_ERROR_STOP=1 -v VERBOSITY=default -d fc -c "$pre" -c "delete from public.tenants where id='$TA'" 2>&1 >/dev/null); local rc=$?
  [ "$rc" != 0 ] && pass "T4 $label: DELETE tenants ditolak (fail-closed)" || bad "T4 $label: DELETE tenants lolos padahal penyalinan gagal"
  case "$out" in *LR001*) pass "T4 $label: galat LR001";; *) bad "T4 $label: galat bukan LR001 ($out)";; esac
  case "$out" in *CANARY*|*midtrans*|*pay-a1*|*99000*) bad "T4 $label: pesan galat memuat isi baris";; *) pass "T4 $label: pesan galat tanpa isi baris (nol kanari/nilai)";; esac
  eq "T4 $label: tenant A tetap ada" "$(sq fc "select count(*) from public.tenants where id='$TA'")" 1
  eq "T4 $label: baris billing tenant A utuh (tidak ada anak hilang)" "$(sq fc "$(CNTT $TA)")" "$c0"
  eq "T4 $label: vault tidak bertambah (atomik)" "$(sq fc "$vq")" 0
}
failcase "vault di-rename" "alter table public.prompter_retention_vault rename to prompter_retention_vault_x" "select count(*) from public.prompter_retention_vault_x"
failcase "INSERT dicabut dari pemilik" "revoke insert on public.prompter_retention_vault from mig4r" "select count(*) from public.prompter_retention_vault"
failcase "CHECK gagal (penuh/menolak)" "alter table public.prompter_retention_vault add constraint rv_boom check (false) not valid" "select count(*) from public.prompter_retention_vault"
failcase "kolom NOT NULL tak terpenuhi" "alter table public.prompter_retention_vault add column must_have text not null" "select count(*) from public.prompter_retention_vault"
failcase "statement_timeout tercapai saat INSERT" "create function public.rv_slow() returns trigger language plpgsql as \$f\$ begin perform pg_sleep(1); return new; end \$f\$; create trigger rv_slow before insert on public.prompter_retention_vault for each row execute function public.rv_slow()" "select count(*) from public.prompter_retention_vault" "set statement_timeout = '150ms'"
# fail-closed juga untuk DELETE langsung dan untuk TRUNCATE-cascade tidak relevan; DELETE langsung:
mk fc; seed fc 1; up fc; P -d fc -c "alter table public.prompter_retention_vault rename to prompter_retention_vault_x" >/dev/null
OUT=$(PS -v ON_ERROR_STOP=1 -d fc -c "delete from public.prompter_invoices where external_invoice_id='inv-a1'" 2>&1 >/dev/null)
case "$OUT" in *LR001*) pass "T4 DELETE langsung pada tabel billing juga fail-closed (LR001)";; *) bad "T4 DELETE langsung: $OUT";; esac
eq "T4 invoice masih ada setelah DELETE langsung yang ditolak" "$(sq fc "select count(*) from public.prompter_invoices where external_invoice_id='inv-a1'")" 1

# T7 trigger lain yang membatalkan hapus: vault tidak bertambah; urutan zz = terakhir
mk g7; seed g7 1; up g7
P -d g7 -c "create function public.rv_cancel() returns trigger language plpgsql as \$f\$ begin return null; end \$f\$" -c "create trigger trg_prompter_cancel before delete on public.prompter_invoices for each row execute function public.rv_cancel()" >/dev/null
eq "T7 trigger lain mengembalikan NULL: DELETE invoice 0 baris dan vault tidak bertambah" "$(as g7 service_role "" "with d as (delete from public.prompter_invoices where tenant_id='$TA' returning 1) select count(*) from d")|$(vault g7 "")" "0|0"
eq "T7 trg_zz_retention_capture adalah BEFORE DELETE row trigger TERAKHIR (urutan abjad) pada ketiga tabel" "$(sq g7 "select count(*) from (select distinct on (tgrelid) tgrelid, tgname from pg_trigger where tgrelid in $BILL and not tgisinternal and tgtype & 1 = 1 and tgtype & 2 = 2 and tgtype & 8 = 8 order by tgrelid, tgname desc) x where tgname='trg_zz_retention_capture'")" 3
P -d g7 -c "create function public.rv_raise() returns trigger language plpgsql as \$f\$ begin raise exception 'ditolak trigger lain'; end \$f\$" -c "create trigger trg_prompter_raise before delete on public.prompter_payment_transactions for each row execute function public.rv_raise()" -c "delete from public.user_profiles where tenant_id='$TA'" >/dev/null
OUT=$(PS -v ON_ERROR_STOP=1 -d g7 -c "delete from public.tenants where id='$TA'" 2>&1 >/dev/null)
case "$OUT" in *"ditolak trigger lain"*) pass "T7 trigger lain yang melempar galat membatalkan DELETE tenants";; *) bad "T7 $OUT";; esac
eq "T7 vault tetap kosong setelah pembatalan oleh trigger lain (salinan ikut rollback)" "$(vault g7 "")" 0

# T8 TRUNCATE
mk g8; seed g8 1; up g8
A0=$(sq g8 "$ALLCNT")
for stmt in "truncate public.prompter_subscriptions" "truncate public.prompter_invoices" "truncate public.prompter_invoices, public.prompter_payment_transactions" "truncate public.prompter_payment_transactions restart identity cascade" "truncate public.tenants cascade"; do
  OUT=$(PS -v ON_ERROR_STOP=1 -d g8 -c "$stmt" 2>&1 >/dev/null); case "$OUT" in *LR003*) pass "T8 $stmt ditolak LR003";; *) bad "T8 $stmt: $OUT";; esac
done
OUT=$(PS -v ON_ERROR_STOP=1 -d g8 -c "set session authorization service_role" -c "truncate public.prompter_invoices" 2>&1 >/dev/null); case "$OUT" in *LR003*) pass "T8 service_role (hak TRUNCATE default Supabase) tetap ditolak LR003";; *) bad "T8 service_role: $OUT";; esac
P -d g8 -c "set session_replication_role=replica" -c "insert into public.prompter_retention_vault(source_table,source_pk,tenant_id,row_data,archive_reason) values ('prompter_invoices','x','$TA','{}','ROW_DELETE')" >/dev/null 2>&1
OUT=$(PS -v ON_ERROR_STOP=1 -d g8 -c "truncate public.prompter_retention_vault" 2>&1 >/dev/null); case "$OUT" in *LR004*) pass "T8 TRUNCATE vault ditolak LR004";; *) bad "T8 truncate vault: $OUT";; esac
OUT=$(PS -v ON_ERROR_STOP=1 -d g8 -c "set session_replication_role=replica" -c "truncate public.prompter_invoices" 2>&1 >/dev/null); case "$OUT" in *LR003*) pass "T8 TRUNCATE tetap ditolak walau mode replica (ENABLE ALWAYS)";; *) bad "T8 replica truncate: $OUT";; esac
eq "T8 tidak ada baris yang hilang setelah semua percobaan TRUNCATE" "$(sq g8 "$ALLCNT")" "$A0"
for stmt in "update public.prompter_retention_vault set tenant_id=tenant_id" "delete from public.prompter_retention_vault"; do
  OUT=$(PS -v ON_ERROR_STOP=1 -d g8 -c "$stmt" 2>&1 >/dev/null); case "$OUT" in *LR004*) pass "T8 $stmt ditolak LR004 (pemilik/superuser sekalipun)";; *) bad "T8 $stmt: $OUT";; esac
done

# T9 mode replica: cascade FK tidak berjalan; DELETE langsung tetap tersalin; pemilik dapat DISABLE TRIGGER (bukan immutable)
mk g9; seed g9 1; up g9
P -d g9 -c "begin; set local session_replication_role = replica; delete from public.tenants where id='$TB'; commit;" >/dev/null 2>"$W/e.txt" || bad "T9 hapus tenant di mode replica: $(cat "$W/e.txt")"
eq "T9 replica: tenant B terhapus tetapi baris billing B TIDAK hilang (cascade FK tidak berjalan; yatim) dan vault tidak bertambah" "$(sq g9 "select (select count(*) from public.tenants where id='$TB')||':'||($(CNTT $TB | sed 's/^select //'))")|$(vault g9 "")" "0:1/1/1|0"
P -d g9 -c "set session_replication_role=replica" -c "delete from public.prompter_invoices where tenant_id='$TB'" >/dev/null 2>"$W/e.txt" || bad "T9 hapus langsung di mode replica: $(cat "$W/e.txt")"
eq "T9 replica: DELETE langsung tetap tersalin (trigger ENABLE ALWAYS); tenant sudah tak ada = TENANT_CASCADE" "$(sq g9 "$VSUM")" "prompter_invoices:TENANT_CASCADE:1"
P -d g9 -c "set role mig4r" -c "alter table public.prompter_subscriptions disable trigger trg_zz_retention_capture" >/dev/null 2>"$W/e.txt" && pass "T9 pemilik DAPAT menonaktifkan trigger (jujur: bukan immutable)" || bad "T9 disable: $(cat "$W/e.txt")"
eq "T9 status().ok = false setelah trigger dinonaktifkan (terdeteksi)" "$(sq g9 "select public.fn_prompter_retention_vault_status()->>'ok'")" false
P -d g9 -c "delete from public.prompter_subscriptions where tenant_id='$TB'" >/dev/null
eq "T9 DELETE saat trigger nonaktif TIDAK tersalin (jendela break-glass; diterima tertulis di docs)" "$(vault g9 "where source_table='prompter_subscriptions'")" 0
P -d g9 -c "set role mig4r" -c "alter table public.prompter_subscriptions enable trigger trg_zz_retention_capture" >/dev/null
eq "T9 ENABLE biasa: ok=true tetapi capture_triggers_always=2 (terdeteksi)" "$(sq g9 "select (s->>'ok')||':'||(s->>'capture_triggers_always') from (select public.fn_prompter_retention_vault_status() s) x")" "true:2"
P -d g9 -c "set role mig4r" -c "alter table public.prompter_subscriptions enable always trigger trg_zz_retention_capture" >/dev/null
eq "T9 ENABLE ALWAYS dipulihkan: ok=true, always=3" "$(sq g9 "select (s->>'ok')||':'||(s->>'capture_triggers_always') from (select public.fn_prompter_retention_vault_status() s) x")" "true:3"

# T10 perilaku produk lain tidak berubah: hasil hapus tenant A identik dengan dan tanpa 4r (diff seluruh hitungan tabel)
mk g10a; seed g10a 1; mk g10b; seed g10b 1; up g10b
deltenant g10a "$TA"; deltenant g10b "$TA"
eq "T10 hitungan seluruh tabel (tenants, profil, billing, produk lain, audit) sesudah hapus tenant A identik dengan dan tanpa 4r" "$(sq g10b "$ALLCNT")" "$(sq g10a "$ALLCNT")"
eq "T10 tabel produk lain: baris tenant A ikut hilang seperti biasa, tenant B utuh" "$(sq g10b "select (select count(*) from public.other_product_t where tenant_id='$TA')::text||(select count(*) from public.other_product_u where tenant_id='$TA')::text||(select count(*) from public.other_product_t where tenant_id='$TB')::text||(select count(*) from public.other_product_u where tenant_id='$TB')::text")" 0011

# Alasan tanpa BYPASSRLS: peran penyalin yang tidak dapat melihat seluruh baris tenants -> UNDETERMINED (bukan label menyesatkan)
mk g11; seed g11 1
P -d g11 -c "alter table public.prompter_subscriptions owner to mig4r_nb" -c "alter table public.prompter_invoices owner to mig4r_nb" -c "alter table public.prompter_payment_transactions owner to mig4r_nb" >/dev/null
P -d g11 -c "set role mig4r_nb" -f "$M4R" >/dev/null 2>"$W/err.txt" && pass "S3 apply oleh pemilik tanpa BYPASSRLS (punya SELECT pada tenants) berhasil" || bad "S3 apply mig4r_nb: $(cat "$W/err.txt")"
P -d g11 -c "delete from public.prompter_invoices where external_invoice_id='inv-a1'" >/dev/null
eq "S3 pemilik penyalin tanpa BYPASSRLS + RLS tenants aktif: alasan = UNDETERMINED (bukan label palsu), penyalinan tetap berhasil" "$(sq g11 "select string_agg(archive_reason||':'||n,',') from (select archive_reason, count(*) n from public.prompter_retention_vault group by 1) x")" "UNDETERMINED:1"

# ======================================================================================================================
# S4: isolasi tenant, RLS, privilege (T11-T14, T16)
# ======================================================================================================================
mk g12; seed g12 1; up g12
mk g12b; seed g12b 1       # pembanding tanpa 4r
INS="insert into public.prompter_retention_vault(source_table,source_pk,tenant_id,row_data,archive_reason) values ('prompter_invoices','x','$TA','{}','ROW_DELETE')"
for who in "authenticated $UA" "authenticated $UB" "anon "; do
  set -- $who; role="$1"; uid="${2:-}"; lbl="$role${uid:+ ($([ "$uid" = "$UA" ] && echo tenant A || echo tenant B))}"
  for stmt in "select count(*) from public.prompter_retention_vault" "$INS" "update public.prompter_retention_vault set tenant_id=tenant_id" "delete from public.prompter_retention_vault" "truncate public.prompter_retention_vault" "select public.fn_prompter_retention_vault_status()" "select public.fn_prompter_retention_vault_capture()" "select public.fn_prompter_retention_block_truncate()" "select public.fn_prompter_retention_vault_immutable()"; do
    out=$(as g12 "$role" "$uid" "$stmt"); case "$out" in ERR:*"permission denied"*) ;; *) bad "T11/T13 $lbl: '$stmt' tidak ditolak karena hak (got '$out')";; esac
  done
  pass "T11/T13 $lbl: nol akses ke vault dan keempat fungsi (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/EXECUTE ditolak: permission denied)"
done
Q3="select (select count(*) from public.prompter_subscriptions)||'/'||(select count(*) from public.prompter_invoices)||'/'||(select count(*) from public.prompter_payment_transactions)"
eq "T16 tenant A (authenticated) hanya melihat barisnya: langganan/invoice/transaksi = 1/1/2" "$(as g12 authenticated "$UA" "$Q3")" "1/1/2"
eq "T16 tenant B hanya melihat barisnya = 1/1/1" "$(as g12 authenticated "$UB" "$Q3")" "1/1/1"
eq "T16 hasil identik dengan keadaan tanpa 4r (A)" "$(as g12b authenticated "$UA" "$Q3")" "1/1/2"
eq "T16 tenant A (authenticated) tidak dapat menulis langsung ke tiga tabel billing (hak/policy lama utuh)" "$(as g12 authenticated "$UA" "delete from public.prompter_payment_transactions")" "$(as g12b authenticated "$UA" "delete from public.prompter_payment_transactions")"
eq "T11 setelah semua percobaan klien vault tetap kosong" "$(vault g12 "")" 0
# T12 + T14 berurutan: hapus A lalu B; B tetap membaca miliknya selama A dihapus
mk g14; seed g14 1; up g14
deltenant g14 "$TA"
eq "T12 setelah A dihapus, tenant B (authenticated) tetap membaca barisnya 1/1/1 dan vault tidak memuat tenant_id B" "$(sq g14 "$(CNTT $TB)")|$(vault g14 "where tenant_id='$TB'")" "1/1/1|0"
deltenant g14 "$TB"
eq "T14 dua tenant dihapus berurutan: vault A=4, B=3, tidak ada tenant_id lain" "$(vault g14 "where tenant_id='$TA'")/$(vault g14 "where tenant_id='$TB'")/$(vault g14 "where tenant_id not in ('$TA','$TB')")" "4/3/0"
mk g14p; seed g14p 1; up g14p
( deltenant g14p "$TA" ) & ( deltenant g14p "$TB" ) & wait
eq "T14 dua tenant dihapus PARALEL: vault A=4, B=3, nol silang (tenant_id kolom = tenant_id di row_data)" "$(vault g14p "where tenant_id='$TA'")/$(vault g14p "where tenant_id='$TB'")/$(vault g14p "where tenant_id::text <> row_data->>'tenant_id'")" "4/3/0"

# ======================================================================================================================
# S5: rollback (T22, T23), prasyarat (T24), kunci (T25)
# ======================================================================================================================
mk g15; seed g15 1; CAT15=$(sq g15 "$CATCNT")
up g15; down g15 && pass "T22 down (vault kosong) berhasil" || bad "T22 down: $(cat "$W/err_down.txt")"
down g15 && pass "T22 down kedua idempoten" || bad "T22 down kedua: $(cat "$W/err_down.txt")"
eq "T22 katalog (fungsi/kelas/trigger) kembali persis ke keadaan awal sebelum 4r" "$(sq g15 "$CATCNT")" "$CAT15"
eq "T22 down tidak mengubah ACL/RLS/fungsi billing dan baris" "$(sq g15 "$ACLSNAP")|$(sq g15 "$RLSSNAP")|$(sq g15 "$FNSNAP")" "$(sq g12b "$ACLSNAP")|$(sq g12b "$RLSSNAP")|$(sq g12b "$FNSNAP")"
up g15 && pass "T22 apply ulang setelah down berhasil" || bad "T22 apply ulang: $(cat "$W/err.txt")"
eq "T22 sesudah down lalu up lagi: DELETE tenants normal dan tersalin" "$( deltenant g15 "$TA"; vault g15 "")" 4

mk g16; seed g16 1; CAT16=$(sq g16 "$CATCNT"); up g16; deltenant g16 "$TA"
down g16 && bad "T23 down TIDAK menolak saat vault berisi" || { grep -q "DIBATALKAN down 4r" "$W/err_down.txt" && pass "T23 down menolak saat vault berisi 4 baris (bukti tidak dibuang)" || bad "T23 down gagal karena sebab lain: $(cat "$W/err_down.txt")"; }
eq "T23 penolakan down tidak mengubah apa pun (vault 4, status ok)" "$(vault g16 "")|$(sq g16 "select public.fn_prompter_retention_vault_status()->>'ok'")" "4|true"
PGOPTIONS="$PGOPTIONS -c linoe.drop_retention_vault=YA" P -d g16 -c "set role mig4r" -f "$D4R" >/dev/null 2>"$W/e.txt" && bad "T23 down paksa dengan nilai GUC salah lolos" || pass "T23 down paksa dengan nilai GUC yang salah ('YA') ditolak"
downsoft g16 && pass "T23 down-soft berhasil" || bad "T23 down-soft: $(cat "$W/err_down.txt")"
downsoft g16 && pass "T23 down-soft idempoten" || bad "T23 down-soft kedua"
eq "T23 down-soft: vault tetap berisi 4 baris, penjaga vault (2 trigger) dan fungsi status tetap ada" "$(vault g16 "")|$(sq g16 "select count(*) from pg_trigger where tgrelid='public.prompter_retention_vault'::regclass and not tgisinternal")|$(sq g16 "select count(*) from pg_proc where proname='fn_prompter_retention_vault_status'")" "4|2|1"
eq "T23 down-soft: trigger penyalin dan penolak TRUNCATE hilang dari tiga tabel billing; fungsi penyalin hilang" "$(sq g16 "select count(*) from pg_trigger where tgname in ('trg_zz_retention_capture','trg_retention_no_truncate')")|$(sq g16 "select count(*) from pg_proc where proname in ('fn_prompter_retention_vault_capture','fn_prompter_retention_block_truncate')")" "0|0"
eq "T23 down-soft: status().ok=false (penyalinan tidak aktif; 4b-2 tak boleh jalan)" "$(sq g16 "select public.fn_prompter_retention_vault_status()->>'ok'")" false
deltenant g16 "$TB"
eq "T23 down-soft: hapus tenant B kembali seperti sebelum 4r (tanpa salinan baru; vault tetap 4)" "$(vault g16 "")|$(sq g16 "select count(*) from public.tenants where id='$TB'")" "4|0"
up g16 && eq "T23 apply ulang setelah down-soft: isi vault 4 baris dipertahankan, status ok=true" "$(vault g16 "")|$(sq g16 "select public.fn_prompter_retention_vault_status()->>'ok'")" "4|true" || bad "T23 apply ulang: $(cat "$W/err.txt")"
downsoft g16
down g16 && bad "T23 down tanpa GUC lolos setelah down-soft padahal vault berisi" || pass "T23 down biasa tetap menolak setelah down-soft selama vault berisi"
PGOPTIONS="$PGOPTIONS -c linoe.drop_retention_vault=DROP-VAULT-20261128090000" P -d g16 -c "set role mig4r" -f "$D4R" >/dev/null 2>"$W/e.txt" && pass "T23 down paksa (GUC persis) membuang vault" || bad "T23 down paksa: $(cat "$W/e.txt")"
eq "T23 down paksa: katalog kembali ke keadaan awal (vault dan semua fungsi hilang)" "$(sq g16 "$CATCNT")" "$CAT16"

# T24 prasyarat
mk g17; seed g17 1; P -d g17 -c "drop table public.prompter_invoices" >/dev/null
up g17 && bad "T24 apply lolos tanpa tabel prompter_invoices" || { grep -q "DIBATALKAN 4r: tabel prompter_invoices tidak ada" "$W/err.txt" && pass "T24 tabel billing hilang: DIBATALKAN" || bad "T24 sebab lain: $(cat "$W/err.txt")"; }
eq "T24 apply yang dibatalkan tidak meninggalkan objek (vault/trigger/fungsi)" "$(sq g17 "select (to_regclass('public.prompter_retention_vault') is null)::text||':'||(select count(*) from pg_trigger where tgname like '%retention%')||':'||(select count(*) from pg_proc where proname like 'fn_prompter_retention%')")" "true:0:0"
mk g18; seed g18 1
P -d g18 -c "alter table public.prompter_subscriptions owner to mig4r_nb" -c "alter table public.prompter_invoices owner to mig4r_nb" -c "alter table public.prompter_payment_transactions owner to mig4r_nb" -c "revoke select on public.tenants from mig4r_nb" >/dev/null
P -d g18 -c "set role mig4r_nb" -f "$M4R" >/dev/null 2>"$W/err.txt" && bad "T24 apply lolos tanpa SELECT pada tenants" || { grep -q "tidak punya SELECT pada public.tenants" "$W/err.txt" && pass "T24 pemilik migrasi tanpa SELECT pada tenants: DIBATALKAN" || bad "T24 sebab lain: $(cat "$W/err.txt")"; }
eq "T24 tanpa SELECT: tidak ada objek tertinggal" "$(sq g18 "select (to_regclass('public.prompter_retention_vault') is null)::text||':'||(select count(*) from pg_trigger where tgname like '%retention%')")" "true:0"
mk g19; seed g19 1
( PA -d g19 -c "begin" -c "lock table public.prompter_invoices in access exclusive mode" -c "select pg_sleep(7)" -c "commit" >/dev/null 2>&1 ) &
HOLD=$!; for i in $(seq 1 40); do [ "$(sq g19 "select count(*) from pg_locks where relation='public.prompter_invoices'::regclass and mode='AccessExclusiveLock' and granted")" = 1 ] && break; sleep 0.2; done
T0=$(date +%s%N); up g19 && bad "T24 apply lolos padahal tabel dikunci sesi lain" || { grep -qi "lock timeout" "$W/err.txt" && pass "T24 lock_timeout tercapai saat tabel dikunci sesi lain: gagal bersih" || bad "T24 sebab lain: $(cat "$W/err.txt")"; }
MS=$(( ($(date +%s%N)-T0)/1000000 )); [ "$MS" -lt 6500 ] && pass "T24 gagal dalam ${MS} ms (lock_timeout 3 s, tidak menggantung)" || bad "T24 menggantung ${MS} ms"
wait $HOLD
eq "T24 lock_timeout: tidak ada objek sebagian (vault/trigger/fungsi) setelah rollback" "$(sq g19 "select (to_regclass('public.prompter_retention_vault') is null)::text||':'||(select count(*) from pg_trigger where tgname like '%retention%')||':'||(select count(*) from pg_proc where proname like 'fn_prompter_retention%')")" "true:0:0"

# T25 kunci: apply tanpa commit lalu baca pg_locks sesi sendiri; tenants nol kunci selain AccessShare; tiga tabel billing hanya ShareRowExclusive (apply pertama)
python3 - "$M4R" "$W/nocommit.sql" "$W/nocommit_hold.sql" <<'PY'
import sys
src = open(sys.argv[1]).read()
i = src.rindex("commit;")
q = ("select 'TENANTS_NON_ACCESSSHARE=' || count(*) from pg_locks where pid = pg_backend_pid() and relation = 'public.tenants'::regclass and mode <> 'AccessShareLock';\n"
     "select 'BILLING_MODES=' || coalesce(string_agg(distinct mode, ',' order by mode), '-') from pg_locks where pid = pg_backend_pid() and relation in ('public.prompter_subscriptions'::regclass,'public.prompter_invoices'::regclass,'public.prompter_payment_transactions'::regclass) and mode <> 'AccessShareLock';\n")
open(sys.argv[2], "w").write(src[:i] + q + "rollback;\n")
open(sys.argv[3], "w").write(src[:i] + "select pg_sleep(2.5);\nrollback;\n")
PY
mk g20; seed g20 1
LK=$(PA -v ON_ERROR_STOP=1 -d g20 -c "set role mig4r" -f "$W/nocommit.sql" 2>&1 | grep -E "^(TENANTS_NON_ACCESSSHARE|BILLING_MODES)=")
eq "T25 apply: tenants nol kunci selain AccessShare" "$(echo "$LK" | grep TENANTS_NON | cut -d= -f2)" 0
eq "T25 apply pertama: tiga tabel billing hanya ShareRowExclusiveLock (baca tetap jalan; tulis tertahan sebentar)" "$(echo "$LK" | grep BILLING_MODES | cut -d= -f2)" "ShareRowExclusiveLock"
P -d g20 -c "insert into public.tenants(id,nama_usaha) values ('$TC','Tenant C')" -c "insert into public.user_profiles(id,tenant_id,nama,role) values ('33333333-0000-0000-0000-00000000000c','$TC','C','owner')" >/dev/null
( PA -v ON_ERROR_STOP=1 -d g20 -c "set role mig4r" -f "$W/nocommit_hold.sql" >/dev/null 2>&1 ) &
HOLD=$!; for i in $(seq 1 40); do [ "$(sq g20 "select count(*) from pg_locks where relation='public.prompter_invoices'::regclass and mode='ShareRowExclusiveLock' and granted")" -ge 1 ] && break; sleep 0.1; done
T0=$(date +%s%N); RD=$(sq g20 "select count(*) from public.prompter_payment_transactions"); RMS=$(( ($(date +%s%N)-T0)/1000000 ))
[ "$RMS" -lt 1500 ] && pass "T25 SELECT pada tabel billing tidak tertahan selama apply berlangsung (${RMS} ms)" || bad "T25 SELECT tertahan ${RMS} ms"
T0=$(date +%s%N); PA -v ON_ERROR_STOP=1 -d g20 -c "insert into public.prompter_payment_transactions(tenant_id,user_id,provider,plan,amount,currency) values ('$TC','33333333-0000-0000-0000-00000000000c','midtrans','STARTER',99000,'IDR')" >/dev/null 2>"$W/e.txt" && IOK=1 || IOK=0; IMS=$(( ($(date +%s%N)-T0)/1000000 ))
wait $HOLD
[ "$IOK" = 1 ] && [ "$IMS" -ge 500 ] && [ "$IMS" -lt 6000 ] && pass "T25 INSERT transaksi paralel tertahan selama kunci apply (${IMS} ms) lalu lanjut berhasil" || bad "T25 INSERT paralel (ok=$IOK, ${IMS} ms): $(cat "$W/e.txt")"
eq "T25 apply tanpa commit (dibatalkan) tidak meninggalkan objek 4r" "$(sq g20 "select (to_regclass('public.prompter_retention_vault') is null)::text")" true

# ======================================================================================================================
# S6: konkurensi (T27, T28)
# ======================================================================================================================
SVC() { PA -d "$1" -c "set role service_role" -c "$2" 2>&1 | tail -1; }
conc_setup() { # <db> <suffix> : tenant + profil + langganan TRIAL, mengembalikan id tenant
  local T="00000000-0000-0000-0000-00000f04$2"
  PA -d "$1" -c "insert into tenants(id,nama_usaha) values ('$T','C$2')" -c "insert into user_profiles values ('$T','$T','o','owner')" -c "insert into prompter_subscriptions(tenant_id,plan,status,current_period_start,current_period_end) values ('$T','FREE','TRIALING',now()-interval '1 day',now()+interval '13 days')" >/dev/null
  echo "$T"; }
mk gc; up gc || bad "T27 apply"
# 8 tenant x 5 webhook sama (40 sesi) sambil 4 tenant lain dihapus paralel
declare_ids=""; rm -f "$W"/m_* "$W"/z_*
for k in 1 2 3 4 5 6 7 8; do T=$(conc_setup gc "010$k"); IDk=$(SVC gc "select out_transaction_id from public.fn_begin_checkout('$T','$T','STARTER','midtrans')"); declare_ids="$declare_ids $IDk"; done
for z in 1 2 3 4; do
  Z="00000000-0000-0000-0000-00000f05000$z"
  P -d gc -c "set session_replication_role=replica" -c "insert into public.tenants(id,nama_usaha) values ('$Z','Z$z')" -c "insert into public.prompter_subscriptions(tenant_id,plan,status) values ('$Z','STARTER','ACTIVE')" -c "insert into public.prompter_payment_transactions(tenant_id,provider,plan,amount,status) values ('$Z','midtrans','STARTER',99000,'FAILED'),('$Z','midtrans','STARTER',99000,'FAILED')" >/dev/null
done
V0=$(vault gc "")
k=0; for IDk in $declare_ids; do k=$((k+1)); for i in 1 2 3 4 5; do ( SVC gc "select allowed::text||':'||coalesce(reason,'') from public.fn_apply_verified_payment('$IDk','pay_m$k','evt_m$k',99000,'IDR')" > "$W/m_${k}_$i" ) & done; done
for z in 1 2 3 4; do ( PA -d gc -c "delete from public.tenants where id='00000000-0000-0000-0000-00000f05000$z'" >"$W/z_$z" 2>&1 ) & done; wait
okm=$(cat "$W"/m_* | grep -c '^true:$'); alm=$(cat "$W"/m_* | grep -c 'ALREADY_PROCESSED')
{ [ "$okm" = 8 ] && [ "$alm" = 32 ] && ! cat "$W"/m_* "$W"/z_* | grep -qi "deadlock"; } && pass "T27 40 sesi fn_apply_verified_payment (8 tenant x 5) + 4 DELETE tenants paralel: 8 applied + 32 ALREADY_PROCESSED, tanpa deadlock" || bad "T27 paralel (applied=$okm already=$alm; $(cat "$W"/z_* | head -3))"
eq "T27 tepat 1 invoice per transaksi terbayar (8) dan tenant yang dihapus paralel: vault +12 baris (4 x (1 langganan + 2 transaksi) = 12), nol anak yatim" "$(sq gc "select count(*) from public.prompter_invoices where tenant_id::text like '00000000-0000-0000-0000-00000f04010%'")|$(( $(vault gc "") - V0 ))|$(sq gc "select count(*) from public.prompter_payment_transactions where tenant_id::text like '00000000-0000-0000-0000-00000f05000%'")" "8|12|0"
# dua DELETE tenants paralel untuk tenant yang sama: satu menang, vault tidak ganda
mk gc2; seed gc2 1; up gc2; P -d gc2 -c "delete from public.user_profiles where tenant_id='$TA'" >/dev/null
rm -f "$W"/p_*
for i in 1 2; do ( PA -d gc2 -c "with d as (delete from public.tenants where id='$TA' returning 1) select count(*) from d" > "$W/p_$i" 2>&1 ) & done; wait
eq "T27 dua DELETE tenants paralel pada tenant yang sama: satu menang (1+0), tanpa galat" "$(cat "$W"/p_* | sort | tr '\n' ',')" "0,1,"
eq "T27 vault tidak ganda: tepat 4 baris (1 langganan + 1 invoice + 2 transaksi), semua tenant A" "$(vault gc2 "")|$(vault gc2 "where tenant_id='$TA'")" "4|4"
# T28 DELETE tenant bersamaan dengan INSERT checkout PENDING
mk gc3; seed gc3 1; up gc3
P -d gc3 -c "insert into public.tenants(id,nama_usaha) values ('$TC','C')" -c "insert into public.prompter_subscriptions(tenant_id,plan,status) values ('$TC','STARTER','ACTIVE')" -c "insert into public.user_profiles(id,tenant_id,nama,role) values ('33333333-0000-0000-0000-00000000000c','$TC','C','owner')" >/dev/null
UC=33333333-0000-0000-0000-00000000000c
INSP="insert into public.prompter_payment_transactions(tenant_id,user_id,provider,plan,amount,currency) values ('$TC','$UC','midtrans','STARTER',99000,'IDR')"
P -d gc3 -c "delete from public.user_profiles where tenant_id='$TC'" >/dev/null
# (a) DELETE lebih dulu (menahan transaksi), INSERT menyusul: INSERT gagal FK setelah DELETE commit; vault = baris yang terhapus
( PA -v ON_ERROR_STOP=1 -d gc3 -c "begin" -c "delete from public.tenants where id='$TC'" -c "select pg_sleep(2)" -c "commit" >/dev/null 2>&1 ) &
HOLD=$!; sleep 0.6
OUT=$(PS -v ON_ERROR_STOP=1 -d gc3 -c "insert into public.prompter_payment_transactions(tenant_id,provider,plan,amount,currency) values ('$TC','midtrans','STARTER',99000,'IDR')" 2>&1 >/dev/null); wait $HOLD
case "$OUT" in *"foreign key"*|*23503*) pass "T28a DELETE tenant (tertahan) lalu INSERT checkout PENDING: INSERT gagal FK (hasil serial, tanpa baris yatim)";; *) bad "T28a INSERT tidak gagal FK: $OUT";; esac
eq "T28a vault = baris yang benar-benar terhapus (1 langganan) dan tidak ada transaksi yatim" "$(vault gc3 "where tenant_id='$TC'")|$(sq gc3 "select count(*) from public.prompter_payment_transactions where tenant_id='$TC'")" "1|0"
# (b) INSERT lebih dulu (menahan transaksi), DELETE menyusul: DELETE menunggu, lalu men-cascade juga baris baru itu dan menyalinnya
P -d gc3 -c "insert into public.tenants(id,nama_usaha) values ('$TC','C')" -c "insert into public.prompter_subscriptions(tenant_id,plan,status) values ('$TC','STARTER','ACTIVE')" >/dev/null
V1=$(vault gc3 "where tenant_id='$TC'")
( PA -v ON_ERROR_STOP=1 -d gc3 -c "begin" -c "insert into public.prompter_payment_transactions(tenant_id,provider,plan,amount,currency) values ('$TC','midtrans','STARTER',99000,'IDR')" -c "select pg_sleep(2)" -c "commit" >/dev/null 2>&1 ) &
HOLD=$!; sleep 0.6
T0=$(date +%s%N); PS -v ON_ERROR_STOP=1 -d gc3 -c "delete from public.tenants where id='$TC'" >/dev/null 2>"$W/e.txt" && DOK=1 || DOK=0; DMS=$(( ($(date +%s%N)-T0)/1000000 )); wait $HOLD
[ "$DOK" = 1 ] && [ "$DMS" -ge 500 ] && pass "T28b INSERT PENDING (tertahan) lalu DELETE tenant: DELETE menunggu (${DMS} ms) lalu berhasil" || bad "T28b DELETE (ok=$DOK, ${DMS} ms): $(cat "$W/e.txt")"
eq "T28b baris PENDING yang baru ikut ter-cascade dan tersalin (vault +2 = langganan + transaksi), nol anak yatim" "$(( $(vault gc3 "where tenant_id='$TC'") - V1 ))|$(sq gc3 "select count(*) from public.prompter_payment_transactions where tenant_id='$TC'")|$(sq gc3 "select count(*) from public.prompter_retention_vault where tenant_id='$TC' and source_table='prompter_payment_transactions'")" "2|0|1"

# ======================================================================================================================
# S7: regresi suite lama dengan 4r terpasang (T29), skrip reset QA (T30)
# ======================================================================================================================
mk r1; up r1 || bad "T29 apply pada rantai asli"
if (cd "$root/supabase/tests/p0-2-invoices" && PGOPTIONS="-c client_min_messages=notice" P -d r1 -f scenarios.sql >"$W/o1.txt" 2>&1); then pass "T29 skenario P0-2 (suite lama, tanpa diubah) lulus dengan 4r terpasang: $(grep -c 'PASS:' "$W/o1.txt") pemeriksaan"; else bad "T29 skenario P0-2 gagal dengan 4r"; grep -E "FAIL|ERROR" "$W/o1.txt" | head -6; fi
mk r2; up r2 || bad "T29 apply r2"
if (cd "$b2s" && PGOPTIONS="-c client_min_messages=notice" P -d r2 -f scenarios.sql >"$W/o2.txt" 2>&1); then pass "T29 skenario B2 (suite lama, tanpa diubah) lulus dengan 4r terpasang: $(grep -c 'PASS:' "$W/o2.txt") pemeriksaan"; else bad "T29 skenario B2 gagal dengan 4r"; grep -E "FAIL|ERROR" "$W/o2.txt" | head -6; fi
eq "T29 skenario lama menghapus/menyentuh baris billing dengan 4r terpasang: vault diizinkan bertambah, status tetap ok" "$(sq r1 "select public.fn_prompter_retention_vault_status()->>'ok'")|$(sq r2 "select public.fn_prompter_retention_vault_status()->>'ok'")" "true|true"

# T30 skrip reset QA yang ada (delete from public.tenants) tetap berjalan; vault QA tumbuh (diterima)
if command -v node >/dev/null 2>&1; then
  mk r3; up r3
  P -d r3 -c "create table public._linoe_sandbox_marker(purpose text)" -c "insert into public._linoe_sandbox_marker values ('QA2_SANDBOX_ONLY')" \
    -c "create table auth.users(id uuid primary key, email text)" \
    -c "alter table public.user_profiles drop constraint user_profiles_tenant_id_fkey" -c "alter table public.user_profiles add constraint user_profiles_tenant_id_fkey foreign key (tenant_id) references public.tenants(id) on delete cascade" >/dev/null
  QT=dddddddd-0000-0000-0000-00000000000d; QU=44444444-0000-0000-0000-00000000000d
  P -d r3 -c "set session_replication_role=replica" -c "insert into public.tenants(id,nama_usaha) values ('$QT','QA')" -c "insert into auth.users values ('$QU','qa-linoe@example.test')" -c "insert into public.user_profiles(id,tenant_id,nama,role) values ('$QU','$QT','qa','owner')" -c "insert into public.prompter_subscriptions(tenant_id,plan,status) values ('$QT','STARTER','ACTIVE')" -c "insert into public.prompter_payment_transactions(tenant_id,provider,plan,amount,status) values ('$QT','midtrans','STARTER',99000,'FAILED')" >/dev/null
  (cd "$root" && node scripts/qa/print-qa-reset-sql.mjs --ref gasdqsadnjoknisloaec > "$W/qa_reset.sql" 2>"$W/qa_err.txt") || bad "T30 pencetak SQL reset gagal: $(cat "$W/qa_err.txt")"
  P -d r3 -f "$W/qa_reset.sql" >/dev/null 2>"$W/e.txt" && pass "T30 SQL reset QA (dicetak skrip repo) berjalan dengan 4r terpasang" || bad "T30 reset QA gagal: $(cat "$W/e.txt")"
  eq "T30 tenant QA terhapus dan vault QA bertambah (langganan + transaksi = 2) sesuai catatan: vault QA tumbuh" "$(sq r3 "select count(*) from public.tenants where id='$QT'")|$(vault r3 "where tenant_id='$QT'")" "0|2"
else
  bad "T30 node tidak tersedia (dibutuhkan untuk mencetak SQL reset QA)"
fi

# ---------- ringkasan ----------
for d in $(PA -d postgres -c "select datname from pg_database where datname like 'g%' or datname like 'fc' or datname like 'r_' or datname like 'rv_tpl%'"); do P -d postgres -c "drop database if exists $d" >/dev/null 2>&1; done
if [ "$fail" = 0 ]; then echo "ALL PASSED ($npass pemeriksaan)"; else echo "SOME TESTS FAILED"; exit 1; fi
