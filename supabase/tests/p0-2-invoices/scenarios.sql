-- LOCAL-ONLY P0-2 invoice scenarios on a throw-away PostgreSQL. Synthetic data. Never run against Supabase.
-- Chain: B10 -> #74 -> B1 -> carryover -> B2 -> (real invoices table, webhook events, audit policies, Supabase default grants) -> P0-2.
\ir ../b2-double-payment/support/helpers.sql
create or replace function pg_temp.mk(n text, st text, plan_ text, startoff text, endoff text) returns void language plpgsql as $$
declare t uuid := ('00000000-0000-0000-0000-00000f02'||n)::uuid; u uuid := ('00000000-0000-0000-0000-00000f03'||n)::uuid;
begin
  insert into public.tenants(id,nama_usaha) values (t,'P02 '||n);
  insert into public.user_profiles values (u, t, 'owner '||n, 'owner');
  insert into public.prompter_subscriptions(tenant_id,plan,status,current_period_start,current_period_end,billing_provider)
  values (t, plan_, st, now()+startoff::interval, now()+endoff::interval, case when st='TRIALING' then null else 'midtrans' end);
end $$;
create or replace function pg_temp.t(n text) returns text language sql as $$ select '00000000-0000-0000-0000-00000f02'||n $$;
create or replace function pg_temp.u(n text) returns text language sql as $$ select '00000000-0000-0000-0000-00000f03'||n $$;
create or replace function pg_temp.co(n text, plan_ text) returns text language plpgsql as $$
begin return pg_temp.as_service(format($q$select out_outcome||':'||coalesce(out_transaction_id::text,'-') from public.fn_begin_checkout(%L::uuid,%L::uuid,%L,'midtrans')$q$, pg_temp.t(n), pg_temp.u(n), plan_)); end $$;
create or replace function pg_temp.cid(r text) returns uuid language sql as $$ select nullif(split_part(r,':',2),'-')::uuid $$;
create or replace function pg_temp.pay(txn uuid, tag text, amt numeric, cur text default 'IDR') returns text language plpgsql as $$
begin return pg_temp.as_service(format($q$select allowed::text||':'||coalesce(reason,'') from public.fn_apply_verified_payment(%L::uuid,%L,%L,%s,%L)$q$, txn, 'pay_'||tag, 'evt_'||tag, amt, cur)); end $$;
create or replace function pg_temp.endat(n text) returns timestamptz language plpgsql as $$ declare r timestamptz; begin select current_period_end into r from public.prompter_subscriptions where tenant_id = pg_temp.t(n)::uuid; return r; end $$;
create or replace function pg_temp.near(a timestamptz, b timestamptz) returns boolean language sql as $$ select abs(extract(epoch from (a-b))) < 300 $$;
create or replace function pg_temp.st(txn uuid) returns text language plpgsql as $$ declare r text; begin select status||'/'||coalesce(failure_reason,'') into r from public.prompter_payment_transactions where id = txn; return r; end $$;
create or replace function pg_temp.ss(n text) returns text language plpgsql as $$ declare r text; begin select status into r from public.prompter_subscriptions where tenant_id = pg_temp.t(n)::uuid; return r; end $$;
create or replace function pg_temp.sp(n text) returns text language plpgsql as $$ declare r text; begin select plan into r from public.prompter_subscriptions where tenant_id = pg_temp.t(n)::uuid; return r; end $$;
create or replace function pg_temp.sps(n text) returns text language plpgsql as $$ declare r text; begin select plan||'/'||status into r from public.prompter_subscriptions where tenant_id = pg_temp.t(n)::uuid; return r; end $$;
-- invoice helpers (plpgsql = fresh snapshot, so they see rows written by pay() in the same statement)
create or replace function pg_temp.ninv(txn uuid) returns bigint language plpgsql as $$ declare r bigint; begin select count(*) into r from public.prompter_invoices where transaction_id = txn; return r; end $$;
create or replace function pg_temp.ninv_t(n text) returns bigint language plpgsql as $$ declare r bigint; begin select count(*) into r from public.prompter_invoices where tenant_id = pg_temp.t(n)::uuid; return r; end $$;
create or replace function pg_temp.inv_end(txn uuid) returns timestamptz language plpgsql as $$ declare r timestamptz; begin select period_end into r from public.prompter_invoices where transaction_id = txn; return r; end $$;
create or replace function pg_temp.inv_start(txn uuid) returns timestamptz language plpgsql as $$ declare r timestamptz; begin select period_start into r from public.prompter_invoices where transaction_id = txn; return r; end $$;
create or replace function pg_temp.nsucc(n text) returns bigint language plpgsql as $$ declare r bigint; begin select count(*) into r from public.prompter_audit_logs where tenant_id = pg_temp.t(n)::uuid and action='payment.succeeded'; return r; end $$;

