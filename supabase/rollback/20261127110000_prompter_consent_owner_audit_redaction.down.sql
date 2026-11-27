-- Rollback untuk 20261127110000_prompter_consent_owner_audit_redaction.sql. Idempoten. Mengembalikan fungsi ke isi migrasi 20261127100000.
-- Urutan: jalankan rollback INI lebih dulu, baru rollback 20261127100000 bila perlu.
-- AMAN: menolak (RAISE) bila prompter_consent_events memuat baris ber-text_sha256 (hash akan hilang), kecuali linoe.drop_evidence=YA.
-- Praktis: sejak consent_set baru dipakai, text_sha256 selalu terisi, jadi rollback ini butuh ekspor dulu lalu linoe.drop_evidence=YA.
-- Baris audit yang SUDAH dianonimisasi TIDAK dapat dipulihkan (sengaja). Tidak menyentuh auth.users, tenants, atau tabel produk lain.
begin;

set local lock_timeout = '3s';
set local statement_timeout = '10s';

do $$
begin
  if to_regclass('public.prompter_consent_events') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'prompter_consent_events' and column_name = 'text_sha256') then
    if (select count(*) from public.prompter_consent_events where text_sha256 is not null) > 0
       and coalesce(current_setting('linoe.drop_evidence', true), '') <> 'YA' then
      raise exception 'ROLLBACK BERHENTI: peristiwa persetujuan memuat text_sha256; ekspor dahulu atau set linoe.drop_evidence=YA';
    end if;
  end if;
end $$;

-- Fungsi operator dan helper dibuang lebih dulu.
drop function if exists public.fn_prompter_audit_pii_canary_scan(uuid);
drop function if exists public.fn_prompter_audit_redact(text, uuid, boolean, integer);
drop function if exists public.fn_prompter_audit_redact_doc(jsonb, text);
drop function if exists public.fn_prompter_audit_row_needs_redaction(text, jsonb, jsonb, jsonb);
drop function if exists public.fn_prompter_consent_check_tenant(uuid, text, uuid);
drop function if exists public.fn_prompter_consent_set(text, text, text, uuid);

-- Guard audit, pendaftaran, consent_set 3 argumen, dan status kembali ke versi 20261127100000.
-- Hanya bila objek migrasi pertama masih ada (bila sudah di-rollback lebih dulu, bagian ini dilewati).
do $down$
begin
  if to_regclass('public.prompter_consent_events') is not null and to_regclass('public.prompter_consent_catalog') is not null
     and to_regclass('public.prompter_legal_document_events') is not null then
    execute $fn$
create or replace function public.fn_prompter_audit_logs_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.tenants t where t.id = old.tenant_id) then
    return old;
  end if;
  raise exception 'prompter_audit_logs tidak menerima % lewat jalur ini (guard LINOE)', tg_op using errcode = '42501';
end;
$$;
    $fn$;
    execute $fn$
create or replace function public.fn_prompter_record_signup_legal(p_user_id uuid, p_terms_version integer, p_privacy_version integer)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_terms integer;
  v_privacy integer;
begin
  if p_user_id is null or p_terms_version is null or p_privacy_version is null
     or p_terms_version not between 1 and 10000 or p_privacy_version not between 1 and 10000 then
    raise exception 'argumen tidak valid' using errcode = '22023';
  end if;
  insert into public.prompter_legal_document_events (subject_user_id, tenant_id, doc_code, version, event, source)
  values (p_user_id, null, 'TERMS', p_terms_version, 'ACCEPTED', 'REGISTER')
  on conflict (subject_user_id, doc_code, version, event) do nothing;
  get diagnostics v_terms = row_count;
  insert into public.prompter_legal_document_events (subject_user_id, tenant_id, doc_code, version, event, source)
  values (p_user_id, null, 'PRIVACY_NOTICE', p_privacy_version, 'DELIVERED', 'REGISTER')
  on conflict (subject_user_id, doc_code, version, event) do nothing;
  get diagnostics v_privacy = row_count;
  return jsonb_build_object('terms_recorded', v_terms = 1, 'privacy_notice_recorded', v_privacy = 1);
end;
$$;
    $fn$;
    execute $fn$
