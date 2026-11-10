#!/usr/bin/env bash
# Uji LOKAL runner (PostgreSQL lokal sekali pakai + stub Supabase). Tidak menyentuh jaringan/Supabase. Hapus semua /var/tmp/pgl-* saat selesai.
# Pakai: bash tools/test_runner_local.sh   (butuh PostgreSQL di /usr/lib/postgresql/*/bin dan user 'postgres' di OS)
set -u
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; SRC="$(cd "$here/.." && pwd)"; R="$here/run_sandbox.sh"
BIN="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"; S="$(mktemp -d /var/tmp/pgl-runner-XXXX)"; chown postgres "$S"
T="$(mktemp -d)"; GOLD="$T/golden.txt"; pass=0; fail=0
su postgres -c "$BIN/initdb -D $S/data -A trust -E UTF8 >/dev/null && mkdir -p $S/sock && $BIN/pg_ctl -D $S/data -o \"-p 5688 -k $S/sock -c listen_addresses=''\" -l $S/log -w start" >/dev/null 2>&1
trap 'su postgres -c "$BIN/pg_ctl -D $S/data stop -m fast" >/dev/null 2>&1; rm -rf "$S" "$T"' EXIT
export PGHOST="$S/sock" PGPORT=5688 PGUSER=postgres
ok() { if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "  PASS  $1"; else fail=$((fail+1)); echo "  FAIL  $1 (dapat='$2' harus='$3')"; fi; }
fresh() { psql -X -q -c "drop database if exists $1" -c "create database $1" >/dev/null 2>&1; psql -X -q -d "$1" -f "$here/local-only/supabase_like_base.sql" >/dev/null 2>&1
  for f in 01_shim_shared_objects 10_migrations_part_1 10_migrations_part_2; do psql -X -q -d "$1" -v ON_ERROR_STOP=1 -f "$SRC/$f.sql" >/dev/null 2>&1 || echo "prasyarat gagal $f"; done; }
run() { # db src mode [args] -> keluaran ringkas, tanpa NOTICE
  local db=$1 src=$2 mode=$3; shift 3; PGDATABASE=$db SRC=$src GOLDEN=$GOLD MODE=$mode LOG=$T/log-$db bash "$R" "$@" 2>&1 | grep -v NOTICE; }
last() { tail -1; }

