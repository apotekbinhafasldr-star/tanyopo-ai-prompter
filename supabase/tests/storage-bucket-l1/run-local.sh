#!/usr/bin/env bash
# LOCAL-ONLY Paket 2 L1 (storage bucket hardening) tests on a THROW-AWAY PostgreSQL with SYNTHETIC data. Never touches Supabase.
# Refuses non-local hosts and any credential env var. REQUIRE_PG_MAJOR=17 (set in CI) refuses any other major.
# Real SQL under test: the Phase 1 bucket+policy block (extracted from the repository), the L1 migration, the L1 down,
# and the read-only PRECHECK / POSTCHECK. The storage schema is a stub (supabase/tests/storage-bucket-l1/stub.sql): SANDBOX evidence, not REAL.
set -uo pipefail
HOST="${PGHOST:-/tmp}"; PORT="${PGPORT:-5544}"; USER_="${PGUSER:-postgres}"
case "$HOST" in /*|localhost|127.0.0.1|::1) ;; *) echo "REFUSED: non-local PGHOST=$HOST" >&2; exit 2;; esac
for k in SUPABASE_SECRET_KEY SUPABASE_SERVICE_ROLE_KEY DATABASE_URL POSTGRES_URL TOKEN_ENCRYPTION_KEY; do
  if [ -n "${!k:-}" ]; then echo "REFUSED: $k is set" >&2; exit 2; fi
done
case "${PGDATABASE:-}" in *supabase*|*prod*) echo "REFUSED: PGDATABASE looks like a shared database" >&2; exit 2;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../../.." && pwd)"
MIG="$root/supabase/migrations/20261126100000_prompter_storage_bucket_l1.sql"
DOWN="$root/supabase/rollback/20261126100000_prompter_storage_bucket_l1.down.sql"
PRE="$root/supabase/tools/storage-bucket-l1/PRECHECK.sql"
POST="$root/supabase/tools/storage-bucket-l1/POSTCHECK.sql"
P1M="$root/supabase/migrations/20260829092303_prompter_phase1_schema.sql"
export PGOPTIONS="-c client_min_messages=warning"
PS() { psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q "$@"; }
P() { PS -v ON_ERROR_STOP=1 "$@"; }
PA() { PS -At "$@"; }
W="$(mktemp -d)"; fail=0; pass() { echo "PASS: $*"; }; bad() { echo "FAIL: $*"; fail=1; }
SRV=$(PA -d postgres -c "show server_version_num")
if [ -n "${REQUIRE_PG_MAJOR:-}" ]; then
  [ $((SRV/10000)) = "$REQUIRE_PG_MAJOR" ] || { echo "REFUSED: server_version_num=$SRV is not PostgreSQL $REQUIRE_PG_MAJOR" >&2; exit 2; }
  echo "PostgreSQL major $REQUIRE_PG_MAJOR confirmed (server_version_num=$SRV)"
fi
echo "SANDBOX: PostgreSQL server_version_num=$SRV, stub storage schema (bukan Supabase nyata)"

# real Phase 1 block: buckets insert + FOR ALL policy, extracted verbatim
python3 - "$P1M" "$W/phase1_storage.sql" <<'PY'
import sys
s = open(sys.argv[1]).read()
a = s.index("insert into storage.buckets")
end = "= public.fn_current_tenant_id()::text\n  );"
b = s.index(end, s.index('create policy "Tenant kelola file marketing miliknya sendiri"')) + len(end)
open(sys.argv[2], "w").write(s[a:b] + "\n")
PY
[ -s "$W/phase1_storage.sql" ] && pass "blok storage Phase 1 diekstrak dari repositori" || bad "ekstraksi gagal"

TA=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa; TB=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb
mk() { P -d postgres -c "drop database if exists $1" -c "create database $1" >/dev/null && P -d "$1" -f "$here/stub.sql" >/dev/null && P -d "$1" -f "$W/phase1_storage.sql" >/dev/null; }
up() { P -1 -d "$1" -f "$MIG" >/dev/null 2>"$W/err.txt"; }
down() { P -1 -d "$1" -f "$DOWN" >/dev/null; }
STATE="select md5(coalesce((select string_agg(concat_ws(':',id,public::text,file_size_limit::text,array_to_string(allowed_mime_types,',')),'|' order by id) from storage.buckets),'') || '#' || coalesce((select string_agg(concat_ws('/',policyname,cmd,permissive,array_to_string(roles,','),coalesce(qual,''),coalesce(with_check,'')),'|' order by policyname) from pg_policies where schemaname='storage' and tablename='objects'),''))"
# run as tenant: stmt returns row count (RLS-filtered DML) or "ERR" when RLS rejects an INSERT
as_tenant() { local db="$1" t="$2" sql="$3"; PA -v ON_ERROR_STOP=1 -d "$db" -c "set role authenticated" -c "set app.tenant='$t'" -c "$sql" 2>/dev/null || echo ERR; }
ins() { as_tenant "$1" "$2" "with i as (insert into storage.objects(bucket_id,name) values ('$3','$4') returning 1) select count(*) from i"; }
upd() { as_tenant "$1" "$2" "with u as (update storage.objects set owner=gen_random_uuid() where bucket_id='$3' and name='$4' returning 1) select count(*) from u"; }
del() { as_tenant "$1" "$2" "with d as (delete from storage.objects where bucket_id='$3' and name='$4' returning 1) select count(*) from d"; }
sel() { as_tenant "$1" "$2" "select count(*) from storage.objects where bucket_id='$3' and name='$4'"; }
eq() { [ "$2" = "$3" ] && pass "$1" || bad "$1 (got '$2', want '$3')"; }

# ---------- S1: bucket kosong -> up ----------
mk l1_s1 || bad "S1 setup"
BEFORE=$(PA -d l1_s1 -c "$STATE")
PA -d l1_s1 -F'|' -f "$PRE" > "$W/pre_s1.txt"
grep -q '^Q0|.*|LANJUT$' "$W/pre_s1.txt" && pass "S1 PRECHECK Q0 LANJUT (tidak ada policy pihak lain)" || bad "S1 Q0: $(grep '^Q0' "$W/pre_s1.txt")"
grep -q '^Q4:creative-assets|.*|0|LANJUT$' "$W/pre_s1.txt" && pass "S1 PRECHECK Q4 0 objek" || bad "S1 Q4"
grep -q '^Q8|.*|LANJUT$' "$W/pre_s1.txt" && pass "S1 PRECHECK Q8 keadaan awal benar" || bad "S1 Q8: $(grep '^Q8' "$W/pre_s1.txt")"
grep -q '^Q7|.*|UNKNOWN$' "$W/pre_s1.txt" && pass "S1 PRECHECK Q7 UNKNOWN tanpa role linoe_migrator" || bad "S1 Q7: $(grep '^Q7' "$W/pre_s1.txt")"
# seed an object in product-media of tenant A BEFORE up (must survive)
PA -d l1_s1 -c "insert into storage.objects(bucket_id,name) values ('product-media','$TA/lama.png')" >/dev/null
up l1_s1 && pass "S1 up berhasil (bucket cadangan kosong)" || bad "S1 up: $(cat "$W/err.txt")"
eq "S1 tiga bucket cadangan privat" "$(PA -d l1_s1 -c "select count(*) from storage.buckets where id in ('creative-assets','brand-assets','generated-content') and public=false")" 3
eq "S1 product-media tetap publik" "$(PA -d l1_s1 -c "select public from storage.buckets where id='product-media'")" t
eq "S1 batas+mime tidak berubah" "$(PA -d l1_s1 -c "select md5(string_agg(concat_ws(':',id,file_size_limit::text,array_to_string(allowed_mime_types,',')),'|' order by id)) from storage.buckets")" "$(PA -d l1_s1 -c "select md5(string_agg(concat_ws(':',id,file_size_limit::text,array_to_string(allowed_mime_types,',')),'|' order by id)) from storage.buckets")"
eq "S1 policy lama FOR ALL hilang" "$(PA -d l1_s1 -c "select count(*) from pg_policies where schemaname='storage' and cmd='ALL'")" 0
eq "S1 empat policy baru" "$(PA -d l1_s1 -c "select string_agg(cmd,',' order by cmd) from pg_policies where schemaname='storage' and tablename='objects'")" "DELETE,INSERT,SELECT,UPDATE"
eq "S1 tenant A unggah ke product-media folder sendiri" "$(ins l1_s1 $TA product-media "$TA/baru.png")" 1
eq "S1 tenant A DITOLAK unggah ke creative-assets" "$(ins l1_s1 $TA creative-assets "$TA/x.png")" ERR
eq "S1 tenant A DITOLAK unggah ke brand-assets" "$(ins l1_s1 $TA brand-assets "$TA/x.png")" ERR
eq "S1 tenant A DITOLAK unggah ke generated-content" "$(ins l1_s1 $TA generated-content "$TA/x.png")" ERR
eq "S1 tenant A DITOLAK unggah ke folder tenant B" "$(ins l1_s1 $TA product-media "$TB/x.png")" ERR
PA -d l1_s1 -c "insert into storage.objects(bucket_id,name) values ('product-media','$TB/b.png')" >/dev/null
eq "S1 tenant A tidak melihat objek tenant B" "$(sel l1_s1 $TA product-media "$TB/b.png")" 0
eq "S1 tenant A melihat objek lama sendiri" "$(sel l1_s1 $TA product-media "$TA/lama.png")" 1
eq "S1 tenant A ubah objek sendiri (UPDATE sengaja dipertahankan)" "$(upd l1_s1 $TA product-media "$TA/lama.png")" 1
eq "S1 tenant A tidak bisa ubah objek tenant B" "$(upd l1_s1 $TA product-media "$TB/b.png")" 0
eq "S1 tenant A hapus objek sendiri" "$(del l1_s1 $TA product-media "$TA/baru.png")" 1
eq "S1 tenant A tidak bisa hapus objek tenant B" "$(del l1_s1 $TA product-media "$TB/b.png")" 0
eq "S1 anon tidak bisa unggah" "$(PA -v ON_ERROR_STOP=1 -d l1_s1 -c "set role anon" -c "insert into storage.objects(bucket_id,name) values ('product-media','$TA/z.png')" 2>/dev/null && echo OK || echo ERR)" ERR
# POSTCHECK with values from PRECHECK
val() { grep "^$1|" "$W/pre_s1.txt" | awk -F'|' '{print $3}'; }
Q1=$(val Q1); Q2=$(val Q2 | sed -E 's/.*md5_batas_mime_empat_bucket=([0-9a-f]{32}).*/\1/'); Q5=$(val Q5); Q6=$(val Q6); Q0=$(val Q0 | sed -E 's/.*md5_daftar=([^;]*);.*/\1/')
sed -e "s/'ISI_Q1'/'$Q1'/" -e "s/'ISI_Q0'/'$Q0'/" -e "s/'ISI_Q2'/'$Q2'/" -e "s/'ISI_Q5'/'$Q5'/" -e "s/'ISI_Q6'/'$Q6'/" "$POST" > "$W/post_s1.sql"
PA -d l1_s1 -F'|' -f "$W/post_s1.sql" > "$W/post_s1.txt"
for p in P1 P2 P3 P4 P5 P6 P7 P8 P9; do grep -q "^$p|.*|PASS$" "$W/post_s1.txt" && pass "S1 POSTCHECK $p PASS" || bad "S1 POSTCHECK $p: $(grep "^$p|" "$W/post_s1.txt")"; done
grep -q '^P10|.*|UNKNOWN' "$W/post_s1.txt" && pass "S1 POSTCHECK P10 UNKNOWN (uji manual)" || bad "S1 P10"
PA -d l1_s1 -F'|' -f "$POST" | grep -q '^P3|.*|UNKNOWN$' && pass "S1 POSTCHECK tanpa placeholder terisi -> UNKNOWN, bukan PASS" || bad "S1 placeholder"

