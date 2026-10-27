#!/usr/bin/env bash
# Real parallel backends against a throw-away database prepared by run-local.sh.
set -uo pipefail
DB="$1"; HOST="${PGHOST:-/tmp}"; PORT="${PGPORT:-5544}"; USER_="${PGUSER:-postgres}"
PA() { psql -h "$HOST" -p "$PORT" -U "$USER_" -d "$DB" -X -q -At "$@"; }
F=00000000-0000-0000-0000-0000000000f1
PA -c "insert into auth.users (id,email) values ('$F','f@synthetic.invalid') on conflict do nothing" -c "insert into public.finance_platform_admins (user_id, role) values ('$F','SUPER_ADMIN') on conflict do nothing" >/dev/null
H=$(printf '1%.0s' $(seq 1 64))
call() { # <request uuid> <subject> <expected_seq> <decision> <calc>
  PA -c "select public.tax_opt_record_decision('$F','$1','$2','SCHEME_SELECTION','2026','$4','Alasan keputusan yang cukup','rules-v1','rules-v1','$5','$5',array['TERVERIFIKASI'],0,'{}',null,$3)" 2>&1
}
W=$(mktemp -d)
# 1) 12 concurrent writers with DIFFERENT request ids and the same expected sequence: exactly one wins
for i in $(seq 1 12); do ( call "$(cat /proc/sys/kernel/random/uuid)" "SCHEME_SELECTION:2026:RACE_A" 0 APPROVED "$H" >"$W/a$i" ) & done; wait
ok=$(grep -lE '^[0-9a-f-]{36}$' "$W"/a* 2>/dev/null | wc -l); bad=$(grep -l 'TO409\|another decision was recorded first\|already approved' "$W"/a* 2>/dev/null | wc -l)
rows=$(PA -c "select count(*) from public.tax_opt_decisions where subject_key='SCHEME_SELECTION:2026:RACE_A'")
# 2) the SAME request id submitted 12 times in parallel: one row, every caller sees the same id
REQ=$(cat /proc/sys/kernel/random/uuid)
for i in $(seq 1 12); do ( call "$REQ" "SCHEME_SELECTION:2026:RACE_B" 0 APPROVED "$H" >"$W/b$i" ) & done; wait
ids=$(cat "$W"/b* | grep -E '^[0-9a-f-]{36}$' | sort -u | wc -l); rowsb=$(PA -c "select count(*) from public.tax_opt_decisions where subject_key='SCHEME_SELECTION:2026:RACE_B'")
chain=$(PA -c "select public.tax_opt_verify_chain('SCHEME_SELECTION:2026:RACE_A') and public.tax_opt_verify_chain('SCHEME_SELECTION:2026:RACE_B')")
echo "concurrency: race winners=$ok losers=$bad rows=$rows; same-request replays distinct_ids=$ids rows=$rowsb; chain=$chain"
[ "$ok" = 1 ] && [ "$rows" = 1 ] && [ "$ids" = 1 ] && [ "$rowsb" = 1 ] && [ "$chain" = t ]