-- ===== S1. verified payment -> exactly one PAID invoice, tied to the right transaction and tenant =====
select pg_temp.mk('0001','TRIALING','FREE','-1 day','13 days');
create temp table s1 as select pg_temp.co('0001','STARTER') r;
select pg_temp.chk('S1 before payment there is no invoice', pg_temp.ninv(pg_temp.cid((select r from s1))) = 0);
select pg_temp.chk('S1 verified payment activates the plan', pg_temp.pay(pg_temp.cid((select r from s1)),'s1',99000) = 'true:' and pg_temp.sps('0001') = 'STARTER/ACTIVE');
select pg_temp.chk('S1 exactly one invoice for the transaction', pg_temp.ninv(pg_temp.cid((select r from s1))) = 1 and pg_temp.ninv_t('0001') = 1);
select pg_temp.chk('S1 invoice: PAID, right tenant / transaction / provider / amount / currency / reference',
  (select i.status = 'PAID' and i.tenant_id = pg_temp.t('0001')::uuid and i.transaction_id = pg_temp.cid((select r from s1)) and i.provider = 'midtrans'
          and i.amount = 99000 and i.currency = 'IDR' and i.external_invoice_id = 'pay_s1' and i.paid_at is not null and i.issued_at is not null
          and i.description = 'Langganan LINOE paket STARTER (1 bulan)'
   from public.prompter_invoices i where i.transaction_id = pg_temp.cid((select r from s1))));
select pg_temp.chk('S1 invoice and transaction agree (tenant, amount, currency)',
  (select i.tenant_id = x.tenant_id and i.amount = x.amount and i.currency = x.currency and x.status = 'PAID'
   from public.prompter_invoices i join public.prompter_payment_transactions x on x.id = i.transaction_id where x.id = pg_temp.cid((select r from s1))));
select pg_temp.chk('S1 audit row carries the invoice id', (select (context->>'invoice_id')::uuid = (select id from public.prompter_invoices where transaction_id = pg_temp.cid((select r from s1)))
   from public.prompter_audit_logs where tenant_id = pg_temp.t('0001')::uuid and action='payment.succeeded'));

-- ===== S2. the invoice period is the FINAL period (after the carryover trigger), proved with the real trigger =====
select pg_temp.chk('S2 invoice period_end == subscription current_period_end (exactly, incl. carryover)', pg_temp.inv_end(pg_temp.cid((select r from s1))) = pg_temp.endat('0001'));
select pg_temp.chk('S2 = now + 1 month + the 13 unused trial days', pg_temp.near(pg_temp.inv_end(pg_temp.cid((select r from s1))), now() + interval '1 month' + interval '13 days'));
select pg_temp.chk('S2 invoice period starts at the activation time', pg_temp.near(pg_temp.inv_start(pg_temp.cid((select r from s1))), now()));
-- carryover is capped at 14 days even when more is left; the invoice still equals the final subscription end
select pg_temp.mk('0002','TRIALING','FREE','-1 day','20 days');
create temp table s2 as select pg_temp.co('0002','STARTER') r;
select pg_temp.chk('S2b pay with 20 trial days left', pg_temp.pay(pg_temp.cid((select r from s2)),'s2',99000) = 'true:');
select pg_temp.chk('S2b carryover capped at 14 days and the invoice equals the final end', pg_temp.near(pg_temp.endat('0002'), now() + interval '1 month' + interval '14 days')
  and pg_temp.inv_end(pg_temp.cid((select r from s2))) = pg_temp.endat('0002'));
