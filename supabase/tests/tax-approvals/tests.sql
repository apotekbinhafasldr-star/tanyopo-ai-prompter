\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
set client_min_messages = notice;

drop schema if exists tt cascade;
create schema tt;
grant usage on schema tt to public;
alter default privileges in schema tt grant execute on functions to public;
create or replace function tt.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAILED: %', label; end if;
  raise notice 'PASS: %', label;
end $$;

-- run sql, expect SQLSTATE
create or replace function tt.expect(sql text, state text, label text) returns void language plpgsql as $$
declare got text := 'none';
begin
  begin
    execute sql;
  exception when others then got := sqlstate;
  end;
  if got <> state then raise exception 'FAILED: % (expected %, got %)', label, state, got; end if;
  raise notice 'PASS: %', label;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'a@synthetic.invalid'),
  ('00000000-0000-0000-0000-0000000000f2', 'b@synthetic.invalid'),
  ('00000000-0000-0000-0000-0000000000a1', 'c@synthetic.invalid'),
  ('00000000-0000-0000-0000-0000000000a2', 'd@synthetic.invalid'),
  ('00000000-0000-0000-0000-0000000000c1', 'e@synthetic.invalid');

-- ============ access: no self-promotion, no escalation ============
select tt.ok(true, 'setup');
insert into public.finance_platform_admins (user_id, role) values ('00000000-0000-0000-0000-0000000000f1', 'SUPER_ADMIN');
select tt.ok((select count(*) from public.finance_platform_admins) = 1, 'first Super Admin can be bootstrapped (explicit statement)');
select tt.expect($q$insert into public.finance_platform_admins (user_id, role) values ('00000000-0000-0000-0000-0000000000f2', 'SUPER_ADMIN')$q$, '42501', 'a second Super Admin cannot be created without another Super Admin granting it');
select tt.expect($q$insert into public.finance_platform_admins (user_id, role, granted_by) values ('00000000-0000-0000-0000-0000000000a1', 'STAFF', null)$q$, '42501', 'staff cannot be created without a grantor');
select tt.expect($q$insert into public.finance_platform_admins (user_id, role, granted_by) values ('00000000-0000-0000-0000-0000000000a1', 'STAFF', '00000000-0000-0000-0000-0000000000a1')$q$, '42501', 'self-grant is refused');
insert into public.finance_platform_admins (user_id, role, granted_by, permissions) values ('00000000-0000-0000-0000-0000000000a1', 'STAFF', '00000000-0000-0000-0000-0000000000f1', array['tax.view']);
insert into public.finance_platform_admins (user_id, role, granted_by, permissions) values ('00000000-0000-0000-0000-0000000000a2', 'STAFF', '00000000-0000-0000-0000-0000000000f1', array['tax.view']);
select tt.expect($q$update public.finance_platform_admins set role = 'SUPER_ADMIN', granted_by = '00000000-0000-0000-0000-0000000000a1' where user_id = '00000000-0000-0000-0000-0000000000a1'$q$, '42501', 'staff cannot promote themselves to Super Admin');
select tt.expect($q$update public.finance_platform_admins set role = 'SUPER_ADMIN', granted_by = '00000000-0000-0000-0000-0000000000a2' where user_id = '00000000-0000-0000-0000-0000000000a1'$q$, '42501', 'staff cannot promote another staff to Super Admin');
select tt.expect($q$update public.finance_platform_admins set permissions = array['tax.view','tax.export'], granted_by = '00000000-0000-0000-0000-0000000000a1' where user_id = '00000000-0000-0000-0000-0000000000a1'$q$, '42501', 'staff cannot widen their own permissions');
select tt.expect($q$update public.finance_platform_admins set permissions = array['tax.optimization.approve'] where user_id = '00000000-0000-0000-0000-0000000000a1'$q$, '23514', 'the Founder-only approval permission can never be stored for a person');
update public.finance_platform_admins set permissions = array['tax.view','tax.export'], granted_by = '00000000-0000-0000-0000-0000000000f1' where user_id = '00000000-0000-0000-0000-0000000000a1';
select tt.ok(true, 'a Super Admin can widen staff permissions');
update public.finance_platform_admins set permissions = array['tax.view'] where user_id = '00000000-0000-0000-0000-0000000000a1';
select tt.ok(true, 'reducing permissions needs no grantor');
update public.finance_platform_admins set is_active = false where user_id = '00000000-0000-0000-0000-0000000000a2';
select tt.expect($q$update public.finance_platform_admins set is_active = true, granted_by = '00000000-0000-0000-0000-0000000000a1' where user_id = '00000000-0000-0000-0000-0000000000a2'$q$, '42501', 'staff cannot reactivate a revoked colleague');