echo "[1] gen golden + jalur normal T6..T14"; fresh a1; out="$(run a1 "$SRC" gen)"; ok "gen selesai" "$(echo "$out" | last)" "SELESAI: tahap T6..T14 lulus"
ok "golden 10 baris (T5..T14)" "$(wc -l < "$GOLD" | tr -d ' ')" "10"
[ "${WRITE_GOLDEN:-0}" = 1 ] && cp "$GOLD" "$here/golden_state.txt"
ok "golden_state.txt di repo = hasil gen terbaru" "$(diff -q "$GOLD" "$here/golden_state.txt" >/dev/null 2>&1 && echo sama || echo beda)" "sama"
echo "[2] verify di DB baru + preflight"; fresh a2
ok "preflight lulus (tanpa perubahan)" "$(run a2 "$SRC" preflight | last | cut -c1-13)" "PREFLIGHT OK:"
ok "preflight tidak mengubah apa pun" "$(psql -X -At -d a2 -c 'select count(*) from public._linoe_sandbox_applied')" "14"
ok "verify penuh lulus" "$(run a2 "$SRC" execute | last)" "SELESAI: tahap T6..T14 lulus"
echo "[3] mulai dari keadaan yang salah"; ok "preflight dari T6 pada DB yang sudah T14 -> D1" "$(run a1 "$SRC" preflight | last | cut -c1-8)" "STOP[D1]"
ok "execute pada DB yang sudah T14 -> D1" "$(run a1 "$SRC" execute | last | cut -c1-8)" "STOP[D1]"
echo "[4] integritas berkas"; rm -rf "$T/bad"; cp -r "$SRC" "$T/bad"; echo "-- x" >> "$T/bad/10_migrations_part_5.sql"; fresh a3
ok "berkas diubah -> B1, DB tak berubah" "$(run a3 "$T/bad" execute | last | cut -c1-8)/$(psql -X -At -d a3 -c 'select count(*) from public._linoe_sandbox_applied')" "STOP[B1]/14"
echo "[5] SQL gagal di tengah T8"; python3 - "$T/bad/10_migrations_part_5.sql" <<'PY'
import sys; p=sys.argv[1]; s=open(p).read().replace("-- x\n",""); i=s.rstrip().rfind("commit;"); open(p,"w").write(s[:i]+"select 1/0;\n"+s[i:])
PY
( cd "$T/bad" && sha256sum 10_migrations_part_*.sql 20_seed_dummy.sql 30_verify_readonly.sql 31_smoke_checkout_apply_rollback.sql > SHA256SUMS ); fresh a4
out="$(run a4 "$T/bad" execute)"; ok "T8 gagal -> E1" "$(echo "$out" | last | cut -c1-8)" "STOP[E1]"
ok "T7 selesai, T8 dibatalkan, T9+ tak jalan (tercatat=32)" "$(psql -X -At -d a4 -c 'select count(*) from public._linoe_sandbox_applied')" "32"
echo "[6] validasi target (mode CLOUD, SEBELUM koneksi apa pun)"
V() { PGDATABASE=${D:-postgres} PGHOST=$1 PGUSER=$2 PGPORT=${3:-5432} PGPASSWORD=${4:-pw} CLOUD=1 SRC=$SRC GOLDEN=$GOLD LOG=$T/lv bash "$R" 2>&1 | head -1 | cut -c1-8; }
R1=eskqngzhtndkfqjoxxou; P=wjjyqovhmwenbcvbnkgx; O=bmwpykwoylmzrbmbdeqw; PH=aws-0-ap-south-1.pooler.supabase.com
ok "user production" "$(V $PH postgres.$P)" "STOP[A1]"; ok "user linoe-otp-test" "$(V $PH postgres.$O)" "STOP[A1]"
ok "user tanpa ref" "$(V $PH postgres)" "STOP[A1]"; ok "host asing" "$(V evil.example.com postgres.$R1)" "STOP[A1]"
ok "host menyerupai (sufiks)" "$(V $PH.evil.io postgres.$R1)" "STOP[A1]"; ok "host direct palsu" "$(V db.$R1.supabase.co.evil.io postgres)" "STOP[A1]"
ok "port 6543" "$(V $PH postgres.$R1 6543)" "STOP[A1]"; ok "database bukan postgres" "$(D=other V $PH postgres.$R1)" "STOP[A1]"
ok "tanpa password" "$(PGDATABASE=postgres PGHOST=$PH PGUSER=postgres.$R1 PGPORT=5432 CLOUD=1 SRC=$SRC GOLDEN=$GOLD LOG=$T/lv bash "$R" 2>&1 | head -1 | cut -c1-8)" "STOP[A1]"
ok "DATABASE_URL ikut diset" "$(DATABASE_URL=x V $PH postgres.$R1)" "STOP[A1]"
ok "mode lokal menolak host cloud" "$(PGDATABASE=postgres PGHOST=$PH PGUSER=postgres.$R1 PGPORT=5432 PGPASSWORD=pw SRC=$SRC GOLDEN=$GOLD LOG=$T/lv bash "$R" 2>&1 | head -1 | cut -c1-8)" "STOP[A1]"
ok "gen ditolak di cloud" "$(MODE=gen V $PH postgres.$R1 | cut -c1-8)" "STOP[A0]"
echo "[7] rahasia tidak bocor (PGPASSWORD sentinel; log + argumen proses)"; fresh a5
( PGPASSWORD=SENTINEL_RAHASIA_98765 run a5 "$SRC" execute >"$T/out5.txt" 2>&1 ) & bgp=$!
while kill -0 $bgp 2>/dev/null; do ps -eo args 2>/dev/null | grep -F SENTINEL_RAHASIA_98765 | grep -v grep; sleep 0.1; done > "$T/ps.txt"; wait $bgp
ok "uji sentinel benar-benar menjalankan seluruh T6..T14" "$(tail -1 "$T/out5.txt")" "SELESAI: tahap T6..T14 lulus"
ok "sentinel tidak ada di keluaran" "$(grep -rc SENTINEL_RAHASIA_98765 "$T/out5.txt" "$T"/log-a5 2>/dev/null | awk -F: '{s+=$NF} END{print s+0}')" "0"
ok "sentinel tidak ada di argumen proses" "$(wc -l < "$T/ps.txt" | tr -d ' ')" "0"
echo "[8] T13 (30_verify): bukan FAIL palsu, tetap menolak pelanggaran"
V13() { psql -X -At -F'|' -d a1 -f "$SRC/30_verify_readonly.sql" | grep -E '\|FAIL$' | cut -d'|' -f1 | tr '\n' ',' ; }
ok "dasar: tanpa FAIL" "$(V13)" ""
psql -X -q -d a1 -c "create function public.zzz_extra() returns int language sql as 'select 1'"; ok "fungsi asing di public -> baris 19 + 99" "$(V13)" "19,99,"
psql -X -q -d a1 -c "drop function public.zzz_extra()"
psql -X -q -d a1 -c "create function public.evt_fn() returns event_trigger language plpgsql as \$\$ begin end \$\$; create event trigger evt_t on ddl_command_end execute function public.evt_fn()"
ok "fungsi event-trigger bawaan tidak dihitung (bukan FAIL palsu)" "$(V13)" ""
psql -X -q -d a1 -c "drop event trigger evt_t; drop function public.evt_fn()"
psql -X -q -d a1 -c "alter function public.fn_activate_product(uuid) rename to fn_activate_product_x"; ok "fungsi dikenal hilang -> baris 7,19,99" "$(V13)" "7,19,99,"
psql -X -q -d a1 -c "alter function public.fn_activate_product_x(uuid) rename to fn_activate_product"
psql -X -q -d a1 -c "grant insert on public.prompter_payment_transactions to authenticated"; ok "klien bisa tulis transaksi -> baris 10 (keamanan tetap menolak)" "$(V13)" "10,99,"
psql -X -q -d a1 -c "revoke insert on public.prompter_payment_transactions from authenticated"
psql -X -q -d a1 -c "grant select on public.finance_ledger_entries to anon"; ok "ledger terbaca anon -> baris 11" "$(V13)" "11,99,"
psql -X -q -d a1 -c "revoke select on public.finance_ledger_entries from anon"; ok "pulih: tanpa FAIL" "$(V13)" ""
echo "[9] pemeriksa statis workflow: lulus pada aslinya, menolak setiap pelanggaran"
REPO_ROOT="$(cd "$here/../../../.." && pwd)"; RT="$T/rt"; mk() { rm -rf "$RT"; mkdir -p "$RT/.github/workflows" "$RT/supabase/sandbox/doku/tools"; cp "$REPO_ROOT/.github/workflows/doku-sandbox-runner.yml" "$RT/.github/workflows/"; cp "$here/check_workflow_static.py" "$here/run_sandbox.sh" "$RT/supabase/sandbox/doku/tools/"; }
chk() { python3 "$RT/supabase/sandbox/doku/tools/check_workflow_static.py" 2>&1 | cut -c1-5; }
mk; ok "workflow asli lulus" "$(chk)" "PASS:"
mk; sed -i 's/^on:/on:\n  push:\n    branches: [main]/' "$RT/.github/workflows/doku-sandbox-runner.yml"; ok "menambah pemicu push ditolak" "$(chk)" "STOP:"
mk; sed -i 's/DOKU_DB_PASSWORD }}/DOKU_DB_PASSWORD }}\n          X: ${{ secrets.MIGRATION_DB_PASSWORD }}/' "$RT/.github/workflows/doku-sandbox-runner.yml"; ok "secret production ditolak" "$(chk)" "STOP:"
mk; sed -i "s/if: github.ref == 'refs\/heads\/main'/if: true/" "$RT/.github/workflows/doku-sandbox-runner.yml"; ok "hilang pembatas main ditolak" "$(chk)" "STOP:"
mk; sed -i 's/environment: doku-sandbox/environment: production-migration/' "$RT/.github/workflows/doku-sandbox-runner.yml"; ok "environment lain ditolak" "$(chk)" "STOP:"
mk; sed -i 's/run: command -v psql/uses: evil\/action@v1\n        run: command -v psql/' "$RT/.github/workflows/doku-sandbox-runner.yml"; ok "action pihak ketiga ditolak" "$(chk)" "STOP:"
echo "== HASIL: $pass lulus, $fail gagal"; [ $fail = 0 ]
