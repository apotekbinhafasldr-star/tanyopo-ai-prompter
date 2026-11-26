#!/usr/bin/env bash
# LOCAL-ONLY tes Paket 3 (Consent & Audit Guard) pada PostgreSQL SEMENTARA dengan data SINTETIS. Tidak pernah menyentuh Supabase.
# Menolak host non-lokal dan env kredensial apa pun. REQUIRE_PG_MAJOR=17 (CI) menolak major lain.
# SQL yang diuji: migrasi + down asli dari repositori; blok tabel prompter_audit_logs diekstrak apa adanya dari migrasi foundation.
# Skema Supabase (auth, tenants, role) adalah STUB: bukti kelas SANDBOX, bukan REAL.
set -uo pipefail
HOST="${PGHOST:-/tmp}"; PORT="${PGPORT:-5544}"; USER_="${PGUSER:-postgres}"
case "$HOST" in /*|localhost|127.0.0.1|::1) ;; *) echo "REFUSED: non-local PGHOST=$HOST" >&2; exit 2;; esac
for k in SUPABASE_SECRET_KEY SUPABASE_SERVICE_ROLE_KEY DATABASE_URL POSTGRES_URL TOKEN_ENCRYPTION_KEY; do
  if [ -n "${!k:-}" ]; then echo "REFUSED: $k is set" >&2; exit 2; fi
done
case "${PGDATABASE:-}" in *supabase*|*prod*) echo "REFUSED: PGDATABASE looks like a shared database" >&2; exit 2;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../../.." && pwd)"
MIG="$root/supabase/migrations/20261127100000_prompter_consent_audit_guard.sql"
DOWN="$root/supabase/rollback/20261127100000_prompter_consent_audit_guard.down.sql"
FOUND="$root/supabase/migrations/20260829080127_prompter_foundation_schema.sql"
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
echo "SANDBOX: PostgreSQL server_version_num=$SRV, stub auth/tenants (bukan Supabase nyata)"

python3 - "$FOUND" "$W/audit_table.sql" <<'PY'
import sys
s = open(sys.argv[1]).read()
a = s.index("create table public.prompter_audit_logs")
end_marker = 'create policy "Tulis audit log sebagai diri sendiri"'
b = s.index(");", s.index("with check (", s.index(end_marker))) 
b = s.index(");\n", b) + 2
open(sys.argv[2], "w").write(s[a:b] + "\n")
PY
[ -s "$W/audit_table.sql" ] && pass "blok prompter_audit_logs diekstrak dari migrasi foundation" || bad "ekstraksi gagal"

TA=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa; TB=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb
UA=11111111-1111-1111-1111-111111111111; UB=22222222-2222-2222-2222-222222222222
# mk: DB baru + stub + tabel audit asli + hak default gaya Supabase (ALL untuk role klien) + data sintetis
mk() {
  P -d postgres -c "drop database if exists $1" -c "create database $1" >/dev/null || return 1
  P -d "$1" -f "$here/stub.sql" >/dev/null || return 1
  P -d "$1" -f "$W/audit_table.sql" >/dev/null || return 1
  P -d "$1" -c "grant all on public.prompter_audit_logs to anon, authenticated, service_role" \
    -c "insert into public.tenants(id,nama_usaha) values ('$TA','A'),('$TB','B')" \
    -c "insert into auth.users(id,email) values ('$UA','a@x.test'),('$UB','b@x.test')" \
    -c "insert into public.user_profiles(id,tenant_id) values ('$UA','$TA'),('$UB','$TB')" \
    -c "insert into public.prompter_audit_logs(tenant_id,actor_user_id,action,resource_type) values ('$TA','$UA','t.a1','x'),('$TA','$UA','t.a2','x'),('$TB','$UB','t.b1','x')" >/dev/null
}
up() { P -d "$1" -f "$MIG" >/dev/null 2>"$W/err.txt"; }
down() { P -d "$1" -f "$DOWN" >/dev/null 2>"$W/err_down.txt"; }
# jalankan sebagai role + pengguna; keluaran = hasil atau ERR
as() { local db="$1" role="$2" uid="$3" sql="$4"; PA -v ON_ERROR_STOP=1 -d "$db" -c "set role $role" -c "set app.uid='$uid'" -c "set app.tenant='${TEN:-}'" -c "$sql" 2>"$W/as_err.txt" || echo ERR; }
asr() { local out; out=$(as "$@"); [ -n "$out" ] && echo "$out" || echo OK; }   # OK bila tanpa keluaran dan tanpa galat
eq() { [ "$2" = "$3" ] && pass "$1" || bad "$1 (got '$2', want '$3')"; }
ERRIS() { case "$2" in *ERR*) pass "$1";; *) bad "$1 (got '$2')";; esac; }
SNAP="select md5(coalesce((select string_agg(concat_ws(':',proname,md5(prosrc),prosecdef::text),'|' order by proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like 'fn_prompter_%'),'') || '#' || coalesce((select string_agg(tgname||':'||tgrelid::regclass::text,'|' order by tgname,tgrelid::regclass::text) from pg_trigger where not tgisinternal),'') || '#' || coalesce((select string_agg(concat_ws('/',tablename,policyname,cmd),'|' order by tablename,policyname) from pg_policies where schemaname='public'),'') || '#' || (select count(*)::text from public.prompter_consent_catalog) || '#' || (select count(*)::text from public.prompter_consent_settings) || '#' || (select string_agg(table_name||':'||grantee||':'||privilege_type,'|' order by table_name,grantee,privilege_type) from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated','service_role')))"
PROT="select md5(coalesce((select string_agg(id::text||nama_usaha,'|' order by id) from public.tenants),'') || (select string_agg(id::text||email,'|' order by id) from auth.users) || (select string_agg(id::text||tenant_id::text,'|' order by id) from public.user_profiles))"
AUD="select md5(string_agg(id::text||action||tenant_id::text,'|' order by id)) from public.prompter_audit_logs"

# ---------- S1: up, isi katalog, idempoten ----------
mk g1 || bad "S1 setup"
PROT_B=$(PA -d g1 -c "$PROT"); AUD_B=$(PA -d g1 -c "$AUD")
up g1 && pass "S1 up berhasil" || bad "S1 up: $(cat "$W/err.txt")"
eq "S1 katalog v1 berisi lima kode" "$(PA -d g1 -c "select count(*) from public.prompter_consent_catalog")" 5
eq "S1 hanya CONNECT_META dan CONNECT_TIKTOK aktif" "$(PA -d g1 -c "select string_agg(code,',' order by code) from public.prompter_consent_catalog where active")" "CONNECT_META,CONNECT_TIKTOK"
eq "S1 text_sha256 = sha256 teks (dihitung ulang)" "$(PA -d g1 -c "select count(*) from public.prompter_consent_catalog where text_sha256 = encode(sha256(convert_to(text_id,'UTF8')),'hex')")" 5
eq "S1 parameter retensi NULL (tidak ada angka)" "$(PA -d g1 -c "select coalesce(value,'NULL') from public.prompter_consent_settings where key='evidence_retention_months'")" NULL
eq "S1 auth.users/tenants/user_profiles tidak berubah" "$(PA -d g1 -c "$PROT")" "$PROT_B"
eq "S1 baris audit tidak berubah" "$(PA -d g1 -c "$AUD")" "$AUD_B"
S1A=$(PA -d g1 -c "$SNAP"); up g1 && eq "S1 up kedua = keadaan sama (idempoten)" "$(PA -d g1 -c "$SNAP")" "$S1A" || bad "S1 up kedua"
up g1 && eq "S1 up ketiga = keadaan sama" "$(PA -d g1 -c "$SNAP")" "$S1A" || bad "S1 up ketiga"
eq "S1 retain_until nullable tanpa default" "$(PA -d g1 -c "select count(*) from information_schema.columns where table_name in ('prompter_consent_events','prompter_legal_document_events') and column_name='retain_until' and is_nullable='YES' and column_default is null")" 2

# ---------- S2: guard audit (UPDATE/DELETE/TRUNCATE) ----------
for r in anon authenticated service_role; do
  eq "S2 $r tanpa hak UPDATE/DELETE/TRUNCATE pada prompter_audit_logs" "$(PA -d g1 -c "select count(*) from information_schema.role_table_grants where table_name='prompter_audit_logs' and grantee='$r' and privilege_type in ('UPDATE','DELETE','TRUNCATE')")" 0
done
eq "S2 authenticated masih bisa INSERT audit (policy lama utuh)" "$(TEN=$TA as g1 authenticated $UA "with i as (insert into public.prompter_audit_logs(tenant_id,actor_user_id,action,resource_type) values ('$TA','$UA','t.ins','x') returning 1) select count(*) from i")" 1
eq "S2 service_role masih bisa INSERT audit" "$(as g1 service_role '' "with i as (insert into public.prompter_audit_logs(tenant_id,action,resource_type) values ('$TA','t.svc','x') returning 1) select count(*) from i")" 1
ERRIS "S2 authenticated UPDATE audit ditolak (hak)" "$(as g1 authenticated $UA "update public.prompter_audit_logs set action='x'")"
ERRIS "S2 service_role DELETE audit ditolak (hak)" "$(as g1 service_role '' "delete from public.prompter_audit_logs")"
ERRIS "S2 service_role TRUNCATE audit ditolak (hak)" "$(as g1 service_role '' "truncate public.prompter_audit_logs")"
# lapis kedua: trigger menolak walau hak dikembalikan, dan menolak pemilik/superuser
PA -d g1 -c "grant update, delete, truncate on public.prompter_audit_logs to service_role" >/dev/null
ERRIS "S2 trigger menolak UPDATE service_role walau hak dikembalikan" "$(as g1 service_role '' "update public.prompter_audit_logs set action='x'")"
ERRIS "S2 trigger menolak DELETE service_role walau hak dikembalikan" "$(as g1 service_role '' "delete from public.prompter_audit_logs where tenant_id='$TA'")"
ERRIS "S2 trigger menolak TRUNCATE service_role walau hak dikembalikan" "$(as g1 service_role '' "truncate public.prompter_audit_logs")"
PA -d g1 -c "revoke update, delete, truncate on public.prompter_audit_logs from service_role" >/dev/null
ERRIS "S2 pemilik/superuser UPDATE ditolak trigger" "$(PA -v ON_ERROR_STOP=1 -d g1 -c "update public.prompter_audit_logs set action='x'" 2>/dev/null || echo ERR)"
ERRIS "S2 pemilik DELETE baris tenant yang masih ada ditolak" "$(PA -v ON_ERROR_STOP=1 -d g1 -c "delete from public.prompter_audit_logs where tenant_id='$TA'" 2>/dev/null || echo ERR)"
ERRIS "S2 pemilik TRUNCATE ditolak" "$(PA -v ON_ERROR_STOP=1 -d g1 -c "truncate public.prompter_audit_logs" 2>/dev/null || echo ERR)"
eq "S2 baris audit tidak berubah setelah semua percobaan (3 awal + 2 INSERT sah)" "$(PA -d g1 -c "select count(*) from public.prompter_audit_logs")" 5
eq "S2 pemilik dapat menonaktifkan trigger lalu mengubah (jujur: bukan immutable)" "$(PA -v ON_ERROR_STOP=1 -d g1 -c "begin" -c "alter table public.prompter_audit_logs disable trigger trg_prompter_audit_logs_guard" -c "with u as (update public.prompter_audit_logs set action='t.svc' where action='t.svc' returning 1) select count(*) from u" -c "rollback" 2>/dev/null | tail -1)" 1
eq "S2 cascade hapus tenant B berhasil" "$(PA -v ON_ERROR_STOP=1 -d g1 -c "delete from public.user_profiles where tenant_id='$TB'" -c "delete from public.tenants where id='$TB'" 2>/dev/null && echo OK || echo ERR)" OK
eq "S2 audit tenant B terhapus oleh cascade" "$(PA -d g1 -c "select count(*) from public.prompter_audit_logs where tenant_id='$TB'")" 0
eq "S2 audit tenant A utuh" "$(PA -d g1 -c "select count(*) from public.prompter_audit_logs where tenant_id='$TA'")" 4

# ---------- S3: persetujuan (RLS, fungsi, hak) ----------
mk g3; up g3
eq "S3 pengguna A memberi CONNECT_META: changed" "$(as g3 authenticated $UA "select (public.fn_prompter_consent_set('CONNECT_META','GRANTED','SETTINGS'))->>'changed'")" true
eq "S3 pemberian ulang tidak membuat baris baru" "$(as g3 authenticated $UA "select (public.fn_prompter_consent_set('CONNECT_META','GRANTED','SETTINGS'))->>'changed'")" false
eq "S3 satu baris GRANTED tersimpan" "$(PA -d g3 -c "select count(*)||':'||min(version)||':'||coalesce(min(tenant_id::text),'null') from public.prompter_consent_events")" "1:1:null"
eq "S3 pengguna B tidak melihat peristiwa A (RLS)" "$(as g3 authenticated $UB "select count(*) from public.prompter_consent_events")" 0
eq "S3 pengguna A melihat peristiwa miliknya" "$(as g3 authenticated $UA "select count(*) from public.prompter_consent_events")" 1
eq "S3 status A" "$(as g3 authenticated $UA "select string_agg(code||'='||status,',' order by code) from public.fn_prompter_consent_my_status()")" "CONNECT_META=GRANTED,CONNECT_TIKTOK=NOT_GIVEN"
eq "S3 status B: semua NOT_GIVEN" "$(as g3 authenticated $UB "select string_agg(status,',') from public.fn_prompter_consent_my_status()")" "NOT_GIVEN,NOT_GIVEN"
ERRIS "S3 kode nonaktif ditolak untuk GRANTED" "$(as g3 authenticated $UA "select public.fn_prompter_consent_set('MARKETING_COMMS','GRANTED','SETTINGS')")"
ERRIS "S3 kode tidak dikenal ditolak" "$(as g3 authenticated $UA "select public.fn_prompter_consent_set('NOPE_CODE','GRANTED','SETTINGS')")"
ERRIS "S3 source REGISTER tidak dapat dipakai klien" "$(as g3 authenticated $UA "select public.fn_prompter_consent_set('CONNECT_META','WITHDRAWN','REGISTER')")"
ERRIS "S3 tanpa sesi (auth.uid null) ditolak" "$(as g3 authenticated '' "select public.fn_prompter_consent_set('CONNECT_META','GRANTED','SETTINGS')")"
ERRIS "S3 anon tidak dapat memanggil consent_set" "$(as g3 anon '' "select public.fn_prompter_consent_set('CONNECT_META','GRANTED','SETTINGS')")"
ERRIS "S3 authenticated tidak dapat INSERT langsung" "$(as g3 authenticated $UA "insert into public.prompter_consent_events(subject_user_id,code,version,action,source) values ('$UA','CONNECT_META',1,'GRANTED','SETTINGS')")"
ERRIS "S3 authenticated tidak dapat UPDATE langsung" "$(as g3 authenticated $UA "update public.prompter_consent_events set action='WITHDRAWN'")"
ERRIS "S3 authenticated tidak dapat DELETE langsung" "$(as g3 authenticated $UA "delete from public.prompter_consent_events")"
ERRIS "S3 authenticated tidak dapat TRUNCATE" "$(as g3 authenticated $UA "truncate public.prompter_consent_events")"
ERRIS "S3 authenticated tidak dapat membaca tabel settings" "$(as g3 authenticated $UA "select * from public.prompter_consent_settings")"
eq "S3 penarikan: changed" "$(as g3 authenticated $UA "select (public.fn_prompter_consent_set('CONNECT_META','WITHDRAWN','SETTINGS'))->>'changed'")" true
eq "S3 penarikan ulang tidak membuat baris" "$(as g3 authenticated $UA "select (public.fn_prompter_consent_set('CONNECT_META','WITHDRAWN','SETTINGS'))->>'changed'")" false
eq "S3 penarikan tanpa catatan: NO_RECORD" "$(as g3 authenticated $UB "select (public.fn_prompter_consent_set('CONNECT_META','WITHDRAWN','SETTINGS'))->>'status'")" NO_RECORD
eq "S3 riwayat A = GRANTED lalu WITHDRAWN (append-only)" "$(PA -d g3 -c "select string_agg(action,',' order by occurred_at,id) from public.prompter_consent_events where subject_user_id='$UA'")" "GRANTED,WITHDRAWN"
chk() { as g3 service_role '' "select public.fn_prompter_consent_check('$1','$2')->>'reason'"; }
eq "S3 check: sudah ditarik" "$(chk $UA CONNECT_META)" WITHDRAWN
eq "S3 check: tanpa catatan (koneksi lama) = NO_RECORD" "$(chk $UB CONNECT_META)" NO_RECORD
eq "S3 check: kode nonaktif" "$(chk $UA MARKETING_COMMS)" INACTIVE_CODE
eq "S3 check: kode tidak dikenal" "$(chk $UA NOPE_CODE)" UNKNOWN_CODE
as g3 authenticated $UB "select public.fn_prompter_consent_set('CONNECT_META','GRANTED','CONNECT_FLOW')" >/dev/null
eq "S3 check: GRANTED" "$(chk $UB CONNECT_META)" GRANTED
PA -d g3 -c "insert into public.prompter_consent_catalog(code,version,text_id,purpose_id,active,text_sha256) values ('CONNECT_META',2,'Teks versi dua yang sudah berubah secara substansial.','Koneksi Meta',true,repeat('a',64))" >/dev/null
eq "S3 check: versi katalog naik -> VERSION_OUTDATED" "$(chk $UB CONNECT_META)" VERSION_OUTDATED
eq "S3 versi lama tetap tersimpan" "$(PA -d g3 -c "select count(*) from public.prompter_consent_catalog where code='CONNECT_META'")" 2
ERRIS "S3 authenticated tidak dapat memanggil consent_check" "$(as g3 authenticated $UA "select public.fn_prompter_consent_check('$UA','CONNECT_META')")"
ERRIS "S3 katalog tidak dapat diubah (UPDATE)" "$(PA -v ON_ERROR_STOP=1 -d g3 -c "update public.prompter_consent_catalog set text_id='x'" 2>/dev/null || echo ERR)"
ERRIS "S3 katalog tidak dapat dihapus (DELETE)" "$(PA -v ON_ERROR_STOP=1 -d g3 -c "delete from public.prompter_consent_catalog" 2>/dev/null || echo ERR)"

# ---------- S4: pencatatan pendaftaran ----------
eq "S4 service_role mencatat dua baris terpisah" "$(as g3 service_role '' "select public.fn_prompter_record_signup_legal('$UA',1,1)->>'terms_recorded'")" true
eq "S4 TERMS/ACCEPTED dan PRIVACY_NOTICE/DELIVERED" "$(PA -d g3 -c "select string_agg(doc_code||'/'||event||'/'||version||'/'||source||'/'||coalesce(tenant_id::text,'null'),',' order by doc_code) from public.prompter_legal_document_events")" "PRIVACY_NOTICE/DELIVERED/1/REGISTER/null,TERMS/ACCEPTED/1/REGISTER/null"
eq "S4 pencatatan ulang idempoten" "$(as g3 service_role '' "select public.fn_prompter_record_signup_legal('$UA',1,1)->>'terms_recorded'")" false
eq "S4 tetap dua baris" "$(PA -d g3 -c "select count(*) from public.prompter_legal_document_events")" 2
eq "S4 occurred_at waktu server" "$(PA -d g3 -c "select count(*) from public.prompter_legal_document_events where occurred_at > now() - interval '5 minutes'")" 2
ERRIS "S4 authenticated tidak dapat memanggil record_signup_legal" "$(as g3 authenticated $UA "select public.fn_prompter_record_signup_legal('$UA',1,1)")"
ERRIS "S4 anon tidak dapat memanggil record_signup_legal" "$(as g3 anon '' "select public.fn_prompter_record_signup_legal('$UA',1,1)")"
ERRIS "S4 versi tidak valid ditolak" "$(as g3 service_role '' "select public.fn_prompter_record_signup_legal('$UA',0,1)")"
eq "S4 pengguna melihat catatan miliknya" "$(as g3 authenticated $UA "select count(*) from public.prompter_legal_document_events")" 2
eq "S4 pengguna B tidak melihat catatan A" "$(as g3 authenticated $UB "select count(*) from public.prompter_legal_document_events")" 0
ERRIS "S4 catatan dokumen tidak dapat diubah service_role" "$(as g3 service_role '' "update public.prompter_legal_document_events set version=2")"
ERRIS "S4 catatan dokumen tidak dapat dihapus pemilik" "$(PA -v ON_ERROR_STOP=1 -d g3 -c "delete from public.prompter_legal_document_events" 2>/dev/null || echo ERR)"
ERRIS "S4 TRUNCATE catatan dokumen ditolak pemilik" "$(PA -v ON_ERROR_STOP=1 -d g3 -c "truncate public.prompter_legal_document_events" 2>/dev/null || echo ERR)"
eq "S4 tidak ada kolom PII pada tabel bukti" "$(PA -d g3 -c "select count(*) from information_schema.columns where table_schema='public' and table_name in ('prompter_consent_events','prompter_legal_document_events') and column_name ~* '(^ip|agent|email|nama|name|note|reason|phone|token)'")" 0

# ---------- S5: fungsi operator ----------
for f in "fn_prompter_consent_schedule_retention(true)" "fn_prompter_consent_evidence_purge(true,null,10)"; do
  ERRIS "S5 service_role tidak dapat memanggil $f" "$(as g3 service_role '' "select public.$f")"
  ERRIS "S5 authenticated tidak dapat memanggil $f" "$(as g3 authenticated $UA "select public.$f")"
  ERRIS "S5 anon tidak dapat memanggil $f" "$(as g3 anon '' "select public.$f")"
done
eq "S5 purge dengan parameter NULL = NOT_APPROVED" "$(PA -d g3 -c "select public.fn_prompter_consent_evidence_purge(false,'REF-001',10)->>'status'")" NOT_APPROVED
eq "S5 NOT_APPROVED tercatat di purge_runs" "$(PA -d g3 -c "select count(*) from public.prompter_consent_purge_runs where status='NOT_APPROVED'")" 1
eq "S5 schedule dengan parameter NULL = NOT_APPROVED" "$(PA -d g3 -c "select public.fn_prompter_consent_schedule_retention(false)->>'status'")" NOT_APPROVED
eq "S5 retain_until tetap NULL semua" "$(PA -d g3 -c "select count(*) from public.prompter_consent_events where retain_until is not null")" 0
PA -d g3 -c "update public.prompter_consent_settings set value='12'" >/dev/null
eq "S5 schedule dry-run: kandidat 2 (subjek A ditarik), tidak mengubah" "$(PA -d g3 -c "select (r->>'status')||':'||(r->>'candidates')||':'||(select count(*) from public.prompter_consent_events where retain_until is not null) from (select public.fn_prompter_consent_schedule_retention(true) r) q")" "DRY_RUN:2:0"
eq "S5 schedule nyata: hanya subjek yang ditarik" "$(PA -d g3 -c "select public.fn_prompter_consent_schedule_retention(false)->>'updated'" -c "select (select count(*) from public.prompter_consent_events where retain_until is not null and subject_user_id='$UA')||':'||(select count(*) from public.prompter_consent_events where retain_until is not null and subject_user_id='$UB')" | paste -sd:)" "2:2:0"
eq "S5 retain_until = peristiwa terakhir + 12 bulan" "$(PA -d g3 -c "select count(*) from public.prompter_consent_events e where e.subject_user_id='$UA' and e.retain_until = (select max(occurred_at) from public.prompter_consent_events x where x.subject_user_id='$UA') + interval '12 months'")" 2
eq "S5 jalur retensi tidak mengubah kolom lain" "$(PA -d g3 -c "select string_agg(action,',' order by occurred_at,id) from public.prompter_consent_events where subject_user_id='$UA'")" "GRANTED,WITHDRAWN"
ERRIS "S5 UPDATE retain_until langsung ditolak" "$(PA -v ON_ERROR_STOP=1 -d g3 -c "update public.prompter_consent_events set retain_until=now() where subject_user_id='$UB'" 2>/dev/null || echo ERR)"
# sintetis: kedaluwarsa 40d, 400d, 1d (tanpa hold), 1d (hold), +30d (belum), NULL (milik B sudah ada)
PA -d g3 -c "alter table public.prompter_consent_events disable trigger trg_prompter_consent_events_guard" \
  -c "delete from public.prompter_consent_events where retain_until is not null" \
  -c "alter table public.prompter_consent_events enable trigger trg_prompter_consent_events_guard" >/dev/null
PA -d g3 -c "insert into public.prompter_consent_events(subject_user_id,code,version,action,source,retain_until,legal_hold) values
 ('$UA','CONNECT_TIKTOK',1,'GRANTED','SETTINGS',now()-interval '40 days',false),
 ('$UA','CONNECT_TIKTOK',1,'WITHDRAWN','SETTINGS',now()-interval '400 days',false),
 ('$UA','CONNECT_X',1,'GRANTED','SETTINGS',now()-interval '1 day',false),
 ('$UA','CONNECT_X',1,'WITHDRAWN','SETTINGS',now()-interval '1 day',true),
 ('$UA','CONNECT_META',1,'GRANTED','SETTINGS',now()+interval '30 days',false)" >/dev/null
BASE_ALL=$(PA -d g3 -c "select count(*) from public.prompter_consent_events")
DRY=$(PA -d g3 -c "select public.fn_prompter_consent_evidence_purge(true)")
eq "S5 dry-run: status, kandidat, terhapus" "$(echo "$DRY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['status'],d['candidates'],d['deleted'])")" "DRY_RUN 3 0"
case "$DRY" in *$UA*|*$UB*|*$TA*) bad "S5 keluaran dry-run memuat identitas";; *) pass "S5 keluaran dry-run tanpa user id/tenant id";; esac
eq "S5 dry-run tidak menghapus" "$(PA -d g3 -c "select count(*) from public.prompter_consent_events")" "$BASE_ALL"
eq "S5 purge nyata tanpa approval_ref = REFUSED" "$(PA -d g3 -c "select public.fn_prompter_consent_evidence_purge(false,null,10)->>'reason'")" APPROVAL_REF_REQUIRED
eq "S5 approval_ref berisi email ditolak" "$(PA -d g3 -c "select public.fn_prompter_consent_evidence_purge(false,'a@b.co',10)->>'status'")" REFUSED
eq "S5 batch=2 menghapus paling banyak 2" "$(PA -d g3 -c "select public.fn_prompter_consent_evidence_purge(true)" -c "select public.fn_prompter_consent_evidence_purge(false,'APPROVE-TEST-1',2)->>'deleted'" | tail -1)" 2
eq "S5 sisa kandidat 1" "$(PA -d g3 -c "select public.fn_prompter_consent_evidence_purge(true)->>'candidates'")" 1
eq "S5 purge nyata tanpa dry-run yang sama = REFUSED" "$(PA -d g3 -c "insert into public.prompter_consent_events(subject_user_id,code,version,action,source,retain_until) values ('$UB','CONNECT_X',1,'GRANTED','SETTINGS',now()-interval '2 days')" -c "select public.fn_prompter_consent_evidence_purge(false,'APPROVE-TEST-2',10)->>'reason'" | tail -1)" FRESH_DRY_RUN_REQUIRED
eq "S5 purge selesai; legal_hold dan belum kedaluwarsa tidak terhapus" "$(PA -d g3 -c "select public.fn_prompter_consent_evidence_purge(true)" -c "select (public.fn_prompter_consent_evidence_purge(false,'APPROVE-TEST-3',10)->>'deleted')||':'||(select count(*) from public.prompter_consent_events where legal_hold)||':'||(select count(*) from public.prompter_consent_events where retain_until > now())" | tail -1)" "2:1:1"
eq "S5 purge_runs mencatat eksekusi" "$(PA -d g3 -c "select count(*) from public.prompter_consent_purge_runs where status='EXECUTED'")" 2
ERRIS "S5 setelah purge, DELETE langsung tetap ditolak" "$(PA -v ON_ERROR_STOP=1 -d g3 -c "delete from public.prompter_consent_events" 2>/dev/null || echo ERR)"
ERRIS "S5 purge_runs tidak dapat diubah" "$(PA -v ON_ERROR_STOP=1 -d g3 -c "update public.prompter_consent_purge_runs set deleted=0" 2>/dev/null || echo ERR)"
ERRIS "S5 bypass GUC oleh pemilik tidak menghapus baris hold/belum kedaluwarsa" "$(PA -v ON_ERROR_STOP=1 -d g3 -c "begin" -c "select set_config('linoe.consent_purge','on',true)" -c "delete from public.prompter_consent_events where retain_until > now() or retain_until is null or legal_hold" -c "rollback" 2>/dev/null || echo ERR)"
ERRIS "S5 bypass GUC oleh role klien tetap ditolak" "$(PA -v ON_ERROR_STOP=1 -d g3 -c "set role service_role" -c "select set_config('linoe.consent_purge','on',false)" -c "delete from public.prompter_consent_events" 2>/dev/null || echo ERR)"

# ---------- S6: rollback ----------
mk g6; up g6; PROT_G6=$(PA -d g6 -c "$PROT")
as g6 authenticated $UA "select public.fn_prompter_consent_set('CONNECT_META','GRANTED','SETTINGS')" >/dev/null
down g6 && R=DOWN || { grep -q 'ROLLBACK BERHENTI' "$W/err_down.txt" && R=REFUSED || R=OTHER; }
eq "S6 down ditolak bila ada bukti (data aman)" "$R" REFUSED
eq "S6 tabel bukti masih utuh" "$(PA -d g6 -c "select count(*) from public.prompter_consent_events")" 1
eq "S6 guard audit masih terpasang" "$(PA -d g6 -c "select count(*) from pg_trigger where tgname like 'trg_prompter_audit_logs%'")" 2
PGOPTIONS="-c client_min_messages=warning -c linoe.drop_evidence=YA" P -d g6 -f "$DOWN" >/dev/null 2>"$W/err_down.txt" && pass "S6 down dengan konfirmasi eksplisit berhasil" || bad "S6 down paksa: $(cat "$W/err_down.txt")"
eq "S6 tabel Paket 3 hilang" "$(PA -d g6 -c "select count(*) from pg_class where relname like 'prompter_consent%' or relname like 'prompter_legal_document%' or relname='prompter_audit_guard_state'")" 0
eq "S6 fungsi Paket 3 hilang" "$(PA -d g6 -c "select count(*) from pg_proc where proname in ('fn_prompter_consent_set','fn_prompter_consent_check','fn_prompter_consent_my_status','fn_prompter_record_signup_legal','fn_prompter_consent_evidence_purge','fn_prompter_consent_schedule_retention','fn_prompter_evidence_guard','fn_prompter_audit_logs_guard','fn_prompter_block_truncate_guard')")" 0
eq "S6 trigger guard hilang" "$(PA -d g6 -c "select count(*) from pg_trigger where not tgisinternal and tgname like 'trg_prompter_%'")" 0
for r in anon authenticated service_role; do
  eq "S6 hak $r pada audit dipulihkan (UPDATE,DELETE,TRUNCATE)" "$(PA -d g6 -c "select string_agg(privilege_type,',' order by privilege_type) from information_schema.role_table_grants where table_name='prompter_audit_logs' and grantee='$r' and privilege_type in ('UPDATE','DELETE','TRUNCATE')")" "DELETE,TRUNCATE,UPDATE"
done
down g6 && pass "S6 down kedua idempoten" || bad "S6 down kedua: $(cat "$W/err_down.txt")"
eq "S6 auth.users/tenants/user_profiles tidak berubah oleh up+down" "$(PA -d g6 -c "$PROT")" "$PROT_G6"
up g6 && eq "S6 up lagi setelah down OK" "$(PA -d g6 -c "select count(*) from public.prompter_consent_catalog")" 5 || bad "S6 re-up"
mk g6b; up g6b; down g6b && pass "S6 down tanpa bukti berhasil tanpa konfirmasi" || bad "S6b down: $(cat "$W/err_down.txt")"
mk g6c; PA -d g6c -c "revoke all on public.prompter_audit_logs from anon, authenticated, service_role" -c "grant select, insert on public.prompter_audit_logs to anon, authenticated, service_role" -c "grant update on public.prompter_audit_logs to service_role" >/dev/null
up g6c; down g6c
eq "S6 pemulihan hak persis keadaan awal (hanya service_role UPDATE)" "$(PA -d g6c -c "select string_agg(grantee||':'||privilege_type,',' order by grantee,privilege_type) from information_schema.role_table_grants where table_name='prompter_audit_logs' and grantee in ('anon','authenticated','service_role') and privilege_type in ('UPDATE','DELETE','TRUNCATE')")" "service_role:UPDATE"

# ---------- S7: fungsi yatim, kegagalan tengah, psql biasa ----------
mk g7; PA -d g7 -c "create function public.fn_prompter_block_truncate_clients() returns trigger language plpgsql as \$\$ begin raise exception 'x'; end \$\$" >/dev/null
up g7; eq "S7 fungsi yatim dibersihkan" "$(PA -d g7 -c "select count(*) from pg_proc where proname='fn_prompter_block_truncate_clients'")" 0
mk g7b; PA -d g7b -c "create table public.dummy_t(a int)" -c "create function public.fn_prompter_block_truncate_clients() returns trigger language plpgsql as \$\$ begin raise exception 'x'; end \$\$" -c "create trigger trg_dummy before truncate on public.dummy_t for each statement execute function public.fn_prompter_block_truncate_clients()" >/dev/null
up g7b; eq "S7 fungsi yatim yang dipakai trigger TIDAK dibuang" "$(PA -d g7b -c "select count(*) from pg_proc where proname='fn_prompter_block_truncate_clients'")" 1
mk g7c
python3 - "$MIG" "$W/mig_fail.sql" <<'PY'
import sys
s = open(sys.argv[1]).read().rstrip()
assert s.endswith("commit;")
open(sys.argv[2], "w").write(s[:-len("commit;")] + "select 1/0;\ncommit;\n")
PY
psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -d g7c -f "$W/mig_fail.sql" >/dev/null 2>&1
eq "S7 kegagalan di tengah (psql biasa): semua dibatalkan" "$(PA -d g7c -c "select count(*) from pg_class where relname like 'prompter_consent%'")" 0
eq "S7 hak audit tidak berubah setelah kegagalan di tengah" "$(PA -d g7c -c "select count(*) from information_schema.role_table_grants where table_name='prompter_audit_logs' and grantee in ('anon','authenticated','service_role') and privilege_type in ('UPDATE','DELETE','TRUNCATE')")" 9
eq "S7 trigger audit tidak terpasang setelah kegagalan" "$(PA -d g7c -c "select count(*) from pg_trigger where tgname like 'trg_prompter_audit_logs%'")" 0
psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -d g7c -c "$(cat "$MIG")" >/dev/null 2>&1; eq "S7 seluruh berkas sebagai SATU query berhasil" "$(PA -d g7c -c "select count(*) from public.prompter_consent_catalog")" 5

# ---------- S9: revisi review (versi katalog konsisten, NULL, retensi >= 1, ACL PUBLIC+grant option, komentar) ----------
mk g9; up g9
eq "S9 komentar tabel audit jujur (tanpa kata immutable)" "$(PA -d g9 -c "select (obj_description('public.prompter_audit_logs'::regclass,'pg_class') !~* 'immutable')::text||':'||(obj_description('public.prompter_audit_logs'::regclass,'pg_class') ~ 'pemilik tabel')::text")" "true:true"
eq "S9 occurred_at memakai clock_timestamp()" "$(PA -d g9 -c "select count(*) from pg_attrdef d join pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum where a.attname='occurred_at' and pg_get_expr(d.adbin,d.adrelid) like '%clock_timestamp%'")" 2
ERRIS "S9 retensi 0 ditolak" "$(PA -v ON_ERROR_STOP=1 -d g9 -c "update public.prompter_consent_settings set value='0'" 2>/dev/null || echo ERR)"
ERRIS "S9 retensi '012' ditolak" "$(PA -v ON_ERROR_STOP=1 -d g9 -c "update public.prompter_consent_settings set value='012'" 2>/dev/null || echo ERR)"
ERRIS "S9 retensi '-5' ditolak" "$(PA -v ON_ERROR_STOP=1 -d g9 -c "update public.prompter_consent_settings set value='-5'" 2>/dev/null || echo ERR)"
eq "S9 retensi '1' dan NULL diterima" "$(PA -v ON_ERROR_STOP=1 -d g9 -c "update public.prompter_consent_settings set value='1'" -c "update public.prompter_consent_settings set value=null" -c "select 'ok'" 2>/dev/null | tail -1)" ok
ERRIS "S9 consent_set argumen NULL (code) ditolak" "$(as g9 authenticated $UA "select public.fn_prompter_consent_set(null,'GRANTED','SETTINGS')")"
ERRIS "S9 consent_set argumen NULL (action) ditolak" "$(as g9 authenticated $UA "select public.fn_prompter_consent_set('CONNECT_META',null,'SETTINGS')")"
ERRIS "S9 consent_set argumen NULL (source) ditolak" "$(as g9 authenticated $UA "select public.fn_prompter_consent_set('CONNECT_META','GRANTED',null)")"
eq "S9 kelas galat argumen NULL = 22023" "$(psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q -At -v VERBOSITY=verbose -d g9 -c "set role authenticated" -c "set app.uid='$UA'" -c "select public.fn_prompter_consent_set('CONNECT_META',null,'SETTINGS')" 2>&1 | grep -c '22023')" 1
ERRIS "S9 signup_legal argumen NULL ditolak" "$(as g9 service_role '' "select public.fn_prompter_record_signup_legal(null,1,1)")"
ERRIS "S9 purge dengan dry_run NULL ditolak" "$(PA -v ON_ERROR_STOP=1 -d g9 -c "select public.fn_prompter_consent_evidence_purge(null,null,10)" 2>/dev/null || echo ERR)"
ERRIS "S9 purge dengan batch 0 ditolak" "$(PA -v ON_ERROR_STOP=1 -d g9 -c "select public.fn_prompter_consent_evidence_purge(true,null,0)" 2>/dev/null || echo ERR)"
ERRIS "S9 schedule dengan dry_run NULL ditolak" "$(PA -v ON_ERROR_STOP=1 -d g9 -c "select public.fn_prompter_consent_schedule_retention(null)" 2>/dev/null || echo ERR)"
# versi katalog: v2 TIDAK aktif -> acuan tetap v1 aktif di check/set/my_status
as g9 authenticated $UA "select public.fn_prompter_consent_set('CONNECT_META','GRANTED','SETTINGS')" >/dev/null
PA -d g9 -c "insert into public.prompter_consent_catalog(code,version,text_id,purpose_id,active,text_sha256) values ('CONNECT_META',2,'Teks versi dua nonaktif yang belum ditawarkan.','Koneksi Meta',false,repeat('b',64))" >/dev/null
eq "S9 v2 nonaktif: check tetap GRANTED terhadap v1 aktif" "$(as g9 service_role '' "select public.fn_prompter_consent_check('$UA','CONNECT_META')->>'reason'")" GRANTED
eq "S9 v2 nonaktif: my_status memakai v1" "$(as g9 authenticated $UA "select version||':'||status from public.fn_prompter_consent_my_status() where code='CONNECT_META'")" "1:GRANTED"
eq "S9 v2 nonaktif: consent_set GRANTED ulang tidak membuat baris" "$(as g9 authenticated $UA "select (public.fn_prompter_consent_set('CONNECT_META','GRANTED','SETTINGS'))->>'changed'")" false
eq "S9 kode semua versi nonaktif: check = INACTIVE_CODE" "$(as g9 service_role '' "select public.fn_prompter_consent_check('$UA','CONNECT_X')->>'reason'")" INACTIVE_CODE
# ACL PUBLIC + grant option + komentar lama dipulihkan
mk g9b
PA -d g9b -c "comment on table public.prompter_audit_logs is 'Komentar lama sintetis'" -c "grant update, truncate on public.prompter_audit_logs to public" -c "grant delete on public.prompter_audit_logs to anon with grant option" >/dev/null
ACL_B=$(PA -d g9b -c "select string_agg(coalesce(nullif(a.grantee,0)::regrole::text,'PUBLIC')||':'||a.privilege_type||':'||a.is_grantable::text,',' order by 1) from pg_class c, aclexplode(c.relacl) a where c.oid='public.prompter_audit_logs'::regclass and a.privilege_type in ('UPDATE','DELETE','TRUNCATE')")
up g9b
eq "S9 setelah up: tidak ada ACL UPDATE/DELETE/TRUNCATE untuk PUBLIC atau role klien" "$(PA -d g9b -c "select count(*) from pg_class c, aclexplode(c.relacl) a where c.oid='public.prompter_audit_logs'::regclass and a.privilege_type in ('UPDATE','DELETE','TRUNCATE') and (a.grantee=0 or a.grantee::regrole::text in ('anon','authenticated','service_role'))")" 0
up g9b
eq "S9 up kedua tidak menimpa snapshot asli" "$(PA -d g9b -c "select count(*) from public.prompter_audit_guard_state where privilege_type='MARKER'")" 1
down g9b
ACL_A=$(PA -d g9b -c "select string_agg(coalesce(nullif(a.grantee,0)::regrole::text,'PUBLIC')||':'||a.privilege_type||':'||a.is_grantable::text,',' order by 1) from pg_class c, aclexplode(c.relacl) a where c.oid='public.prompter_audit_logs'::regclass and a.privilege_type in ('UPDATE','DELETE','TRUNCATE')")
eq "S9 down memulihkan ACL mentah (PUBLIC, grant option, role) persis" "$ACL_A" "$ACL_B"
eq "S9 ACL asli memuat PUBLIC dan grant option pada role (bukan tautologi)" "$(echo "$ACL_B" | grep -c 'PUBLIC:UPDATE:false')$(echo "$ACL_B" | grep -c 'anon:DELETE:true')" 11
eq "S9 down memulihkan komentar lama" "$(PA -d g9b -c "select obj_description('public.prompter_audit_logs'::regclass,'pg_class')")" "Komentar lama sintetis"

# ---------- S8: statis ----------
for f in "$MIG" "$DOWN"; do
  if grep -viE '^\s*--' "$f" | grep -qiE '(auth\.users|user_profiles|handle_new_user|fn_create_ai_job_if_entitled|budget_policies|automation_settings)'; then bad "S8 $(basename "$f") menyebut objek terlarang"; else pass "S8 $(basename "$f") tidak menyebut objek terlarang"; fi
done
if grep -viE '^\s*--' "$MIG" | grep -iE '(insert into|update|delete from|alter table|drop table|truncate)[^;]*public\.tenants' >/dev/null; then bad "S8 migrasi mengubah tenants"; else pass "S8 migrasi tidak mengubah tenants (hanya membaca)"; fi

[ "$fail" = 0 ] && echo "ALL PASSED" || echo "SOME FAILED"
exit $fail
