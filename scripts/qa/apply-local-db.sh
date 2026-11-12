#!/usr/bin/env bash
# QA-1: menyiapkan basis data LOKAL sementara (Supabase lokal di runner CI): shim objek bersama, simulasi handle_new_user,
# lalu SEMUA migrasi repo berurutan. Menolak host non-lokal dan kredensial produksi (scripts/qa/local-stack-guard.mjs).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-54322}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}" PGDATABASE=postgres
node "$here/local-stack-guard.mjs"
case "$PGHOST" in 127.0.0.1|localhost) ;; *) echo "REFUSED: PGHOST=$PGHOST" >&2; exit 2;; esac
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
echo "== shim objek bersama (tenants, user_profiles, fungsi tenant) -- disimulasikan, bukan salinan produksi"
P -f "$root/supabase/sandbox/doku/01_shim_shared_objects.sql" >/dev/null
echo "== simulasi handle_new_user"
P -f "$root/qa/supabase-local/sql/01_handle_new_user_simulation.sql" >/dev/null
n=0
for f in "$root"/supabase/migrations/*.sql; do
  echo "== migrasi $(basename "$f")"
  P -f "$f" >/dev/null
  n=$((n+1))
done
echo "== $n migrasi diterapkan; memuat ulang skema PostgREST"
P -c "notify pgrst, 'reload schema'" >/dev/null
sleep 3
echo "APPLY_LOCAL_DB_OK migrations=$n"
