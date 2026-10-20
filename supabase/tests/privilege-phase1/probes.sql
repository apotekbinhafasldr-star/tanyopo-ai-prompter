\set ON_ERROR_STOP on
-- Behaviour probes. The SAME script runs on two clones built from identical fixtures: one WITHOUT and
-- one WITH the Phase-1 migration. The runner diffs the results: everything must be identical except
-- the intended closures listed in expected_changes.txt (which must flip to permission-denied 42501).
\set oa 'a1000000-0000-4000-8000-0000000000a1'
\set ma 'a2000000-0000-4000-8000-0000000000a2'
\set mk 'a3000000-0000-4000-8000-0000000000a3'
\set ob 'b1000000-0000-4000-8000-0000000000b1'
\set ta 'a0000000-0000-4000-8000-00000000000a'
\set tb 'b0000000-0000-4000-8000-00000000000b'

-- ===== legitimate READS must keep working (Owner A, Member A, tenant isolation B) =====
select t_run('authenticated', :'oa', 'read.ownerA.' || t, 'select * from ' || t)
  from unnest(array['prompter_subscriptions','prompter_payment_transactions','prompter_invoices','prompter_webhook_events',
                    'prompter_audit_logs','prompter_plan_entitlements','prompter_platform_capabilities','prompter_jobs',
                    'prompter_product_snapshots','prompter_ai_jobs','prompter_feature_flags','prompter_products',
                    'prompter_brand_profiles','prompter_connected_accounts']) t;
select t_run('authenticated', :'ma', 'read.memberA.subscriptions', 'select * from prompter_subscriptions');
select t_run('authenticated', :'ob', 'read.ownerB.subscriptions', 'select * from prompter_subscriptions');
select t_run('authenticated', :'ob', 'isolation.ownerB.sees_A_transactions', $q$select * from prompter_payment_transactions where tenant_id='a0000000-0000-4000-8000-00000000000a'$q$);
select t_run('authenticated', :'ob', 'isolation.ownerB.sees_A_invoices', $q$select * from prompter_invoices where tenant_id='a0000000-0000-4000-8000-00000000000a'$q$);
select t_run('authenticated', :'ob', 'isolation.ownerB.sees_A_ai_jobs', $q$select * from prompter_ai_jobs where tenant_id='a0000000-0000-4000-8000-00000000000a'$q$);
select t_run('authenticated', :'ob', 'isolation.ownerB.audit_insert_as_tenantA', $q$insert into prompter_audit_logs(tenant_id,actor_user_id,action,resource_type) values ('a0000000-0000-4000-8000-00000000000a',null,'x','x')$q$);

-- ===== flows that MUST stay open in Phase 1 (existing app paths) =====
select t_run('authenticated', :'oa', 'keep.audit_insert_own_tenant', $q$insert into prompter_audit_logs(tenant_id,actor_user_id,action,resource_type) values ('a0000000-0000-4000-8000-00000000000a','a1000000-0000-4000-8000-0000000000a1','probe.event','probe')$q$);
select t_run('authenticated', :'oa', 'keep.checkout_insert_pending_txn', $q$insert into prompter_payment_transactions(tenant_id,user_id,provider,plan,amount,currency) values ('a0000000-0000-4000-8000-00000000000a','a1000000-0000-4000-8000-0000000000a1','xendit','PRO',199000,'IDR')$q$);
select t_run('authenticated', :'oa', 'keep.changePlan_update_plan_column', $q$update prompter_subscriptions set plan='PRO' where tenant_id='a0000000-0000-4000-8000-00000000000a'$q$);
select t_run('authenticated', :'oa', 'keep.ai_job_rpc_create', $q$select * from fn_create_ai_job_if_entitled('CONTENT_GENERATION','{}'::jsonb)$q$);
select t_run('authenticated', :'oa', 'keep.ai_job_update_completed', $q$update prompter_ai_jobs set status='COMPLETED', completed_at=now() where id='a8000000-0000-4000-8000-0000000000a8'$q$);
select t_run('authenticated', :'oa', 'keep.ai_job_delete_not_configured', $q$delete from prompter_ai_jobs where id='a8000000-0000-4000-8000-0000000000a9'$q$);
select t_run('authenticated', :'mk', 'keep.marketing_ai_job_update', $q$update prompter_ai_jobs set status='FAILED' where tenant_id='a0000000-0000-4000-8000-00000000000a' and status='PROCESSING'$q$);
select t_run('authenticated', :'ma', 'deny.member_ai_job_update_rls', $q$update prompter_ai_jobs set status='FAILED' where tenant_id='a0000000-0000-4000-8000-00000000000a'$q$);
select t_run('authenticated', :'oa', 'keep.schedule_cancellation_rpc', $q$select * from fn_schedule_cancellation(true)$q$);