-- ============ decisions ============
create or replace function tt.rec(actor uuid, req uuid, decision text, calc text, viewed_calc text, rules text, viewed_rules text, states text[], open_items int, refs text[], expected int, subject text default 'SCHEME_SELECTION:2026:PASAL_31E')
returns uuid language sql as $$
  select public.tax_opt_record_decision(actor, req, subject, 'SCHEME_SELECTION', '2026', decision,
    'Alasan keputusan yang cukup panjang', rules, viewed_rules, calc, viewed_calc, states, open_items, refs, null, expected)
$$;
\set H1 '''1111111111111111111111111111111111111111111111111111111111111111'''
\set H2 '''2222222222222222222222222222222222222222222222222222222222222222'''
\set F '''00000000-0000-0000-0000-0000000000f1'''
\set S '''00000000-0000-0000-0000-0000000000a1'''
\set C '''00000000-0000-0000-0000-0000000000c1'''

select tt.expect(format($q$select tt.rec(%L,gen_random_uuid(),'APPROVED',%L,%L,'rules-v1','rules-v1',array['TERVERIFIKASI'],0,'{}',0)$q$, :S, :H1, :H1), '42501', 'staff cannot approve');
select tt.expect(format($q$select tt.rec(%L,gen_random_uuid(),'APPROVED',%L,%L,'rules-v1','rules-v1',array['TERVERIFIKASI'],0,'{}',0)$q$, :C, :H1, :H1), '42501', 'a customer (no admin row) cannot approve');
select tt.expect(format($q$select tt.rec(%L,gen_random_uuid(),'APPROVED',%L,%L,'rules-v1','rules-v1',array['TERVERIFIKASI'],0,'{}',0)$q$, '00000000-0000-0000-0000-000000000999', :H1, :H1), '42501', 'an unknown identity cannot approve');
select tt.expect(format($q$select tt.rec(%L,gen_random_uuid(),'APPROVED',%L,%L,'rules-v1','rules-v1',array['SIMULASI'],0,'{}',0)$q$, :F, :H1, :H1), '23514', 'approval refuses simulated figures');
select tt.expect(format($q$select tt.rec(%L,gen_random_uuid(),'APPROVED',%L,%L,'rules-v1','rules-v1',array['TERVERIFIKASI'],2,'{}',0)$q$, :F, :H1, :H1), '23514', 'approval refuses open items');
select tt.expect(format($q$select tt.rec(%L,gen_random_uuid(),'APPROVED',%L,%L,'rules-v1','rules-v1','{}',0,'{}',0)$q$, :F, :H1, :H1), '23514', 'approval refuses an empty state list');
select tt.expect(format($q$select tt.rec(%L,gen_random_uuid(),'APPROVED',%L,%L,'rules-v1','rules-v1',array['TERVERIFIKASI'],0,array['https://example.invalid/doc.pdf'],0)$q$, :F, :H1, :H1), '23514', 'evidence reference cannot be a URL');
select tt.expect(format($q$select tt.rec(%L,gen_random_uuid(),'APPROVED',%L,%L,'rules-v1','rules-v1',array['TERVERIFIKASI'],0,array['../etc/passwd'],0)$q$, :F, :H1, :H1), '23514', 'evidence reference cannot be a path');
select tt.expect(format($q$select tt.rec(%L,gen_random_uuid(),'APPROVED',%L,%L,'rules-v1','rules-v1',array['TERVERIFIKASI'],0,'{}',0)$q$, :F, :H1, :H2), 'TO412', 'stale review: calculation changed since the Founder looked');
select tt.expect(format($q$select tt.rec(%L,gen_random_uuid(),'APPROVED',%L,%L,'rules-v2','rules-v1',array['TERVERIFIKASI'],0,'{}',0)$q$, :F, :H1, :H1), 'TO412', 'rules version mismatch is refused');
select tt.expect(format($q$select tt.rec(%L,gen_random_uuid(),'REVOKED',%L,%L,'rules-v1','rules-v1',array['TERVERIFIKASI'],0,'{}',0)$q$, :F, :H1, :H1), 'TO409', 'nothing to revoke yet');
select tt.ok((select count(*) from public.tax_opt_decisions) = 0, 'every refusal wrote nothing');

