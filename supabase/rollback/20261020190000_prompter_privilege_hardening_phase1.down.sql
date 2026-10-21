-- FAIL-CLOSED ROLLBACK for 20261020190000_prompter_privilege_hardening_phase1.sql  (replaces the mass-restore script)
--
-- WHY THE OLD SCRIPT WAS REMOVED: it re-granted `select, insert, update, delete, truncate` to anon + authenticated
-- on 35 tables. After PR #31 / #44 / #45 that re-opens 240 privilege cells they had closed (UPDATE on prompter_ai_jobs
-- => created_at mutable => quota reset; INSERT on prompter_payment_transactions; TRUNCATE; all of anon ...).
-- A rollback must never be able to undo a security fix, whatever order the PRs were applied in.
--
-- WHAT THIS DOES INSTEAD: a targeted forward-fix. You must name the exact `table:PRIVILEGE` pairs a verified broken
-- flow needs. Only the 9 pairs in c_allowed can ever be restored, and only for `authenticated`:
--     psql -v ON_ERROR_STOP=1 -v pairs='prompter_jobs:UPDATE,prompter_product_snapshots:INSERT' -f <this file>
-- It is all-or-nothing (one transaction) and fail-closed:
--   * no pairs / any pair outside c_allowed / unknown table  => refused, nothing changes;
--   * NEVER restored: TRUNCATE, REFERENCES, TRIGGER, anything for anon, ai_jobs, payment_transactions, invoices,
--     webhook_events, plan_entitlements, audit_logs UPDATE/DELETE, subscriptions DELETE/UPDATE, oauth_credentials
--     (financial evidence, quota, trial and credential vault);
--   * post-check: exactly the named cells changed, nothing else (no anon, no TRUNCATE, no other table/role/privilege).
-- Anything beyond that needs its own reviewed migration (and Founder approval), not a rollback.
-- NOT placed in supabase/migrations on purpose (never auto-applied).

\set ON_ERROR_STOP on
\if :{?pairs}
\else
  \set pairs ''
\endif
select set_config('rb.pairs', :'pairs', false) \gset

do $down$
declare
  c_allowed constant text[] := array[
    'prompter_jobs:INSERT','prompter_jobs:UPDATE','prompter_jobs:DELETE',
    'prompter_platform_capabilities:INSERT','prompter_platform_capabilities:UPDATE','prompter_platform_capabilities:DELETE',
    'prompter_product_snapshots:INSERT','prompter_product_snapshots:UPDATE','prompter_product_snapshots:DELETE'
  ];
  v_raw text := btrim(current_setting('rb.pairs'));
  v_pairs text[];
  v_pair text;
  v_norm text[] := '{}';
  v_t text;
  v_p text;
  before_s jsonb;
  after_s jsonb;
  k text;
  expected_changes text[] := '{}';
begin
  perform set_config('lock_timeout', '5s', true);
  if v_raw = '' then
    raise exception 'refused: name the exact table:PRIVILEGE pairs to restore (see header); a blanket restore does not exist';
  end if;

  v_pairs := string_to_array(regexp_replace(v_raw, '\s', '', 'g'), ',');
  foreach v_pair in array v_pairs loop
    v_t := lower(split_part(v_pair, ':', 1));
    v_p := upper(split_part(v_pair, ':', 2));
    if not ((v_t || ':' || v_p) = any (c_allowed)) then
      raise exception 'refused: %:% is never restored by a rollback (TRUNCATE/anon/financial/quota/trial/vault, or not removed by Phase 1)', v_t, v_p;
    end if;
    if to_regclass('public.' || v_t) is null then
      raise exception 'refused: public.% does not exist', v_t;
    end if;
    v_norm := v_norm || (v_t || ':' || v_p);
  end loop;

  select jsonb_object_agg(c.relname || ':' || r.r || ':' || p.p, has_table_privilege(r.r, c.oid, p.p)) into before_s
    from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    cross join (values ('anon'),('authenticated')) r(r)
    cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(p)
   where c.relkind = 'r' and c.relname like 'prompter\_%';

  foreach v_pair in array v_norm loop
    v_t := split_part(v_pair, ':', 1); v_p := split_part(v_pair, ':', 2);
    execute format('grant %s on public.%I to authenticated', v_p, v_t);   -- authenticated ONLY, never anon
    if not coalesce((before_s ->> (v_t || ':authenticated:' || v_p))::boolean, false) then
      expected_changes := expected_changes || (v_t || ':authenticated:' || v_p);
    end if;
  end loop;

  select jsonb_object_agg(c.relname || ':' || r.r || ':' || p.p, has_table_privilege(r.r, c.oid, p.p)) into after_s
    from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    cross join (values ('anon'),('authenticated')) r(r)
    cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(p)
   where c.relkind = 'r' and c.relname like 'prompter\_%';

  for k in select key from jsonb_each(after_s) a(key, value) where value is distinct from before_s -> key loop
    if not (k = any (expected_changes)) then
      raise exception 'rollback post-check failed: unexpected privilege change %', k;
    end if;
  end loop;
  if (select count(*) from jsonb_each(after_s) a(key, value) where value is distinct from before_s -> key) <> coalesce(array_length(expected_changes, 1), 0) then
    raise exception 'rollback post-check failed: changed cells differ from the named pairs';
  end if;
  raise notice 'restored % cell(s) for authenticated only: %', coalesce(array_length(expected_changes, 1), 0), expected_changes;
end
$down$;