-- ===== service_role / cron / webhook / demo / queue (bypass RLS, own grants) =====
select t_run('service_role', null, 'svc.txn_select', 'select * from prompter_payment_transactions');
select t_run('service_role', null, 'svc.txn_update_session_id', $q$update prompter_payment_transactions set provider_payment_id='sess-1' where id='a9000000-0000-4000-8000-0000000000a9' and status='PENDING'$q$);
select t_run('service_role', null, 'svc.webhook_insert', $q$insert into prompter_webhook_events(tenant_id,source_system,external_event_id,event_type,status) values ('a0000000-0000-4000-8000-00000000000a','xendit','evt-probe-1','payment','RECEIVED')$q$);
select t_run('service_role', null, 'svc.webhook_update', $q$update prompter_webhook_events set status='PROCESSED' where external_event_id='evt-probe-1'$q$);
select t_run('service_role', null, 'svc.audit_insert', $q$insert into prompter_audit_logs(tenant_id,action,resource_type) values ('a0000000-0000-4000-8000-00000000000a','probe.svc','probe')$q$);
select t_run('service_role', null, 'svc.oauth_credentials_upsert', $q$insert into prompter_oauth_credentials(tenant_id,connected_account_id,encrypted_access_token) values ('a0000000-0000-4000-8000-00000000000a','a6000000-0000-4000-8000-0000000000a6','FIXTURE2') on conflict (connected_account_id) do update set encrypted_access_token=excluded.encrypted_access_token$q$);
select t_run('service_role', null, 'svc.oauth_credentials_select', 'select * from prompter_oauth_credentials');
select t_run('service_role', null, 'svc.jobs_insert', $q$insert into prompter_jobs(tenant_id,job_type) values ('a0000000-0000-4000-8000-00000000000a','ANALYTICS_SYNC')$q$);
select t_run('service_role', null, 'svc.jobs_update', $q$update prompter_jobs set status='RUNNING' where id='a7000000-0000-4000-8000-0000000000a7'$q$);
select t_run('service_role', null, 'svc.jobs_claim_rpc', $q$select * from prompter_claim_next_job(array['ANALYTICS_SYNC'])$q$);
select t_run('service_role', null, 'svc.entitlements_select', 'select * from prompter_plan_entitlements');
select t_run('service_role', null, 'svc.invoice_insert', $q$insert into prompter_invoices(tenant_id,provider,external_invoice_id,status,amount,currency) values ('a0000000-0000-4000-8000-00000000000a','xendit','inv-probe-1','OPEN',1,'IDR')$q$);
select t_run('service_role', null, 'svc.demo_ai_usage_rpc', $q$select * from fn_consume_demo_ai_usage('probe-session', 5)$q$);
select t_run('service_role', null, 'svc.apply_verified_payment_webhook_activation', $q$select * from fn_apply_verified_payment('a9000000-0000-4000-8000-0000000000a9','pay-probe-1','evt-probe-2',99000,'IDR')$q$);
select t_run('postgres', null, 'cron.apply_expired_subscriptions', 'select fn_apply_expired_subscriptions()');
select t_run('postgres', null, 'cron.expire_stale_payment_transactions', 'select fn_expire_stale_payment_transactions()');
select t_run('postgres', null, 'cron.apply_scheduled_cancellations', 'select fn_apply_scheduled_cancellations()');