-- approve
select tt.rec(:F, '10000000-0000-0000-0000-000000000001', 'APPROVED', :H1, :H1, 'rules-v1', 'rules-v1', array['TERVERIFIKASI'], 0, array['BUKTI-001','PAYMENT#7'], 0) as id \gset a_
select tt.ok((select count(*) from public.tax_opt_decisions) = 1, 'Founder approval recorded');
select tt.ok((select seq = 1 and prev_hash is null and decision_by = :F::uuid and scope = 'INTERNAL_RECOMMENDATION_ONLY' from public.tax_opt_decisions), 'event 1 has actor, no predecessor, internal scope');
select tt.ok(public.tax_opt_effective_status('SCHEME_SELECTION:2026:PASAL_31E', :H1, 'rules-v1') = 'APPROVED_EFFECTIVE', 'approval is effective for the same calculation and rules');
select tt.ok(public.tax_opt_effective_status('SCHEME_SELECTION:2026:PASAL_31E', :H2, 'rules-v1') = 'STALE_CALC_CHANGED', 'changed calculation voids the effective approval');
select tt.ok(public.tax_opt_effective_status('SCHEME_SELECTION:2026:PASAL_31E', :H1, 'rules-v2') = 'STALE_RULES_CHANGED', 'changed rules version voids the effective approval');
select tt.ok(public.tax_opt_effective_status('SCHEME_SELECTION:2026:OTHER', :H1, 'rules-v1') = 'NONE', 'other subjects are unaffected');

-- double submission
select tt.ok(tt.rec(:F, '10000000-0000-0000-0000-000000000001', 'APPROVED', :H1, :H1, 'rules-v1', 'rules-v1', array['TERVERIFIKASI'], 0, '{}', 0)::text = :'a_id', 'replaying the same request id returns the stored decision');
select tt.ok((select count(*) from public.tax_opt_decisions) = 1, 'replay wrote nothing');
select tt.expect(format($q$select tt.rec(%L,'10000000-0000-0000-0000-000000000001','REVOKED',%L,%L,'rules-v1','rules-v1',array['TERVERIFIKASI'],0,'{}',1)$q$, :F, :H1, :H1), 'TO409', 'a request id cannot be reused for a different decision');
select tt.expect(format($q$select tt.rec(%L,gen_random_uuid(),'APPROVED',%L,%L,'rules-v1','rules-v1',array['TERVERIFIKASI'],0,'{}',1)$q$, :F, :H1, :H1), 'TO409', 'approving the same approved calculation again is refused');
select tt.expect(format($q$select tt.rec(%L,gen_random_uuid(),'REVOKED',%L,%L,'rules-v1','rules-v1',array['TERVERIFIKASI'],0,'{}',0)$q$, :F, :H1, :H1), 'TO409', 'a writer holding an old sequence is refused');
select tt.expect(format($q$select tt.rec(%L,gen_random_uuid(),'REJECTED',%L,%L,'rules-v1','rules-v1','{}',0,'{}',1)$q$, :F, :H1, :H1), 'TO409', 'an approval must be revoked before it can be rejected');

