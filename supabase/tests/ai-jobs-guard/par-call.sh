#!/usr/bin/env bash
# one RPC call in its own session/transaction as the given user id; prints true|false
psql -h "${HOST:-/tmp}" -p "${PORT:-5544}" -U "${USER_:-postgres}" -X -q -At -d "$pdb" <<SQL | grep -E '^(true|false)$'
begin;
select set_config('request.jwt.claims', json_build_object('sub','$1','role','authenticated')::text, true);
set local role authenticated;
select allowed::text from public.fn_create_ai_job_if_entitled('CONTENT_GENERATION','{}');
commit;
SQL
