-- FAIL-CLOSED ROLLBACK for 20261020190000_prompter_privilege_hardening_phase1.sql  (replaces the mass-restore script)
-- PLAIN SQL: no psql meta-commands, no psql variables. Runs unchanged in the Supabase SQL editor, `psql -f`, or any client.
--
-- WHY THE OLD SCRIPT WAS REMOVED: it re-granted `select, insert, update, delete, truncate` to anon + authenticated
-- on 35 tables. After PR #31 / #44 / #45 that re-opens 240 privilege cells they had closed (UPDATE on prompter_ai_jobs
-- => created_at mutable => quota reset; INSERT on prompter_payment_transactions; TRUNCATE; all of anon ...).
-- A rollback must never be able to undo a security fix, whatever order the PRs were applied in.
--
-- HOW TO USE (only after a verified broken flow and Founder approval; never first on production):
--   1. Copy this file. In the copy replace the text REPLACE_WITH_PAIRS (inside the single quotes, line marked `-- EDIT`)
--      with the exact comma-separated `table:PRIVILEGE` pairs the broken flow needs, e.g.
--          'prompter_jobs:UPDATE,prompter_product_snapshots:INSERT'
--   2. Run the copy. Left unedited it REFUSES (fail-closed): there is no blanket restore.
--
-- It is all-or-nothing (one DO block = one transaction) and fail-closed:
--   * placeholder left in place / empty / malformed / any pair outside c_allowed / unknown table      => refused, nothing changes;
--   * only the 9 cells in c_allowed (INSERT/UPDATE/DELETE on jobs, platform_capabilities, product_snapshots) and ONLY for
--     `authenticated`;
--   * a cell is restored only if it is RLS-INERT: RLS is enabled on the table AND no policy covers that command. Granting it
--     therefore cannot create a working write path; if a policy exists or RLS is off the request is refused;
--   * NEVER restored: TRUNCATE, REFERENCES, TRIGGER, MAINTAIN, anything for anon / PUBLIC / service_role, ai_jobs,
--     payment_transactions, invoices, webhook_events, plan_entitlements, audit_logs UPDATE/DELETE, subscriptions
--     DELETE/UPDATE, oauth_credentials (financial evidence, quota, trial and credential vault);
--   * post-check: exactly the named cells changed (for anon/authenticated/service_role on all 8 privileges, plus column
--     ACLs); nothing else, nothing removed. Otherwise the whole transaction aborts.
-- Anything beyond that needs its own reviewed migration (and Founder approval), not a rollback.
-- NOT placed in supabase/migrations on purpose (never auto-applied).

do $down$
declare
  v_raw text := 'REPLACE_WITH_PAIRS';   -- EDIT: exact table:PRIVILEGE pairs, comma separated
  c_allowed constant text[] := array[
    'prompter_jobs:INSERT','prompter_jobs:UPDATE','prompter_jobs:DELETE',
    'prompter_platform_capabilities:INSERT','prompter_platform_capabilities:UPDATE','prompter_platform_capabilities:DELETE',
    'prompter_product_snapshots:INSERT','prompter_product_snapshots:UPDATE','prompter_product_snapshots:DELETE'
  ];
  v_pairs text[];
  v_pair text;
  v_norm text[] := '{}';
  v_t text;
  v_p text;
  v_cmd "char";
  before_s jsonb;
  after_s jsonb;
  col_before text[];
  col_after text[];
  k text;
  expected_changes text[] := '{}';
  v_maint boolean := current_setting('server_version_num')::int >= 170000;