create or replace function public.fn_prompter_consent_set(p_code text, p_action text, p_source text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_cat public.prompter_consent_catalog;
  v_last public.prompter_consent_events;
  v_tenant uuid := null;
  v_row public.prompter_consent_events;
begin
  if v_uid is null then
    raise exception 'tidak terautentikasi' using errcode = '28000';
  end if;
  if p_code is null or p_action is null or p_source is null or p_action not in ('GRANTED', 'WITHDRAWN') or p_source not in ('SETTINGS', 'CONNECT_FLOW') then
    raise exception 'argumen tidak valid' using errcode = '22023';
  end if;

  -- Pemberian: hanya kode AKTIF. Penarikan: selalu boleh untuk kode terdaftar, termasuk yang sudah tidak aktif.
  select * into v_cat from public.prompter_consent_catalog c
   where c.code = p_code and (p_action = 'WITHDRAWN' or c.active)
   order by c.version desc limit 1;
  if not found then
    raise exception 'kode persetujuan tidak dikenal atau tidak aktif' using errcode = '22023';
  end if;
  if p_action = 'WITHDRAWN' and not v_cat.withdrawable then
    raise exception 'persetujuan ini tidak dapat ditarik lewat jalur ini' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('linoe.consent:' || v_uid::text || ':' || p_code, 0));

  select * into v_last from public.prompter_consent_events e
   where e.subject_user_id = v_uid and e.code = p_code
   order by e.occurred_at desc, e.id desc limit 1;

  if found and v_last.action = p_action and (p_action = 'WITHDRAWN' or v_last.version = v_cat.version) then
    return jsonb_build_object('code', p_code, 'version', v_last.version, 'status', v_last.action, 'changed', false, 'occurred_at', v_last.occurred_at);
  end if;
  if not found and p_action = 'WITHDRAWN' then
    return jsonb_build_object('code', p_code, 'version', v_cat.version, 'status', 'NO_RECORD', 'changed', false, 'occurred_at', null);
  end if;

  begin
    v_tenant := public.fn_current_tenant_id();
  exception when others then
    v_tenant := null;
  end;

  insert into public.prompter_consent_events (subject_user_id, tenant_id, code, version, action, source)
  values (v_uid, v_tenant, p_code, case when p_action = 'WITHDRAWN' and found then v_last.version else v_cat.version end, p_action, p_source)
  returning * into v_row;
  return jsonb_build_object('code', p_code, 'version', v_row.version, 'status', v_row.action, 'changed', true, 'occurred_at', v_row.occurred_at);
end;
$$;
    $fn$;
    execute $fn$
create or replace function public.fn_prompter_consent_my_status()
returns table (code text, version integer, purpose_id text, text_id text, status text, occurred_at timestamptz)
language sql
stable
set search_path = pg_catalog, public
as $$
  select c.code, c.version, c.purpose_id, c.text_id,
         case when e.id is null then 'NOT_GIVEN'
              when e.action = 'GRANTED' and e.version = c.version then 'GRANTED'
              when e.action = 'GRANTED' then 'OUTDATED'
              else 'WITHDRAWN' end,
         e.occurred_at
  from public.prompter_consent_catalog c
  left join lateral (
    select x.* from public.prompter_consent_events x
     where x.subject_user_id = auth.uid() and x.code = c.code
     order by x.occurred_at desc, x.id desc limit 1
  ) e on true
  where c.active and c.version = (select max(m.version) from public.prompter_consent_catalog m where m.code = c.code and m.active)
  order by c.code;
$$;
    $fn$;
    execute $fn$ revoke all on function public.fn_prompter_audit_logs_guard() from public, anon, authenticated, service_role $fn$;
    execute $fn$ revoke all on function public.fn_prompter_record_signup_legal(uuid, integer, integer) from public, anon, authenticated, service_role $fn$;
    execute $fn$ revoke all on function public.fn_prompter_consent_set(text, text, text) from public, anon, authenticated, service_role $fn$;
    execute $fn$ revoke all on function public.fn_prompter_consent_my_status() from public, anon, authenticated, service_role $fn$;
    execute $fn$ grant execute on function public.fn_prompter_record_signup_legal(uuid, integer, integer) to service_role $fn$;
    execute $fn$ grant execute on function public.fn_prompter_consent_set(text, text, text) to authenticated $fn$;
    execute $fn$ grant execute on function public.fn_prompter_consent_my_status() to authenticated $fn$;
  end if;
end $down$;

drop table if exists public.prompter_audit_redact_dryruns;
drop table if exists public.prompter_audit_redact_nonce;
drop table if exists public.prompter_audit_redaction_allowlist;
drop function if exists public.fn_prompter_audit_allowlist_insert_guard();
drop index if exists public.idx_prompter_consent_events_tenant_code;

alter table if exists public.prompter_consent_events drop constraint if exists prompter_consent_events_text_sha256_check;
alter table if exists public.prompter_consent_events drop column if exists text_sha256;

commit;