-- re-approve after calculation change, then revoke, then re-approve
select tt.rec(:F, gen_random_uuid(), 'APPROVED', :H2, :H2, 'rules-v1', 'rules-v1', array['TERVERIFIKASI'], 0, '{}', 1);
select tt.ok(public.tax_opt_effective_status('SCHEME_SELECTION:2026:PASAL_31E', :H2, 'rules-v1') = 'APPROVED_EFFECTIVE', 'a new approval after review becomes effective');
select tt.ok(public.tax_opt_effective_status('SCHEME_SELECTION:2026:PASAL_31E', :H1, 'rules-v1') = 'STALE_CALC_CHANGED', 'the earlier approval no longer applies');
select tt.rec(:F, gen_random_uuid(), 'REVOKED', :H2, :H2, 'rules-v1', 'rules-v1', array['TERVERIFIKASI'], 0, '{}', 2);
select tt.ok(public.tax_opt_effective_status('SCHEME_SELECTION:2026:PASAL_31E', :H2, 'rules-v1') = 'REVOKED', 'revocation is a new event and the status becomes REVOKED');
select tt.ok((select count(*) from public.tax_opt_decisions where subject_key = 'SCHEME_SELECTION:2026:PASAL_31E') = 3, 'history keeps all three events');
select tt.ok(public.tax_opt_verify_chain('SCHEME_SELECTION:2026:PASAL_31E'), 'hash chain verifies');

-- immutability (owner and role level)
select tt.expect($q$update public.tax_opt_decisions set reason = 'Diubah diam-diam sekali'$q$, '42501', 'UPDATE is blocked, even for the owner');
select tt.expect($q$delete from public.tax_opt_decisions$q$, '42501', 'DELETE is blocked, even for the owner');
select tt.expect($q$truncate public.tax_opt_decisions$q$, '42501', 'TRUNCATE is blocked, even for the owner');
set role service_role;
select tt.expect($q$insert into public.tax_opt_decisions (request_id, subject_key, seq, event_hash, recommendation_type, tax_year, decision, reason, decision_by, rules_version, calc_hash) values (gen_random_uuid(), 'SCHEME_SELECTION:2026:X', 1, repeat('0',64), 'SCHEME_SELECTION', '2026', 'APPROVED', 'Penyisipan langsung ke tabel', '00000000-0000-0000-0000-0000000000f1', 'rules-v1', repeat('1',64))$q$, '42501', 'service_role cannot insert directly (only the guarded function)');
select tt.expect($q$update public.tax_opt_decisions set reason = 'x'$q$, '42501', 'service_role cannot UPDATE');
select tt.expect($q$delete from public.tax_opt_decisions$q$, '42501', 'service_role cannot DELETE');
select tt.ok((select count(*) from public.tax_opt_decisions) = 3, 'service_role can read the log');
reset role;
set role anon;
select tt.expect($q$select * from public.tax_opt_decisions$q$, '42501', 'anon cannot read decisions');
select tt.expect($q$select public.tax_opt_effective_status('a','b','c')$q$, '42501', 'anon cannot call the status function');
reset role;
set role authenticated;
select tt.expect($q$select * from public.tax_opt_decisions$q$, '42501', 'a signed-in customer cannot read decisions');
select tt.expect($q$select public.tax_opt_record_decision(gen_random_uuid(),gen_random_uuid(),'SCHEME_SELECTION:2026:Z','SCHEME_SELECTION','2026','APPROVED','Alasan yang cukup','r','r',repeat('1',64),repeat('1',64),array['TERVERIFIKASI'],0,'{}',null,0)$q$, '42501', 'a signed-in customer cannot call the write function');
reset role;
set role service_role;
select tt.ok(public.tax_opt_verify_chain('SCHEME_SELECTION:2026:PASAL_31E'), 'service_role can verify the chain');
reset role;

