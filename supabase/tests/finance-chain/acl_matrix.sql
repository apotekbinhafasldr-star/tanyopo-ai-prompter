-- Privilege matrix of every finance, accounting and approval object for PUBLIC, anon, authenticated and service_role.
-- One line per (kind, object, role, privileges). A role with no privilege has no line. The owner is not listed.
-- Where an ACL is NULL the built-in default is used (acldefault), so an implicit PUBLIC EXECUTE on a function is visible too.
select line from (
  select 'table ' || c.relname || ' ' || r.role || ' ' || r.privs as line
    from pg_class c
    cross join lateral (
      select case a.grantee when 0 then 'public' else a.grantee::regrole::text end as role,
             string_agg(a.privilege_type, ',' order by a.privilege_type) as privs
        from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
       where a.grantee <> c.relowner and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated', 'service_role'))
       group by 1) r
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.relname ~ '^(acct_|finance_|tax_opt_)'
  union all
  select 'sequence ' || c.relname || ' ' || r.role || ' ' || r.privs
    from pg_class c
    cross join lateral (
      select case a.grantee when 0 then 'public' else a.grantee::regrole::text end as role,
             string_agg(a.privilege_type, ',' order by a.privilege_type) as privs
        from aclexplode(coalesce(c.relacl, acldefault('s', c.relowner))) a
       where a.grantee <> c.relowner and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated', 'service_role'))
       group by 1) r
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'S' and c.relname ~ '^(acct_|finance_|tax_opt_)'
  union all
  select 'function ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || r.role || ' ' || r.privs
    from pg_proc p
    cross join lateral (
      select case a.grantee when 0 then 'public' else a.grantee::regrole::text end as role,
             string_agg(a.privilege_type, ',' order by a.privilege_type) as privs
        from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       where a.grantee <> p.proowner and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated', 'service_role'))
       group by 1) r
   where p.pronamespace = 'public'::regnamespace and p.proname ~ '^(fn_finance_|fn_acct_|fn_tax_opt_|tax_opt_)'
) m
order by line;
