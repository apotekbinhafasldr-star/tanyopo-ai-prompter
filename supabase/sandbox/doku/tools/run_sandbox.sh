#!/usr/bin/env bash
# ============================================================================
# run_sandbox.sh -- runner T6..T14 LINOE DOKU sandbox. FAIL-CLOSED: berhenti pada penyimpangan pertama.
# Hanya untuk project linoe-doku-sandbox (ref eskqngzhtndkfqjoxxou). Tidak pernah mencetak/menyimpan kredensial.
#
# Koneksi HANYA lewat variabel lingkungan libpq standar (tanpa URL, tanpa argumen proses yang memuat rahasia):
#   PGHOST PGUSER PGPASSWORD PGPORT PGDATABASE      (PGSSLMODE dipaksa 'require')
# Mode target:  CLOUD=1 -> host harus pooler/direct milik ref sandbox; selain itu hanya server LOKAL uji (/var/tmp/pgl-*).
# Mode kerja:   MODE=preflight (hanya baca; cek target + keadaan awal) | execute (default) | gen (hasilkan golden_state.txt, LOKAL saja)
# Pemakaian:    [CLOUD=1] [MODE=...] ./run_sandbox.sh [dari_tahap=T6] [sampai_tahap=T14]
# Keluaran: nama tahap, PASS/FAIL, angka. TIDAK ada data baris. (Repo publik -> log Actions publik.)
# ============================================================================
set -u -o pipefail
umask 077
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${SRC:-$(cd "$here/.." && pwd)}"
GOLDEN="${GOLDEN:-$here/golden_state.txt}"
MODE="${MODE:-execute}"
FROM="${1:-T6}"; TO="${2:-T14}"
LOG="${LOG:-$(mktemp -d)}"; mkdir -p "$LOG"; chmod 700 "$LOG"
REF=eskqngzhtndkfqjoxxou; PROD=wjjyqovhmwenbcvbnkgx; OTP=bmwpykwoylmzrbmbdeqw

stop() { echo "STOP[$1]: $2"; exit "${3:-2}"; }
case "$MODE" in preflight|execute|gen) ;; *) stop A0 "MODE tidak dikenal" 3;; esac
case "$FROM$TO" in T[0-9]*T[0-9]*) ;; *) stop A0 "tahap tidak valid" 3;; esac
command -v psql >/dev/null || stop A0 "psql tidak ada" 3

# --- A. bersihkan variabel libpq yang bisa membelokkan koneksi, lalu validasi target SEBELUM koneksi apa pun
for v in PGHOSTADDR PGSERVICE PGSERVICEFILE PGPASSFILE PGOPTIONS PGSYSCONFDIR PGSSLROOTCERT PGSSLCERT PGSSLKEY PGSSLCRL \
         PGCHANNELBINDING PGTARGETSESSIONATTRS PGKRBSRVNAME PGGSSLIB PGREQUIREAUTH PGAPPNAME PGCONNECT_TIMEOUT PGDATESTYLE PGTZ; do unset "$v"; done
[ "$MODE" = gen ] && [ "${CLOUD:-0}" = 1 ] && stop A0 "MODE=gen hanya lokal" 3
python3 -I - "${CLOUD:-0}" "$REF" "$PROD" "$OTP" <<'PY' || stop A1 "target ditolak (host/user/port/database tidak cocok dengan sandbox)"
import os, re, sys
cloud, ref, prod, otp = sys.argv[1:5]
e = os.environ
host, user, port, db = e.get('PGHOST', ''), e.get('PGUSER', ''), e.get('PGPORT', ''), e.get('PGDATABASE', '')
blob = (host + '|' + user + '|' + db).lower()
if prod in blob or otp in blob: sys.exit(1)
if any(k in e for k in ('DOKU_DB_URL', 'DATABASE_URL')) and cloud == '1': sys.exit(1)
if cloud == '1':
    direct = host == f'db.{ref}.supabase.co' and user == 'postgres'
    pooler = bool(re.fullmatch(r'[a-z0-9-]+\.pooler\.supabase\.com', host)) and user == f'postgres.{ref}'
    if not (direct or pooler): sys.exit(1)
    if port != '5432' or db != 'postgres' or not e.get('PGPASSWORD'): sys.exit(1)
else:
    if not (host.startswith('/var/tmp/pgl-') or host in ('localhost', '127.0.0.1')): sys.exit(1)
PY
export PGSSLMODE=require; [ "${CLOUD:-0}" = 1 ] || export PGSSLMODE=disable
export PGCONNECT_TIMEOUT=20
PSQL() { psql -X -At -v ON_ERROR_STOP=1 "$@"; }
Q() { PSQL -c "$1" 2>>"$LOG/q.err"; }
diag() { grep -hm2 -E 'FATAL|could not|timeout|SSL|password authentication' "$LOG/q.err" 2>/dev/null | sed 's/password=[^ ]*/password=***/' ; }

# --- B. integritas berkas (SHA256 dari commit yang diaudit)
( cd "$SRC" && sha256sum -c SHA256SUMS >"$LOG/sha.out" 2>&1 ) || stop B1 "SHA256 berkas tidak cocok dengan SHA256SUMS"
# --- C. sidik jari sandbox
fp="$(Q "select (select count(*) from public._linoe_sandbox_marker)||'|'||(select count(*) from information_schema.tables where table_schema='public' and table_name in ('products','warehouses','transactions','employees','receivables','online_orders','product_batches','pesanan_meja'))")" \
  || { diag; stop C0 "tidak bisa konek/baca database"; }
[ "$fp" = "1|0" ] || stop C1 "sidik jari bukan sandbox ($fp)"

