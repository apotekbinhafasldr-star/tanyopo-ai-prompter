\set ON_ERROR_STOP on
-- Catalog assertions on the DB AFTER Phase 1 (requires t_matrix_before loaded from the pre-migration clone).
create function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is not true then raise exception 'ASSERTION FAILED: %', msg; end if; raise notice 'PASS: %', msg; end $$;

create table t_matrix_after as select * from t_matrix();
do $$
declare n int;
begin
  perform t_ok(not exists (select 1 from t_matrix_after where priv='TRUNCATE' and role in ('anon','authenticated') and granted), 'TRUNCATE not granted to anon/authenticated on ANY prompter_* table');
  perform t_ok(not exists (select 1 from t_matrix_after where priv in ('REFERENCES','TRIGGER','MAINTAIN') and role in ('anon','authenticated') and granted), 'REFERENCES/TRIGGER/MAINTAIN not granted to anon/authenticated on ANY prompter_* table');
  perform t_ok(case when current_setting('server_version_num')::int >= 170000
                    then exists (select 1 from t_matrix_after where priv='MAINTAIN') else not exists (select 1 from t_matrix_after where priv='MAINTAIN') end,
               'MAINTAIN is in the matrix exactly when the server is PostgreSQL 17+ (server_version_num ' || current_setting('server_version_num') || ')');
  perform t_ok(not exists (select 1 from t_matrix_after where role='anon' and priv<>'COLUMN_UPDATE_PLAN' and granted), 'anon holds no privilege on ANY prompter_* table');
  perform t_ok(not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace and n.nspname='public', aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                           where c.relkind='r' and c.relname like 'prompter\_%' and a.grantee = 0), 'PUBLIC holds no privilege on ANY prompter_* table');
  -- service_role: byte-identical (and still holds everything it held, incl. TRUNCATE)
  perform t_ok(not exists (select 1 from t_matrix_before b join t_matrix_after a using (tbl, role, priv) where role='service_role' and b.granted is distinct from a.granted), 'service_role privileges unchanged on every prompter_* table');
  perform t_ok((select count(*) from t_matrix_after where role='service_role' and granted) = (select count(*) from t_matrix_before where role='service_role' and granted)
               and (select count(*) from t_matrix_after where role='service_role' and granted) > 0, 'service_role still holds every privilege it held (count identical, non-zero)');
  perform t_ok((select count(*) from t_matrix_before) = (select count(*) from t_matrix_after), 'matrix has the same cells before and after (no table appeared or vanished)');
  -- column-level grants: nothing appeared; only column REFERENCES / the oauth vault may disappear
  perform t_ok(not exists (select 1 from t_colacl() a where a.entry not in (select entry from t_colacl_before)), 'no column-level grant appeared');
  perform t_ok(not exists (select 1 from t_colacl_before b where b.entry not in (select entry from t_colacl()) and b.entry !~ ':REFERENCES$' and b.entry !~ '^prompter_oauth_credentials\.'), 'no column-level grant was lost (except column REFERENCES / oauth vault)');
  perform t_ok(not exists (select 1 from t_matrix_before b join t_matrix_after a using (tbl, role, priv) where not b.granted and a.granted), 'no privilege was GAINED by anyone');

  -- everything lost by authenticated is on the explicit list
  perform t_ok(not exists (
    select 1 from t_matrix_before b join t_matrix_after a using (tbl, role, priv)
     where b.role='authenticated' and b.granted and not a.granted and priv not in ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')
       and not (
            (tbl in ('prompter_invoices','prompter_jobs','prompter_plan_entitlements','prompter_platform_capabilities','prompter_product_snapshots','prompter_webhook_events') and priv in ('INSERT','UPDATE','DELETE'))
         or (tbl in ('prompter_audit_logs','prompter_payment_transactions') and priv in ('UPDATE','DELETE'))
         or (tbl = 'prompter_subscriptions' and priv = 'DELETE')
         or (tbl = 'prompter_oauth_credentials'))),
    'authenticated lost ONLY the explicitly listed DML privileges (+TRUNCATE/REFERENCES/TRIGGER/MAINTAIN)');

  -- explicit "must still hold" (only asserted when the pre-migration state had it, so PR #31/#45 stay compatible)
  for n in 1..1 loop
    perform t_ok(not exists (select 1 from t_matrix_before b join t_matrix_after a using (tbl,role,priv)
                where role='authenticated' and b.granted and not a.granted
                  and ((tbl='prompter_ai_jobs' and priv in ('SELECT','INSERT','UPDATE','DELETE'))
                    or (tbl='prompter_payment_transactions' and priv in ('SELECT','INSERT'))
                    or (tbl='prompter_subscriptions' and priv in ('SELECT','INSERT','COLUMN_UPDATE_PLAN'))
                    or (tbl='prompter_audit_logs' and priv in ('SELECT','INSERT')))),
      'ai_jobs S/I/U/D, payment_transactions S/I, subscriptions S/I + UPDATE(plan), audit_logs S/I untouched');
  end loop;
  perform t_ok(not exists (select 1 from t_matrix_before b join t_matrix_after a using (tbl,role,priv)
              where role='authenticated' and b.granted and not a.granted and priv in ('SELECT','INSERT','UPDATE','DELETE')
                and tbl in ('prompter_analytics_insights','prompter_approvals','prompter_attributions','prompter_automation_settings','prompter_autopilot_policies',
                            'prompter_brand_profiles','prompter_budget_policies','prompter_channel_campaigns','prompter_compliance_flags','prompter_connected_accounts',
                            'prompter_content_items','prompter_conversions','prompter_feature_flags','prompter_follower_snapshots','prompter_growth_goals',
                            'prompter_marketing_blueprints','prompter_marketing_metrics','prompter_master_campaigns','prompter_optimization_recommendations',
                            'prompter_product_media','prompter_products','prompter_promotion_handoffs','prompter_seo_projects','prompter_seo_recommendations')),
    'authenticated keeps SELECT/INSERT/UPDATE/DELETE on all 24 policy-backed user-session tables (incl. the RLS-inert DELETE cells, deferred to Phase 2)');
  perform t_ok(not exists (select 1 from t_matrix_before b join t_matrix_after a using (tbl,role,priv)
              where role='authenticated' and priv='SELECT' and b.granted and not a.granted and tbl <> 'prompter_oauth_credentials'),
    'authenticated SELECT preserved on every table except the service-role-only OAuth vault');

  -- RLS / policies / functions / ownership not touched
  perform t_ok((select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' where c.relname like 'prompter\_%' and c.relkind='r' and not c.relrowsecurity) = 0, 'RLS still enabled on every prompter_* table');
  perform t_ok((select md5(string_agg(tablename||policyname||cmd||coalesce(qual,'')||coalesce(with_check,''), '|' order by tablename, policyname)) from pg_policies where schemaname='public')
             = (select v from t_pre where k='policies'), 'policies byte-identical to pre-migration');
  perform t_ok((select md5(string_agg(p.oid::regprocedure::text||p.prosecdef||coalesce(p.proacl::text,''), '|' order by p.oid::regprocedure::text)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace and n.nspname='public' where p.proname !~ '^t_')
             = (select v from t_pre where k='functions'), 'functions + EXECUTE grants byte-identical to pre-migration');
  perform t_ok((select md5(string_agg(c.relname||pg_get_userbyid(c.relowner), '|' order by c.relname)) from pg_class c join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' where c.relkind='r' and c.relname !~ '^t_')
             = (select v from t_pre where k='owners'), 'table owners unchanged');
  perform t_ok((select md5(string_agg(defaclrole::regrole::text||defaclnamespace::regnamespace::text||defaclobjtype::text||defaclacl::text, '|' order by defaclrole::regrole::text, defaclnamespace::regnamespace::text, defaclobjtype::text)) from pg_default_acl)
             = (select v from t_pre where k='defacl'), 'ALTER DEFAULT PRIVILEGES untouched');
  perform t_ok((select md5(string_agg(c.relname||coalesce(c.relacl::text,''), '|' order by c.relname)) from pg_class c join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' where c.relkind='r' and c.relname !~ '^(t_|prompter_)')
             = (select v from t_pre where k='acl_nonprompter'), 'ACLs of every NON-prompter table (tenants, user_profiles, sibling products) unchanged');
  perform t_ok((select coalesce(md5(string_agg(c.relname||coalesce(c.relacl::text,''), '|' order by c.relname)),'none') from pg_class c join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' where c.relkind in ('S','v','m'))
             = (select v from t_pre where k='acl_seq_views'), 'sequence/view ACLs unchanged');
end $$;