-- ===== INTENDED CLOSURES (see expected_changes.txt) =====
select t_run('anon', null, 'anon.select.' || t, 'select * from ' || t) from unnest(array['prompter_subscriptions','prompter_payment_transactions','prompter_invoices','prompter_plan_entitlements','prompter_feature_flags','prompter_platform_capabilities','prompter_products','prompter_oauth_credentials']) t;
select t_run('anon', null, 'anon.insert.audit_logs', $q$insert into prompter_audit_logs(tenant_id,action,resource_type) values ('a0000000-0000-4000-8000-00000000000a','anon','anon')$q$);
select t_run('anon', null, 'anon.insert.subscriptions', $q$insert into prompter_subscriptions(tenant_id,status,plan) values ('b0000000-0000-4000-8000-00000000000b','TRIALING','FREE')$q$);
select t_run('anon', null, 'anon.delete.payment_transactions', 'delete from prompter_payment_transactions');
select t_run('authenticated', :'oa', 'closed.update.payment_transactions', $q$update prompter_payment_transactions set status='PAID', paid_at=now() where id='a9000000-0000-4000-8000-0000000000a9'$q$);
select t_run('authenticated', :'oa', 'closed.delete.payment_transactions', 'delete from prompter_payment_transactions');
select t_run('authenticated', :'oa', 'closed.update.audit_logs', $q$update prompter_audit_logs set action='tampered'$q$);
select t_run('authenticated', :'oa', 'closed.delete.audit_logs', 'delete from prompter_audit_logs');
select t_run('authenticated', :'oa', 'closed.delete.subscriptions', 'delete from prompter_subscriptions');
select t_run('authenticated', :'oa', 'closed.insert.invoices', $q$insert into prompter_invoices(tenant_id,provider,external_invoice_id,status,amount,currency) values ('a0000000-0000-4000-8000-00000000000a','xendit','forged','PAID',1,'IDR')$q$);
select t_run('authenticated', :'oa', 'closed.update.invoices', $q$update prompter_invoices set status='VOID'$q$);
select t_run('authenticated', :'oa', 'closed.delete.invoices', 'delete from prompter_invoices');
select t_run('authenticated', :'oa', 'closed.insert.webhook_events', $q$insert into prompter_webhook_events(tenant_id,source_system,external_event_id,event_type,status) values ('a0000000-0000-4000-8000-00000000000a','xendit','forged','payment','PROCESSED')$q$);
select t_run('authenticated', :'oa', 'closed.update.webhook_events', $q$update prompter_webhook_events set status='FAILED'$q$);
select t_run('authenticated', :'oa', 'closed.delete.webhook_events', 'delete from prompter_webhook_events');
select t_run('authenticated', :'oa', 'closed.update.plan_entitlements', $q$update prompter_plan_entitlements set ai_usage_allowance=999999$q$);
select t_run('authenticated', :'oa', 'closed.delete.plan_entitlements', 'delete from prompter_plan_entitlements');
select t_run('authenticated', :'oa', 'closed.update.jobs', $q$update prompter_jobs set status='SUCCEEDED'$q$);
select t_run('authenticated', :'oa', 'closed.delete.jobs', 'delete from prompter_jobs');
select t_run('authenticated', :'oa', 'closed.update.platform_capabilities', $q$update prompter_platform_capabilities set status='AVAILABLE'$q$) where exists (select 1 from information_schema.columns where table_name='prompter_platform_capabilities' and column_name='status');
select t_run('authenticated', :'oa', 'closed.delete.product_snapshots', 'delete from prompter_product_snapshots');
select t_run('authenticated', :'oa', 'closed.select.oauth_credentials', 'select * from prompter_oauth_credentials');
select t_run('authenticated', :'oa', 'closed.delete.oauth_credentials', 'delete from prompter_oauth_credentials');

-- ===== TRUNCATE (ignores RLS) — last, because the "before" clone really loses its rows =====
select t_run('authenticated', :'oa', 'truncate.authenticated.' || c.relname, format('truncate table public.%I cascade', c.relname))
  from pg_class c join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' where c.relkind='r' and c.relname like 'prompter\_%' order by c.relname;
select t_run('anon', null, 'truncate.anon.' || c.relname, format('truncate table public.%I cascade', c.relname))
  from pg_class c join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' where c.relkind='r' and c.relname like 'prompter\_%' order by c.relname;