STATE_SQL="select (select count(*) from pg_class where relnamespace='public'::regnamespace and relkind='r')||'|'||(select count(*) from pg_policies where schemaname='public')||'|'||(select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where not tgisinternal and c.relnamespace='public'::regnamespace)||'|'||(select count(*) from pg_proc where pronamespace='public'::regnamespace)||'|'||(select count(*) from pg_constraint k join pg_class c on c.oid=k.conrelid where k.contype='f' and c.relnamespace='public'::regnamespace)||'|'||(select count(*) from public._linoe_sandbox_applied)||'|'||coalesce((select max(version) from public._linoe_sandbox_applied),'-')||'|'||(select count(*) from pg_class where relnamespace='public'::regnamespace and relkind='r' and not relrowsecurity)||'|'||(select count(*) from pg_proc where pronamespace='public'::regnamespace and prosecdef and not coalesce(proconfig::text like '%search_path=%',false))||'|'||(case when to_regclass('cron.job') is null then 'x' else (select count(*) from cron.job)::text end)||'|'||(select count(*) from auth.users)"
declare -A FILE=( [T6]=10_migrations_part_3.sql [T7]=10_migrations_part_4.sql [T8]=10_migrations_part_5.sql [T9]=10_migrations_part_6.sql [T10]=10_migrations_part_7.sql [T11]=10_migrations_part_8.sql [T12]=20_seed_dummy.sql [T13]=30_verify_readonly.sql [T14]=31_smoke_checkout_apply_rollback.sql )
declare -A PREV=( [T6]=T5 [T7]=T6 [T8]=T7 [T9]=T8 [T10]=T9 [T11]=T10 [T12]=T11 [T13]=T12 [T14]=T13 )
declare -A BEFORE=( [T6]=14 [T7]=27 [T8]=32 [T9]=40 [T10]=45 [T11]=47 [T12]=49 [T13]=49 [T14]=49 )
ORDER=(T6 T7 T8 T9 T10 T11 T12 T13 T14)
[ -n "${FILE[$FROM]:-}" ] && [ -n "${FILE[$TO]:-}" ] || stop A0 "tahap harus T6..T14" 3
golden_of() { grep "^$1|" "$GOLDEN" | head -1 | cut -d'|' -f2-; }

# --- D. keadaan awal HARUS persis sama dengan keadaan acuan tahap sebelumnya
cur="$(Q "$STATE_SQL")" || { diag; stop D0 "gagal membaca keadaan awal"; }
if [ "$MODE" = gen ]; then : > "$GOLDEN"; [ "$FROM" = T6 ] && echo "T5|$cur" >> "$GOLDEN"
else
  exp="$(golden_of "${PREV[$FROM]}")"; [ -n "$exp" ] || stop D2 "golden untuk ${PREV[$FROM]} tidak ada"
  [ "$cur" = "$exp" ] || stop D1 "keadaan awal sandbox menyimpang: aktual=$cur acuan=$exp"
fi
if [ "$MODE" = preflight ]; then echo "PREFLIGHT OK: target sandbox benar, berkas utuh, keadaan awal = acuan; siap mulai $FROM (tidak ada perubahan dibuat)"; exit 0; fi

on=0
for T in "${ORDER[@]}"; do
  [ "$T" = "$FROM" ] && on=1
  [ $on = 1 ] || continue
  pre="$(Q "select (select count(*) from public._linoe_sandbox_marker)||'|'||(select count(*) from public._linoe_sandbox_applied)")" || { diag; stop D0 "$T: gagal baca prasyarat"; }
  [ "$pre" = "1|${BEFORE[$T]}" ] || stop D1 "$T prasyarat salah: $pre (harus 1|${BEFORE[$T]})"
  echo ">> $T ${FILE[$T]}"
  F="$SRC/${FILE[$T]}"
  if [ "${CLOUD:-0}" != 1 ]; then F="$LOG/$T.local.sql"   # LOKAL SAJA: PG lokal tak punya ekstensi pg_cron
    sed 's/^create extension if not exists pg_cron;/-- (lokal: pg_cron dinonaktifkan)/' "$SRC/${FILE[$T]}" > "$F"; fi
  case $T in
    T13) PSQL -F'|' -f "$F" >"$LOG/T13.out" 2>"$LOG/T13.err"; rc=$?
         [ $rc = 0 ] || { grep -m3 -E 'ERROR|DETAIL' "$LOG/T13.err"; stop E13 "T13 error"; }
         grep -q '^99|ALL_PASS|semua PASS||PASS$' "$LOG/T13.out" || { grep '|FAIL$' "$LOG/T13.out"; stop E13 "T13 ada baris FAIL"; };;
    T14) PSQL -f "$F" >"$LOG/T14.out" 2>"$LOG/T14.err"
         grep -q 'SMOKE_OVERALL=PASS' "$LOG/T14.err" || { grep -m3 -E 'ERROR|SMOKE' "$LOG/T14.err" | cut -c1-200; stop E14 "T14 smoke bukan PASS"; };;
    *)   PSQL -q -f "$F" >"$LOG/$T.out" 2>"$LOG/$T.err"; rc=$?
         [ $rc = 0 ] || { grep -m3 -E 'ERROR|DETAIL' "$LOG/$T.err"; stop E1 "$T GAGAL (transaksi dibatalkan; tahap berikutnya tidak dijalankan)"; };;
  esac
  st="$(Q "$STATE_SQL")" || { diag; stop F0 "$T: verifikasi gagal"; }
  if [ "$MODE" = gen ]; then echo "$T|$st" >> "$GOLDEN"
  else g="$(golden_of "$T")"; [ "$st" = "$g" ] || stop F1 "$T keadaan menyimpang: aktual=$st acuan=$g"; fi
  echo "   $T OK ($st)"
  [ "$T" = "$TO" ] && break
done
echo "SELESAI: tahap $FROM..$TO lulus"