begin
  perform set_config('lock_timeout', '5s', true);
  v_raw := btrim(v_raw);
  if v_raw = '' or v_raw = 'REPLACE_WITH_PAIRS' then
    raise exception 'refused: name the exact table:PRIVILEGE pairs to restore (see header); a blanket restore does not exist';
  end if;
  if v_raw !~ '^[A-Za-z_]+:[A-Za-z]+(\s*,\s*[A-Za-z_]+:[A-Za-z]+)*$' then
    raise exception 'refused: malformed pair list (expected table:PRIVILEGE,table:PRIVILEGE,...)';
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
    v_cmd := case v_p when 'INSERT' then 'a' when 'UPDATE' then 'w' else 'd' end;
    if not exists (select 1 from pg_class c where c.oid = to_regclass('public.' || v_t) and c.relkind = 'r' and c.relrowsecurity) then
      raise exception 'refused: RLS is not enabled on public.% - restoring % could open a direct write path', v_t, v_p;
    end if;
    if exists (select 1 from pg_policy po where po.polrelid = to_regclass('public.' || v_t) and po.polcmd in (v_cmd, '*')) then
      raise exception 'refused: a policy covers % on public.% - restoring it would not be RLS-inert', v_p, v_t;
    end if;
    v_norm := v_norm || (v_t || ':' || v_p);
  end loop;

  select jsonb_object_agg(c.relname || ':' || r.r || ':' || p.p, has_table_privilege(r.r, c.oid, p.p)) into before_s
    from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    cross join (values ('anon'),('authenticated'),('service_role')) r(r)
    cross join (select p from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']
                                     || case when v_maint then array['MAINTAIN'] else array[]::text[] end) p) p
   where c.relkind = 'r' and c.relname like 'prompter\_%';
  select coalesce(array_agg(a.attrelid::regclass::text || '.' || a.attname || ':' || x.grantee::regrole::text || ':' || x.privilege_type order by a.attrelid::regclass::text, a.attname, x.grantee, x.privilege_type), '{}') into col_before
    from pg_attribute a join pg_class c on c.oid = a.attrelid and c.relname like 'prompter\_%' and c.relnamespace = 'public'::regnamespace
    cross join lateral aclexplode(a.attacl) x
   where a.attacl is not null and not a.attisdropped;

  foreach v_pair in array v_norm loop
    v_t := split_part(v_pair, ':', 1); v_p := split_part(v_pair, ':', 2);
    execute format('grant %s on public.%I to authenticated', v_p, v_t);   -- authenticated ONLY, never anon/PUBLIC
    if not coalesce((before_s ->> (v_t || ':authenticated:' || v_p))::boolean, false) then
      expected_changes := expected_changes || (v_t || ':authenticated:' || v_p);
    end if;
  end loop;

  select jsonb_object_agg(c.relname || ':' || r.r || ':' || p.p, has_table_privilege(r.r, c.oid, p.p)) into after_s
    from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    cross join (values ('anon'),('authenticated'),('service_role')) r(r)
    cross join (select p from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']
                                     || case when v_maint then array['MAINTAIN'] else array[]::text[] end) p) p
   where c.relkind = 'r' and c.relname like 'prompter\_%';
  select coalesce(array_agg(a.attrelid::regclass::text || '.' || a.attname || ':' || x.grantee::regrole::text || ':' || x.privilege_type order by a.attrelid::regclass::text, a.attname, x.grantee, x.privilege_type), '{}') into col_after
    from pg_attribute a join pg_class c on c.oid = a.attrelid and c.relname like 'prompter\_%' and c.relnamespace = 'public'::regnamespace
    cross join lateral aclexplode(a.attacl) x
   where a.attacl is not null and not a.attisdropped;

  for k in select key from jsonb_each(after_s) a(key, value) where value is distinct from before_s -> key loop
    if not (k = any (expected_changes)) then
      raise exception 'rollback post-check failed: unexpected privilege change %', k;
    end if;
  end loop;
  if (select count(*) from jsonb_each(after_s) a(key, value) where value is distinct from before_s -> key) <> coalesce(array_length(expected_changes, 1), 0) then
    raise exception 'rollback post-check failed: changed cells differ from the named pairs';
  end if;
  if col_before is distinct from col_after then
    raise exception 'rollback post-check failed: column-level grants changed';
  end if;
  if exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) x
              where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'prompter\_%' and x.grantee = 0) then
    raise exception 'rollback post-check failed: PUBLIC holds a privilege';
  end if;
  raise notice 'restored % cell(s) for authenticated only: %', coalesce(array_length(expected_changes, 1), 0), expected_changes;
end
$down$;