# ---------- S2: objek di bucket cadangan -> up harus menolak ----------
mk l1_s2; PA -d l1_s2 -c "insert into storage.objects(bucket_id,name) values ('brand-assets','$TA/logo.png')" >/dev/null
S2B=$(PA -d l1_s2 -c "$STATE"); PA -d l1_s2 -F'|' -f "$PRE" > "$W/pre_s2.txt"
grep -q '^Q4:brand-assets|.*|1|BERHENTI$' "$W/pre_s2.txt" && pass "S2 PRECHECK Q4 brand-assets=1 BERHENTI" || bad "S2 Q4"
up l1_s2 && bad "S2 up seharusnya ditolak" || { grep -q "L1 BERHENTI" "$W/err.txt" && pass "S2 up ditolak dengan pesan L1 BERHENTI" || bad "S2 pesan salah: $(cat "$W/err.txt")"; }
eq "S2 tidak ada perubahan setelah penolakan (bucket+policy)" "$(PA -d l1_s2 -c "$STATE")" "$S2B"
eq "S2 objek tetap ada" "$(PA -d l1_s2 -c "select count(*) from storage.objects where bucket_id='brand-assets'")" 1

# ---------- S3: idempoten ----------
mk l1_s3; up l1_s3 && S3A=$(PA -d l1_s3 -c "$STATE") && up l1_s3 && S3B=$(PA -d l1_s3 -c "$STATE") && eq "S3 up dua kali = keadaan sama" "$S3B" "$S3A" || bad "S3 up berulang"
up l1_s3 && eq "S3 up ketiga kali tetap sama" "$(PA -d l1_s3 -c "$STATE")" "$S3A" || bad "S3 up ketiga"