-- an expired trial has nothing to carry over
select pg_temp.mk('0003','TRIALING','FREE','-20 days','-2 days');
create temp table s3 as select pg_temp.co('0003','STARTER') r;
select pg_temp.chk('S2c expired trial: no bonus, invoice period = 1 month and equals the subscription', pg_temp.pay(pg_temp.cid((select r from s3)),'s3',99000) = 'true:'
  and pg_temp.near(pg_temp.inv_end(pg_temp.cid((select r from s3))), now() + interval '1 month') and pg_temp.inv_end(pg_temp.cid((select r from s3))) = pg_temp.endat('0003'));

-- ===== S4. second paid period stacks; invoices are contiguous, the bonus is not repeated =====
create temp table s4 as select pg_temp.co('0001','STARTER') r;
create temp table s4e as select pg_temp.endat('0001') e;
select pg_temp.chk('S4 second payment accepted', pg_temp.pay(pg_temp.cid((select r from s4)),'s4',99000) = 'true:');
select pg_temp.chk('S4 two invoices for the tenant, one per transaction', pg_temp.ninv_t('0001') = 2 and pg_temp.ninv(pg_temp.cid((select r from s4))) = 1);
select pg_temp.chk('S4 second invoice starts exactly where the first one ended', pg_temp.inv_start(pg_temp.cid((select r from s4))) = (select e from s4e));
select pg_temp.chk('S4 second invoice ends one month later = the subscription end (no second trial bonus)', pg_temp.inv_end(pg_temp.cid((select r from s4))) = (select e from s4e) + interval '1 month'
  and pg_temp.inv_end(pg_temp.cid((select r from s4))) = pg_temp.endat('0001'));
-- expired ACTIVE period restarts from now (no stacking on the past)
select pg_temp.mk('0004','ACTIVE','STARTER','-40 days','-3 days');
create temp table s5 as select pg_temp.co('0004','STARTER') r;
select pg_temp.chk('S4b expired ACTIVE: invoice period restarts from now', pg_temp.pay(pg_temp.cid((select r from s5)),'s5',99000) = 'true:'
  and pg_temp.near(pg_temp.inv_start(pg_temp.cid((select r from s5))), now()) and pg_temp.inv_end(pg_temp.cid((select r from s5))) = pg_temp.endat('0004'));

-- ===== S6. the same webhook many times: one invoice, nothing extended =====
select pg_temp.mk('0005','TRIALING','FREE','-1 day','13 days');
create temp table s6 as select pg_temp.co('0005','GROWTH') r;
create temp table s6d as select i, pg_temp.pay(pg_temp.cid((select r from s6)),'s6',199000) r from generate_series(1,10) i;
select pg_temp.chk('S6 10 deliveries: 1 applied + 9 ALREADY_PROCESSED', (select count(*) from s6d where r='true:') = 1 and (select count(*) from s6d where r='true:ALREADY_PROCESSED') = 9);
select pg_temp.chk('S6 still exactly one invoice, one audit row, period not extended', pg_temp.ninv(pg_temp.cid((select r from s6))) = 1 and pg_temp.ninv_t('0005') = 1 and pg_temp.nsucc('0005') = 1
  and pg_temp.inv_end(pg_temp.cid((select r from s6))) = pg_temp.endat('0005'));

-- ===== S7. payments that must NOT produce an invoice =====
select pg_temp.mk('0006','TRIALING','FREE','-1 day','13 days');
create temp table s7 as select pg_temp.co('0006','STARTER') r;
select pg_temp.chk('S7 wrong amount: REVIEW, no invoice, subscription untouched', pg_temp.pay(pg_temp.cid((select r from s7)),'s7',1000) = 'false:NEEDS_REVIEW'
  and pg_temp.st(pg_temp.cid((select r from s7))) = 'REVIEW/AMOUNT_OR_CURRENCY_MISMATCH' and pg_temp.ninv_t('0006') = 0 and pg_temp.ss('0006') = 'TRIALING');
