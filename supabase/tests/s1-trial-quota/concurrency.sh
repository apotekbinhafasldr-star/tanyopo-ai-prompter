#!/usr/bin/env bash
# Parallel-session proof (real separate backends) for the AI quota: exactly `allowance` grants per tenant, never more,
# tenants independent. Local throw-away DB only. usage: concurrency.sh <database>
set -euo pipefail
db="${1:?database}"
case "${PGHOST:-}" in ""|/*|localhost|127.0.0.1|::1) ;; *) echo "refusing non-local PGHOST" >&2; exit 2 ;; esac
p() { psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$db" "$@"; }
A=00000000-0000-0000-0000-0000000000a1; B=00000000-0000-0000-0000-0000000000b1
UA=00000000-0000-0000-0000-0000000000a2; UB=00000000-0000-0000-0000-0000000000b2
p <<SQL
insert into tenants(id,nama_usaha) values ('$A','A'),('$B','B') on conflict do nothing;
insert into user_profiles values ('$UA','$A','owner A','owner'),('$UB','$B','owner B','owner') on conflict do nothing;
insert into prompter_subscriptions(tenant_id,status,current_period_start,current_period_end) values
  ('$A','TRIALING',now(),now()+interval '14 days'),('$B','TRIALING',now(),now()+interval '14 days') on conflict do nothing;
SQL
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
call() { # <uid> <outfile>
  printf "set role authenticated;\nselect set_config('request.jwt.claims', json_build_object('sub','%s','role','authenticated')::text, false);\nselect allowed from fn_create_ai_job_if_entitled('CONTENT_GENERATION','{}'::jsonb);\n" "$1" | psql -X -q -t -A -d "$db" 2>&1 | grep -E '^(t|f)$' > "$2" || echo err > "$2"
}
for n in $(seq 1 45); do call "$UA" "$tmp/a_$n" & done
for n in $(seq 1 45); do call "$UB" "$tmp/b_$n" & done
wait
ga=$(cat "$tmp"/a_* | grep -c '^t$' || true); gb=$(cat "$tmp"/b_* | grep -c '^t$' || true)
err=$(cat "$tmp"/* | grep -c '^err$' || true)
ra=$(p -c "select count(*) from prompter_ai_jobs where tenant_id='$A'"); rb=$(p -c "select count(*) from prompter_ai_jobs where tenant_id='$B'")
echo "concurrency: tenant A granted=$ga rows=$ra; tenant B granted=$gb rows=$rb; errors=$err"
[ "$ga" = 30 ] && [ "$gb" = 30 ] && [ "$ra" = 30 ] && [ "$rb" = 30 ] && [ "$err" = 0 ] || { echo "FAIL concurrency: expected exactly 30 grants and 30 rows per tenant"; exit 1; }
# a second wave after exhaustion: nothing more is ever granted
for n in $(seq 1 10); do call "$UA" "$tmp/c_$n" & done; wait
gc=$(cat "$tmp"/c_* | grep -c '^t$' || true); [ "$gc" = 0 ] || { echo "FAIL: $gc grants after exhaustion"; exit 1; }
echo "CONCURRENCY PASS"
