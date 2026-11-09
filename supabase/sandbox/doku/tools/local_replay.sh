#!/usr/bin/env bash
# LOCAL-ONLY: memutar ulang urutan sandbox di PostgreSQL SEKALI PAKAI. TIDAK PERNAH menyentuh Supabase.
# Menolak host non-lokal dan env kredensial. Satu-satunya perubahan pada SQL: baris "create extension pg_cron"
# dinonaktifkan secara lokal (tidak ada pg_cron di PG lokal); cron.schedule diganti stub di supabase_like_base.sql.
set -uo pipefail
HOST="${PGHOST:-/tmp}"; PORT="${PGPORT:-5432}"; USER_="${PGUSER:-postgres}"; DB="${REPLAY_DB:-doku_replay}"
case "$HOST" in /*|localhost|127.0.0.1|::1) ;; *) echo "REFUSED: PGHOST bukan lokal ($HOST)" >&2; exit 2;; esac
for k in SUPABASE_SECRET_KEY SUPABASE_SERVICE_ROLE_KEY DATABASE_URL POSTGRES_URL PGPASSWORD; do
  [ -z "${!k:-}" ] || { echo "REFUSED: $k terisi" >&2; exit 2; }
done
case "$DB" in *supabase*|*prod*) echo "REFUSED: nama DB mencurigakan" >&2; exit 2;; esac
here="$(cd "$(dirname "$0")/.." && pwd)"
PS() { psql -h "$HOST" -p "$PORT" -U "$USER_" -X -q "$@"; }
STEP="${1:-all}"
PS -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null || exit 1
run() { # file label [stripcron]
  local f="$here/$1"; local tmp; tmp="$(mktemp)"
  sed 's/^create extension if not exists pg_cron;/-- (lokal: pg_cron dinonaktifkan)/' "$f" > "$tmp"
  if out=$(PGOPTIONS="-c client_min_messages=warning" PS -d "$DB" -v ON_ERROR_STOP=1 -f "$tmp" 2>&1); then echo "OK   $1"; rm -f "$tmp"; return 0
  else echo "FAIL $1"; echo "$out" | head -6 | sed 's/^/     /'; rm -f "$tmp"; return 1; fi
}
PS -d "$DB" -v ON_ERROR_STOP=1 -f "$here/tools/local-only/supabase_like_base.sql" >/dev/null || { echo "FAIL base stub"; exit 1; }
echo "== preflight (pg_cron tidak tersedia lokal -> baris 10 diharapkan FAIL lokal saja)"; PS -d "$DB" -At -F'|' -f "$here/00_preflight_readonly.sql" | sed 's/^/   /'
run 01_shim_shared_objects.sql || exit 1
for f in "$here"/10_migrations_part_*.sql; do run "$(basename "$f")" || exit 1; done
[ "$STEP" = "migrations" ] && exit 0
[ -f "$here/20_seed_dummy.sql" ] && { run 20_seed_dummy.sql || exit 1; }
echo "== verify (read-only)"; PS -d "$DB" -At -F'|' -f "$here/30_verify_readonly.sql" | sed 's/^/   /'
echo "== smoke (menyalakan exception di akhir = rollback yang disengaja)"
PS -d "$DB" -At -f "$here/31_smoke_checkout_apply_rollback.sql" 2>&1 | grep -E "SMOKE|PASS|FAIL|ERROR" | sed 's/^/   /'