select pg_temp.mk('0007','TRIALING','FREE','-1 day','13 days');
create temp table s8 as select pg_temp.co('0007','STARTER') r;
select pg_temp.chk('S7b wrong currency: REVIEW, no invoice', pg_temp.pay(pg_temp.cid((select r from s8)),'s8',99000,'USD') = 'false:NEEDS_REVIEW' and pg_temp.ninv_t('0007') = 0 and pg_temp.ss('0007') = 'TRIALING');
select pg_temp.chk('S7c replay of a REVIEW payment: still no invoice', pg_temp.pay(pg_temp.cid((select r from s8)),'s8',99000,'USD') = 'false:NEEDS_REVIEW' and pg_temp.ninv_t('0007') = 0);
select pg_temp.chk('S7d unknown transaction: no invoice anywhere new', pg_temp.pay(gen_random_uuid(),'s9',99000) = 'false:TRANSACTION_NOT_FOUND');
-- late payment after expiry, then resolution with gateway evidence -> exactly one invoice
select pg_temp.mk('0008','TRIALING','FREE','-1 day','13 days');
create temp table s10 as select pg_temp.co('0008','STARTER') r;
update public.prompter_payment_transactions set created_at = now() - interval '25 hours' where id = pg_temp.cid((select r from s10));
select pg_temp.chk('S7e stale sweep expires it', pg_temp.as_service('select public.fn_expire_stale_payment_transactions()::text') is not null and pg_temp.st(pg_temp.cid((select r from s10))) like 'EXPIRED/%');
select pg_temp.chk('S7f paid after expiry: REVIEW, no invoice', pg_temp.pay(pg_temp.cid((select r from s10)),'s10',99000) = 'false:NEEDS_REVIEW' and pg_temp.ninv_t('0008') = 0);
select pg_temp.chk('S7g resolver with matching gateway evidence applies it: exactly one invoice', pg_temp.as_service(format($q$select allowed::text||':'||coalesce(reason,'') from public.fn_resolve_review_payment(%L::uuid, 99000, 'IDR', 'pay_s10', 'PAID')$q$, pg_temp.cid((select r from s10)))) = 'true:'
  and pg_temp.ninv(pg_temp.cid((select r from s10))) = 1 and pg_temp.inv_end(pg_temp.cid((select r from s10))) = pg_temp.endat('0008') and pg_temp.near(pg_temp.endat('0008'), now() + interval '1 month' + interval '13 days'));
select pg_temp.chk('S7h resolver is not re-usable and never adds a second invoice', pg_temp.as_service(format($q$select reason from public.fn_resolve_review_payment(%L::uuid, 99000, 'IDR', 'pay_s10', 'PAID')$q$, pg_temp.cid((select r from s10)))) = 'NOT_IN_REVIEW'
  and pg_temp.ninv_t('0008') = 1);
-- plan conflict during a paid period -> REVIEW, no invoice
select pg_temp.mk('0009','TRIALING','FREE','-1 day','13 days');
create temp table s11 as select pg_temp.co('0009','PRO') r;
update public.prompter_subscriptions set plan='STARTER', status='ACTIVE', current_period_start=now(), current_period_end=now()+interval '20 days' where tenant_id = pg_temp.t('0009')::uuid;
select pg_temp.chk('S7i plan conflict: REVIEW, no invoice, plan unchanged', pg_temp.pay(pg_temp.cid((select r from s11)),'s11',399000) = 'false:NEEDS_REVIEW' and pg_temp.ninv_t('0009') = 0 and pg_temp.sp('0009') = 'STARTER');

