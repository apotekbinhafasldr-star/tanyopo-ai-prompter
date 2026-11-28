-- FIXTURE SINTETIS untuk gladi bersih (rehearsal) pipeline produksi. BUKAN migrasi nyata, TIDAK pernah dipasang ke database mana pun
-- selain PostgreSQL sementara di CI. Mengikuti POLA L1 (policy storage + bucket) dan Paket 3 (trigger guard + ACL + purge terkunci),
-- bentuk N (transaksi sendiri: begin ... commit). Semua nama bersifat fiktif (prefix "FX"/"fx").
begin;

set local lock_timeout = '3s';
set local statement_timeout = '10s';

do $$
declare
  v_ref record;
  v_pol record;
  v_count bigint;
begin
  for v_ref in select * from (values ('fx-reserved-1', 1048576::bigint), ('fx-reserved-2', 2097152::bigint)) as t(id, lim) loop
    if exists (select 1 from storage.buckets b where b.id = v_ref.id)
       and not exists (select 1 from storage.buckets b where b.id = v_ref.id and b.file_size_limit is not distinct from v_ref.lim) then
      raise exception 'FX GUARD GAGAL: bucket cadangan tidak cocok sidik.' using errcode = 'P0001';
    end if;
  end loop;
  for v_pol in select p.policyname from pg_policies p
      where p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname not like 'FX tenant %'
        and (coalesce(p.qual, '') || coalesce(p.with_check, '')) like '%fx-reserved-%' loop
    raise exception 'FX GUARD GAGAL: policy pihak lain % menyebut bucket cadangan.', v_pol.policyname using errcode = 'P0001';
  end loop;
  select count(*) into v_count from storage.objects where bucket_id in ('fx-reserved-1', 'fx-reserved-2');
  if v_count > 0 then
    raise exception 'FX GUARD GAGAL: % objek ada di bucket cadangan.', v_count using errcode = 'P0001';
  end if;
end
$$;

drop policy if exists "FX tenant all" on storage.objects;

update storage.buckets set public = false where id in ('fx-reserved-1', 'fx-reserved-2') and public is distinct from false;

create policy "FX tenant select" on storage.objects for select
  using (bucket_id in ('fx-live', 'fx-reserved-1', 'fx-reserved-2') and (storage.foldername(name))[1] = public.fn_fx_current_tenant()::text);
create policy "FX tenant insert" on storage.objects for insert
  with check (bucket_id = 'fx-live' and (storage.foldername(name))[1] = public.fn_fx_current_tenant()::text);
create policy "FX tenant update" on storage.objects for update
  using (bucket_id = 'fx-live' and (storage.foldername(name))[1] = public.fn_fx_current_tenant()::text)
  with check (bucket_id = 'fx-live' and (storage.foldername(name))[1] = public.fn_fx_current_tenant()::text);
create policy "FX tenant delete" on storage.objects for delete
  using (bucket_id = 'fx-live' and (storage.foldername(name))[1] = public.fn_fx_current_tenant()::text);

create or replace function public.fn_fx_block_audit_change() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  raise exception 'FX AUDIT TERKUNCI: perubahan baris audit ditolak.' using errcode = 'P0001';
end
$$;

create trigger trg_fx_audit_no_update before update on public.fx_audit_logs for each row execute function public.fn_fx_block_audit_change();

revoke update, delete, truncate on public.fx_audit_logs from anon, authenticated, service_role;
revoke truncate on storage.objects from anon, authenticated;
comment on table public.fx_audit_logs is 'FX audit: UPDATE ditolak oleh trigger (fixture sintetis).';

create or replace function public.fn_fx_evidence_purge(p_before timestamptz) returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_n bigint;
begin
  delete from public.fx_evidence where created_at < p_before;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
revoke all on function public.fn_fx_evidence_purge(timestamptz) from public, anon, authenticated, service_role;

commit;