# ---------- S4: down memulihkan persis ----------
mk l1_s4; S4A=$(PA -d l1_s4 -c "$STATE"); up l1_s4 && down l1_s4 && eq "S4 down memulihkan bucket+policy persis seperti Phase 1" "$(PA -d l1_s4 -c "$STATE")" "$S4A" || bad "S4 up/down"
down l1_s4 && eq "S4 down idempoten" "$(PA -d l1_s4 -c "$STATE")" "$S4A" || bad "S4 down kedua"
eq "S4 setelah down tenant A bisa menulis ke creative-assets lagi (keadaan semula)" "$(ins l1_s4 $TA creative-assets "$TA/r.png")" 1
up l1_s4 2>/dev/null; PA -d l1_s4 -c "delete from storage.objects where bucket_id='creative-assets'" >/dev/null
up l1_s4 && eq "S4 up setelah down dan pembersihan sandbox OK" "$(PA -d l1_s4 -c "select count(*) from storage.buckets where public=false")" 3 || bad "S4 re-up"

# ---------- S5/S12: policy pihak lain tanpa bucket_id ----------
mk l1_s5
PA -d l1_s5 -c "create policy \"pihak lain bebas tulis\" on storage.objects for all to authenticated using (true) with check (true)" -c "create policy \"mitra baca publik\" on storage.objects for select using (bucket_id = 'publoe-files')" -c "create policy \"mitra tulis\" on storage.objects for insert to authenticated with check (bucket_id = 'mitapeng-files')" >/dev/null
S5O=$(PA -d l1_s5 -c "select md5(string_agg(concat_ws('/',policyname,cmd,permissive,array_to_string(roles,','),coalesce(qual,''),coalesce(with_check,'')),'|' order by policyname)) from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('pihak lain bebas tulis','mitra baca publik','mitra tulis')")
PA -d l1_s5 -F'|' -f "$PRE" > "$W/pre_s5.txt"
grep -q '^Q0|.*tanpa_bucket_id=1;.*|LANJUT-DENGAN-CATATAN$' "$W/pre_s5.txt" && pass "S12 PRECHECK Q0 LANJUT-DENGAN-CATATAN (tepat 1 policy tanpa bucket_id)" || bad "S12 Q0: $(grep '^Q0' "$W/pre_s5.txt")"
grep -q '^Q0|L1 TIDAK menutup/menyentuh' <(sed 's/^\(Q0|\)Policy PERMISSIVE[^|]*(L1/\1L1/' "$W/pre_s5.txt") || grep -q 'L1 TIDAK menutup/menyentuh policy itu; tenant masih bisa menulis ke bucket cadangan' "$W/pre_s5.txt" && pass "S12 teks catatan eksplisit ada" || bad "S12 teks catatan"
up l1_s5 && pass "S12 up berhasil dengan policy pihak lain" || bad "S12 up: $(cat "$W/err.txt")"
eq "S12 policy pihak lain tidak disentuh" "$(PA -d l1_s5 -c "select md5(string_agg(concat_ws('/',policyname,cmd,permissive,array_to_string(roles,','),coalesce(qual,''),coalesce(with_check,'')),'|' order by policyname)) from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('pihak lain bebas tulis','mitra baca publik','mitra tulis')")" "$S5O"
eq "S12 tenant A MASIH bisa menulis ke bucket cadangan lewat policy pihak lain (risiko tidak ditutup L1)" "$(ins l1_s5 $TA creative-assets "$TA/s12.png")" 1
Q0=$(grep '^Q0|' "$W/pre_s5.txt" | awk -F'|' '{print $3}' | sed -E 's/.*md5_daftar=([^;]*);.*/\1/')
sed -e "s/'ISI_Q0'/'$Q0'/" "$POST" > "$W/post_s5.sql"; PA -d l1_s5 -F'|' -f "$W/post_s5.sql" > "$W/post_s5.txt"
grep -q '^P9|.*|PASS-DENGAN-CATATAN$' "$W/post_s5.txt" && pass "S12 POSTCHECK P9 PASS-DENGAN-CATATAN (daftar sama dengan Q0)" || bad "S12 P9: $(grep '^P9' "$W/post_s5.txt")"
sed -e "s/'ISI_Q0'/'KOSONG'/" "$POST" > "$W/post_s5b.sql"; PA -d l1_s5 -F'|' -f "$W/post_s5b.sql" | grep -q '^P9|.*|TINJAU$' && pass "S12 POSTCHECK P9 TINJAU bila policy tanpa bucket_id baru muncul" || bad "S12 P9 TINJAU"
down l1_s5 && eq "S12 down juga tidak menyentuh policy pihak lain" "$(PA -d l1_s5 -c "select md5(string_agg(concat_ws('/',policyname,cmd,permissive,array_to_string(roles,','),coalesce(qual,''),coalesce(with_check,'')),'|' order by policyname)) from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('pihak lain bebas tulis','mitra baca publik','mitra tulis')")" "$S5O" || bad "S12 down"