-- ===== S12. partial failure: nothing is half-applied, the retry succeeds =====
-- (a) a clash on the OTHER unique key (provider, external_invoice_id) raises -> payment mark + activation roll back
select pg_temp.mk('0010','TRIALING','FREE','-1 day','13 days');
select pg_temp.mk('0011','TRIALING','FREE','-1 day','13 days');
create temp table s12 as select pg_temp.co('0010','STARTER') r;
insert into public.prompter_invoices(tenant_id, provider, external_invoice_id, status, amount) values (pg_temp.t('0011')::uuid, 'midtrans', 'pay_s12', 'PAID', 1);
create temp table s12e as select pg_temp.endat('0010') e;
select pg_temp.chk('S12a invoice clash surfaces as an error (gateway retries)', pg_temp.pay(pg_temp.cid((select r from s12)),'s12',99000) like '23505:%');
select pg_temp.chk('S12a nothing half-applied: txn PENDING, subscription untouched, no invoice, no success audit', pg_temp.st(pg_temp.cid((select r from s12))) = 'PENDING/' and pg_temp.ss('0010') = 'TRIALING'
  and pg_temp.endat('0010') = (select e from s12e) and pg_temp.ninv_t('0010') = 0 and pg_temp.nsucc('0010') = 0);
delete from public.prompter_invoices where external_invoice_id = 'pay_s12';
select pg_temp.chk('S12a retry after the clash is cleared: one invoice, active', pg_temp.pay(pg_temp.cid((select r from s12)),'s12',99000) = 'true:' and pg_temp.ninv_t('0010') = 1 and pg_temp.ss('0010') = 'ACTIVE');
-- (b) a failure while inserting the invoice
select pg_temp.mk('0012','TRIALING','FREE','-1 day','13 days');
create temp table s13 as select pg_temp.co('0012','STARTER') r;
create or replace function public.zz_boom_inv() returns trigger language plpgsql as $$ begin raise exception 'injected invoice failure'; end $$;
create trigger zz_boom_inv before insert on public.prompter_invoices for each row execute function public.zz_boom_inv();
select pg_temp.chk('S12b failure inside the invoice insert surfaces as an error', pg_temp.pay(pg_temp.cid((select r from s13)),'s13',99000) like 'P0001:%injected invoice failure%');
select pg_temp.chk('S12b nothing half-applied: txn PENDING, still TRIALING, no invoice', pg_temp.st(pg_temp.cid((select r from s13))) = 'PENDING/' and pg_temp.ss('0012') = 'TRIALING' and pg_temp.ninv_t('0012') = 0);
drop trigger zz_boom_inv on public.prompter_invoices; drop function public.zz_boom_inv();
select pg_temp.chk('S12b retry after the fault is cleared: exactly one invoice', pg_temp.pay(pg_temp.cid((select r from s13)),'s13',99000) = 'true:' and pg_temp.ninv_t('0012') = 1);
-- (c) a failure AFTER the invoice insert (audit row): the invoice must roll back with everything else
select pg_temp.mk('0013','TRIALING','FREE','-1 day','13 days');
create temp table s14 as select pg_temp.co('0013','STARTER') r;
create or replace function public.zz_boom_audit() returns trigger language plpgsql as $$ begin if new.action = 'payment.succeeded' then raise exception 'injected audit failure'; end if; return new; end $$;
create trigger zz_boom_audit before insert on public.prompter_audit_logs for each row execute function public.zz_boom_audit();
select pg_temp.chk('S12c failure after the invoice insert surfaces as an error', pg_temp.pay(pg_temp.cid((select r from s14)),'s14',99000) like 'P0001:%injected audit failure%');
select pg_temp.chk('S12c the invoice rolled back together with the activation', pg_temp.ninv_t('0013') = 0 and pg_temp.st(pg_temp.cid((select r from s14))) = 'PENDING/' and pg_temp.ss('0013') = 'TRIALING');
drop trigger zz_boom_audit on public.prompter_audit_logs; drop function public.zz_boom_audit();
select pg_temp.chk('S12c retry after the fault is cleared: exactly one invoice', pg_temp.pay(pg_temp.cid((select r from s14)),'s14',99000) = 'true:' and pg_temp.ninv_t('0013') = 1);
-- (d) the subscription UPDATE matching 0 rows (B2 guard) leaves no invoice
select pg_temp.mk('0014','TRIALING','FREE','-1 day','13 days');
create temp table s15 as select pg_temp.co('0014','STARTER') r;
create or replace function public.zz_skip() returns trigger language plpgsql as $$ begin return null; end $$;
create trigger zz_skip before update on public.prompter_subscriptions for each row execute function public.zz_skip();
select pg_temp.chk('S12d subscription UPDATE affecting 0 rows is still an ERROR', pg_temp.pay(pg_temp.cid((select r from s15)),'s15',99000) like 'P0001:SUBSCRIPTION_UPDATE_AFFECTED_0%');
select pg_temp.chk('S12d no invoice, transaction still PENDING', pg_temp.ninv_t('0014') = 0 and pg_temp.st(pg_temp.cid((select r from s15))) = 'PENDING/');
drop trigger zz_skip on public.prompter_subscriptions; drop function public.zz_skip();

