-- FIXTURE SINTETIS: rollback bentuk N dari 20990101000000_fixture_native_txn.sql (hanya untuk gladi bersih CI).
begin;

set local lock_timeout = '3s';
set local statement_timeout = '10s';

drop policy if exists "FX tenant select" on storage.objects;
drop policy if exists "FX tenant insert" on storage.objects;
drop policy if exists "FX tenant update" on storage.objects;
drop policy if exists "FX tenant delete" on storage.objects;

update storage.buckets set public = true where id in ('fx-reserved-1', 'fx-reserved-2') and public is distinct from true;

create policy "FX tenant all" on storage.objects for all
  using (bucket_id in ('fx-live', 'fx-reserved-1', 'fx-reserved-2') and (storage.foldername(name))[1] = public.fn_fx_current_tenant()::text)
  with check (bucket_id in ('fx-live', 'fx-reserved-1', 'fx-reserved-2') and (storage.foldername(name))[1] = public.fn_fx_current_tenant()::text);

drop trigger if exists trg_fx_audit_no_update on public.fx_audit_logs;
drop function public.fn_fx_block_audit_change();
drop function public.fn_fx_evidence_purge(timestamptz);

grant update, delete, truncate on public.fx_audit_logs to service_role;
grant truncate on storage.objects to anon, authenticated;
comment on table public.fx_audit_logs is null;

commit;