-- RLS + privileges
select tt.ok((select relrowsecurity from pg_class where oid = 'public.tax_opt_decisions'::regclass), 'RLS is enabled');
select tt.ok((select count(*) from pg_policies where tablename = 'tax_opt_decisions') = 0, 'no policies: nothing is exposed through row access');
select tt.ok(not has_table_privilege('anon', 'public.tax_opt_decisions', 'select') and not has_table_privilege('authenticated', 'public.tax_opt_decisions', 'select'), 'anon and authenticated have no table privileges');
select tt.ok(not has_table_privilege('service_role', 'public.tax_opt_decisions', 'insert') and not has_table_privilege('service_role', 'public.tax_opt_decisions', 'update') and not has_table_privilege('service_role', 'public.tax_opt_decisions', 'delete') and not has_table_privilege('service_role', 'public.tax_opt_decisions', 'truncate'), 'service_role cannot write, update, delete or truncate the table');
select tt.ok(not has_function_privilege('public', 'public.tax_opt_record_decision(uuid,uuid,text,text,text,text,text,text,text,text,text,text[],integer,text[],text,integer)', 'execute'), 'PUBLIC cannot execute the write function');

-- no company data leaks into the table: no money, no document content
select tt.ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tax_opt_decisions' and column_name ~* '(amount|minor|price|npwp|nik|content|url|file|document|body)'), 'table has no amount, identity-number or document columns');

-- audit
select tt.ok((select count(*) from public.finance_audit_logs where entity_type = 'tax_opt_decisions') = 3, 'every decision is also written to the immutable audit log');

-- tamper evidence (needs a superuser to switch the guard off, to prove detection)
alter table public.tax_opt_decisions disable trigger trg_tax_opt_decisions_immutable;
create temp table tt_orig as select evidence_refs, accountant_verification_ref, figure_states, open_items from public.tax_opt_decisions where seq = 1 and subject_key = 'SCHEME_SELECTION:2026:PASAL_31E';
update public.tax_opt_decisions set evidence_refs = array['PALSU-999'] where seq = 1 and subject_key = 'SCHEME_SELECTION:2026:PASAL_31E';
select tt.ok(not public.tax_opt_verify_chain('SCHEME_SELECTION:2026:PASAL_31E'), 'silently replacing evidence references is detected');
update public.tax_opt_decisions d set evidence_refs = o.evidence_refs from tt_orig o where d.seq = 1 and d.subject_key = 'SCHEME_SELECTION:2026:PASAL_31E';
update public.tax_opt_decisions set accountant_verification_ref = 'AKT-PALSU' where seq = 1 and subject_key = 'SCHEME_SELECTION:2026:PASAL_31E';
select tt.ok(not public.tax_opt_verify_chain('SCHEME_SELECTION:2026:PASAL_31E'), 'replacing the accountant verification reference is detected');
update public.tax_opt_decisions d set accountant_verification_ref = o.accountant_verification_ref from tt_orig o where d.seq = 1 and d.subject_key = 'SCHEME_SELECTION:2026:PASAL_31E';
select tt.ok(public.tax_opt_verify_chain('SCHEME_SELECTION:2026:PASAL_31E'), 'chain verifies again after restoring the original values');
update public.tax_opt_decisions set reason = 'Dimanipulasi oleh superuser' where seq = 1 and subject_key = 'SCHEME_SELECTION:2026:PASAL_31E';
alter table public.tax_opt_decisions enable trigger trg_tax_opt_decisions_immutable;
select tt.ok(not public.tax_opt_verify_chain('SCHEME_SELECTION:2026:PASAL_31E'), 'tampering is detected by the hash chain');