-- ===== S16. one invoice per transaction is enforced by the database itself =====
select pg_temp.chk('S16 a second invoice for the same transaction is refused even for the table owner',
  (select pg_temp.dml_as(null, format($q$insert into public.prompter_invoices(tenant_id, transaction_id, provider, external_invoice_id, status, amount) values (%L::uuid, %L::uuid, 'midtrans', 'dup_x', 'PAID', 1)$q$, pg_temp.t('0001'), pg_temp.cid((select r from s1))), 'postgres')) like '23505:%');
select pg_temp.chk('S16b the idempotency index exists, is unique and partial',
  (select indisunique and pg_get_expr(indpred, indrelid) is not null from pg_index where indexrelid = 'public.uq_prompter_invoices_transaction'::regclass));
-- pre-existing style rows (no transaction) are still allowed several times (NULL transaction_id)
select pg_temp.chk('S16c rows without a transaction (legacy shape) are unaffected by the unique index',
  (select pg_temp.dml_as(null, $q$insert into public.prompter_invoices(tenant_id, status, amount) values ('00000000-0000-0000-0000-00000f020001', 'DRAFT', null), ('00000000-0000-0000-0000-00000f020001', 'DRAFT', null)$q$, 'postgres')) = 'ok:2');
delete from public.prompter_invoices where status = 'DRAFT' and tenant_id = pg_temp.t('0001')::uuid;

-- ===== S17. tenant isolation and privileges =====
select pg_temp.chk('S17a an Owner reads its OWN invoice', pg_temp.q_as(pg_temp.u('0001'), format($q$select count(*)::text from public.prompter_invoices where transaction_id = %L$q$, pg_temp.cid((select r from s1)))) = '1');
select pg_temp.chk('S17b another tenant cannot see it', pg_temp.q_as(pg_temp.u('0002'), format($q$select count(*)::text from public.prompter_invoices where transaction_id = %L$q$, pg_temp.cid((select r from s1)))) = '0');
select pg_temp.chk('S17c another tenant sees only its own invoices', pg_temp.q_as(pg_temp.u('0002'), $q$select count(*) filter (where tenant_id <> (select tenant_id from public.user_profiles where id = auth.uid()))::text from public.prompter_invoices$q$) = '0');
select pg_temp.chk('S17d anon sees nothing', coalesce(pg_temp.q_as(null, $q$select count(*)::text from public.prompter_invoices$q$, 'anon'), '0') in ('0') or pg_temp.q_as(null, $q$select count(*)::text from public.prompter_invoices$q$, 'anon') like '42501:%');
select pg_temp.chk('S17e a signed-in Owner cannot INSERT an invoice (even for its own tenant)', pg_temp.dml_as(pg_temp.u('0001'), format($q$insert into public.prompter_invoices(tenant_id, status, amount) values (%L::uuid, 'PAID', 99000)$q$, pg_temp.t('0001'))) like '42501:%');
select pg_temp.chk('S17f ... cannot UPDATE its invoice', pg_temp.dml_as(pg_temp.u('0001'), $q$update public.prompter_invoices set amount = 1$q$) like '42501:%');
select pg_temp.chk('S17g ... cannot DELETE its invoice', pg_temp.dml_as(pg_temp.u('0001'), $q$delete from public.prompter_invoices$q$) like '42501:%');
select pg_temp.chk('S17h ... cannot TRUNCATE the table', pg_temp.dml_as(pg_temp.u('0001'), $q$truncate public.prompter_invoices$q$) like '42501:%');
select pg_temp.chk('S17i anon cannot write either', pg_temp.dml_as(null, $q$insert into public.prompter_invoices(tenant_id, status, amount) values ('00000000-0000-0000-0000-00000f020001', 'PAID', 1)$q$, 'anon') like '42501:%');
select pg_temp.chk('S17j SELECT stays granted to authenticated (RLS decides) and service_role keeps full access',
  has_table_privilege('authenticated','public.prompter_invoices','select') and not has_table_privilege('authenticated','public.prompter_invoices','insert')
  and has_table_privilege('service_role','public.prompter_invoices','insert') and has_table_privilege('service_role','public.prompter_invoices','select'));