# ---------- S6: policy pihak lain menyebut bucket LINOE -> PRECHECK BERHENTI ----------
mk l1_s6; PA -d l1_s6 -c "create policy \"pihak lain tulis creative\" on storage.objects for insert to authenticated with check (bucket_id = 'creative-assets')" >/dev/null
PA -d l1_s6 -F'|' -f "$PRE" | grep -q '^Q0|.*|BERHENTI$' && pass "S6 PRECHECK Q0 BERHENTI (pihak lain menyebut bucket LINOE)" || bad "S6 Q0"

# ---------- S7: bucket cadangan tidak ada / sebagian publik ----------
mk l1_s7; PA -d l1_s7 -c "delete from storage.buckets where id='brand-assets'" -c "update storage.buckets set public=false where id='generated-content'" >/dev/null
up l1_s7 && eq "S7 bucket hilang dilewati, sisanya privat, tidak ada bucket baru dibuat" "$(PA -d l1_s7 -c "select string_agg(id||':'||public::text,',' order by id) from storage.buckets")" "creative-assets:false,generated-content:false,product-media:true" || bad "S7 up"

# ---------- S8: kunci tabel diambil sebelum hitung objek ----------
mk l1_s8
LOCKS=$(PA -d l1_s8 -c "begin; set local lock_timeout='3s'; drop policy if exists \"Tenant kelola file marketing miliknya sendiri\" on storage.objects; select string_agg(mode,',') from pg_locks where relation='storage.objects'::regclass and pid=pg_backend_pid(); rollback;" | grep AccessExclusiveLock | head -1)
[ -n "$LOCKS" ] && pass "S8 DROP POLICY mengambil AccessExclusiveLock pada storage.objects (hitung objek di bawah kunci yang sama)" || bad "S8 kunci"

# ---------- S9: tidak ada DDL/DML di PRECHECK dan POSTCHECK ----------
for f in "$PRE" "$POST"; do
  grep -viE '^\s*--' "$f" | grep -qiE '\b(insert into|update [a-z_."]+ set|delete from|drop |create |alter |truncate|grant |revoke )' && bad "S9 $(basename "$f") mengandung DDL/DML" || pass "S9 $(basename "$f") read-only (tanpa DDL/DML)"
done

[ "$fail" = 0 ] && echo "ALL PASSED" || echo "SOME FAILED"
exit $fail