select pg_temp.chk('S17k RLS is still enabled with only the tenant SELECT policy', (select relrowsecurity from pg_class where oid = 'public.prompter_invoices'::regclass)
  and (select count(*) from pg_policies where schemaname='public' and tablename='prompter_invoices') = 1);
select pg_temp.chk('S17l function grants unchanged: only service_role may execute apply / resolve',
  not has_function_privilege('anon','public.fn_apply_verified_payment(uuid,text,text,numeric,text)','execute')
  and not has_function_privilege('authenticated','public.fn_apply_verified_payment(uuid,text,text,numeric,text)','execute')
  and has_function_privilege('service_role','public.fn_apply_verified_payment(uuid,text,text,numeric,text)','execute')
  and not has_function_privilege('authenticated','public.fn_resolve_review_payment(uuid,numeric,text,text,text)','execute'));
select pg_temp.chk('S17m the invoice tenant always comes from the transaction (an Owner cannot redirect it)', not exists
  (select 1 from public.prompter_invoices i join public.prompter_payment_transactions x on x.id = i.transaction_id where i.tenant_id <> x.tenant_id));

-- ===== S18. tenant deletion still cascades (the FK must not block data deletion) =====
select pg_temp.mk('0015','TRIALING','FREE','-1 day','13 days');
create temp table s18 as select pg_temp.co('0015','STARTER') r;
select pg_temp.chk('S18 paid invoice exists', pg_temp.pay(pg_temp.cid((select r from s18)),'s18',99000) = 'true:' and pg_temp.ninv_t('0015') = 1);
delete from public.user_profiles where tenant_id = pg_temp.t('0015')::uuid;
delete from public.tenants where id = pg_temp.t('0015')::uuid;
select pg_temp.chk('S18 deleting the tenant removed its invoice and transaction (no FK block)', (select count(*) from public.prompter_invoices where tenant_id = pg_temp.t('0015')::uuid) = 0
  and (select count(*) from public.prompter_payment_transactions where tenant_id = pg_temp.t('0015')::uuid) = 0);

-- ===== global invariants over every P0-2 test tenant =====
select pg_temp.chk('I1 every PAID transaction of the test tenants has exactly one invoice', not exists (select 1 from public.prompter_payment_transactions x
  where x.tenant_id::text like '00000000-0000-0000-0000-00000f02%' and x.status = 'PAID' and (select count(*) from public.prompter_invoices i where i.transaction_id = x.id) <> 1));
select pg_temp.chk('I2 every linked invoice is PAID and belongs to a PAID transaction of the same tenant', not exists (select 1 from public.prompter_invoices i left join public.prompter_payment_transactions x on x.id = i.transaction_id
  where i.transaction_id is not null and (x.status is distinct from 'PAID' or i.status <> 'PAID' or i.tenant_id <> x.tenant_id)));
select pg_temp.chk('I3 no REVIEW / PENDING / EXPIRED transaction has an invoice', not exists (select 1 from public.prompter_invoices i join public.prompter_payment_transactions x on x.id = i.transaction_id where x.status <> 'PAID'));
select pg_temp.chk('I4 every linked invoice period is positive and ends exactly at or before its tenant''s subscription end', not exists (select 1 from public.prompter_invoices i join public.prompter_subscriptions s using (tenant_id)
  where i.transaction_id is not null and (i.period_end <= i.period_start or i.period_end > s.current_period_end)));
select pg_temp.chk('I5 no test tenant has more than one PENDING transaction', not exists (select 1 from public.prompter_payment_transactions where status='PENDING' group by tenant_id having count(*) > 1));
