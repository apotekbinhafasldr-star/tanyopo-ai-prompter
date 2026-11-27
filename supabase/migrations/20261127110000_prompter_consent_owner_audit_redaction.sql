-- Paket 3 (revisi Jalur 1) "Consent Owner + anonimisasi audit" (LINOE). BELUM DITERAPKAN ke database mana pun: butuh persetujuan Founder terpisah.
-- MIGRASI TAMBAHAN (additive) di atas 20261127100000; migrasi itu TIDAK diedit agar hash paket di PR #186 tetap.
--
-- Isi:
--   1. Persetujuan koneksi (CONNECT_*) hanya oleh OWNER tenant (keputusan Founder Opsi A), divalidasi di RPC langsung, bukan hanya di server:
--      fn_prompter_consent_set (4 argumen; p_tenant_id opsional harus = tenant pemanggil), status per tenant, fn_prompter_consent_check_tenant.
--      Persetujuan Owner TIDAK otomatis mewakili semua subjek data dan BUKAN dasar hukum untuk semua pemrosesan.
--   2. Pendaftaran: Privacy Notice DELIVERED hanya dicatat bila versinya dikirim (p_privacy_version NULL = tidak dicatat); Terms tetap ACCEPTED.
--   3. Kolom text_sha256 pada prompter_consent_events (hash teks versi yang disetujui).
--   4. Jalur SEMPIT khusus operator untuk anonimisasi PII di prompter_audit_logs (tanpa GRANT, allowlist, dry-run wajib, penanda, hitungan saja)
--      + pemindaian canary baca-saja. Guard tetap menolak jalur lain. TIDAK menyentuh tabel finansial/ledger/keamanan, Emergency Stop,
--      budget_policies, automation_settings, auth.users, tenants, atau tabel produk lain; trigger produk lain tidak diubah.
-- Transaksi eksplisit; lock_timeout 3 detik, statement_timeout 10 detik. Idempoten. Rollback: supabase/rollback/20261127110000_prompter_consent_owner_audit_redaction.down.sql.
begin;

set local lock_timeout = '3s';
set local statement_timeout = '10s';

-- 1. Hash teks pada peristiwa persetujuan (kolom tambahan; baris lama NULL).
alter table public.prompter_consent_events add column if not exists text_sha256 text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'prompter_consent_events_text_sha256_check') then
    alter table public.prompter_consent_events
      add constraint prompter_consent_events_text_sha256_check check (text_sha256 is null or text_sha256 ~ '^[0-9a-f]{64}$');
  end if;
end $$;

-- 2. Pendaftaran: Privacy Notice dicatat HANYA bila versi dikirim.
create or replace function public.fn_prompter_record_signup_legal(p_user_id uuid, p_terms_version integer, p_privacy_version integer)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_terms integer;
  v_privacy integer := 0;
begin
  if p_user_id is null or p_terms_version is null or p_terms_version not between 1 and 10000
     or (p_privacy_version is not null and p_privacy_version not between 1 and 10000) then
    raise exception 'argumen tidak valid' using errcode = '22023';
  end if;
  insert into public.prompter_legal_document_events (subject_user_id, tenant_id, doc_code, version, event, source)
  values (p_user_id, null, 'TERMS', p_terms_version, 'ACCEPTED', 'REGISTER')
  on conflict (subject_user_id, doc_code, version, event) do nothing;
  get diagnostics v_terms = row_count;
  if p_privacy_version is not null then
    insert into public.prompter_legal_document_events (subject_user_id, tenant_id, doc_code, version, event, source)
    values (p_user_id, null, 'PRIVACY_NOTICE', p_privacy_version, 'DELIVERED', 'REGISTER')
    on conflict (subject_user_id, doc_code, version, event) do nothing;
    get diagnostics v_privacy = row_count;
  end if;
  return jsonb_build_object('terms_recorded', v_terms = 1, 'privacy_notice_recorded', v_privacy = 1);
end;
$$;

-- 3. Beri/tarik persetujuan. Kode CONNECT_*: hanya OWNER tenant; status per tenant. Kode lain: per pengguna seperti sebelumnya.
--    Tenant dan peran diambil dari user_profiles milik auth.uid() (BUKAN dari klien). p_tenant_id opsional: bila diisi harus = tenant pemanggil.
drop function if exists public.fn_prompter_consent_set(text, text, text);
create or replace function public.fn_prompter_consent_set(p_code text, p_action text, p_source text, p_tenant_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_cat public.prompter_consent_catalog;
  v_last public.prompter_consent_events;
  v_tenant uuid;
  v_role text;
  v_connect boolean;
  v_row public.prompter_consent_events;
  v_ver integer;
begin
  if v_uid is null then
    raise exception 'tidak terautentikasi' using errcode = '28000';
  end if;
  if p_code is null or p_action is null or p_source is null or p_action not in ('GRANTED', 'WITHDRAWN') or p_source not in ('SETTINGS', 'CONNECT_FLOW') then
    raise exception 'argumen tidak valid' using errcode = '22023';
  end if;

  select * into v_cat from public.prompter_consent_catalog c
   where c.code = p_code and (p_action = 'WITHDRAWN' or c.active)
   order by c.version desc limit 1;
  if not found then
    raise exception 'kode persetujuan tidak dikenal atau tidak aktif' using errcode = '22023';
  end if;
  if p_action = 'WITHDRAWN' and not v_cat.withdrawable then
    raise exception 'persetujuan ini tidak dapat ditarik lewat jalur ini' using errcode = '22023';
  end if;

  select up.tenant_id, up.role::text into v_tenant, v_role from public.user_profiles up where up.id = v_uid;
  v_connect := left(p_code, 8) = 'CONNECT_';
  if p_tenant_id is not null and p_tenant_id is distinct from v_tenant then
    raise exception 'tenant tidak sesuai dengan akun pemanggil' using errcode = '42501';
  end if;
  if v_connect then
    if v_tenant is null then
      raise exception 'akun tidak terhubung ke tenant' using errcode = '42501';
    end if;
    if v_role is distinct from 'owner' then
      raise exception 'hanya Owner tenant yang dapat memberi atau menarik persetujuan koneksi' using errcode = '42501';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('linoe.consent:' || case when v_connect then 't:' || v_tenant::text else 'u:' || v_uid::text end || ':' || p_code, 0));

  if v_connect then
    select * into v_last from public.prompter_consent_events e
     where e.tenant_id = v_tenant and e.code = p_code
     order by e.occurred_at desc, e.id desc limit 1;
  else
    select * into v_last from public.prompter_consent_events e
     where e.subject_user_id = v_uid and e.code = p_code
     order by e.occurred_at desc, e.id desc limit 1;
  end if;

  if found and v_last.action = p_action and (p_action = 'WITHDRAWN' or v_last.version = v_cat.version) then
    return jsonb_build_object('code', p_code, 'version', v_last.version, 'status', v_last.action, 'changed', false, 'occurred_at', v_last.occurred_at);
  end if;
  if not found and p_action = 'WITHDRAWN' then
    return jsonb_build_object('code', p_code, 'version', v_cat.version, 'status', 'NO_RECORD', 'changed', false, 'occurred_at', null);
  end if;

  v_ver := case when p_action = 'WITHDRAWN' and found then v_last.version else v_cat.version end;
  insert into public.prompter_consent_events (subject_user_id, tenant_id, code, version, action, source, text_sha256)
  values (v_uid, v_tenant, p_code, v_ver, p_action, p_source,
          (select c.text_sha256 from public.prompter_consent_catalog c where c.code = p_code and c.version = v_ver))
  returning * into v_row;
  return jsonb_build_object('code', p_code, 'version', v_row.version, 'status', v_row.action, 'changed', true, 'occurred_at', v_row.occurred_at);
end;
$$;

-- 4. Status untuk layar pengaturan: CONNECT_* = status TENANT pemanggil; lain = status pengguna. SECURITY DEFINER agar Owner kedua melihat
--    persetujuan tenant (RLS peristiwa hanya per pengguna); hanya membaca baris tenant/pengguna pemanggil.
create or replace function public.fn_prompter_consent_my_status()
returns table (code text, version integer, purpose_id text, text_id text, status text, occurred_at timestamptz)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with me as (select up.tenant_id from public.user_profiles up where up.id = auth.uid())
  select c.code, c.version, c.purpose_id, c.text_id,
         case when e.id is null then 'NOT_GIVEN'
              when e.action = 'GRANTED' and e.version = c.version then 'GRANTED'
              when e.action = 'GRANTED' then 'OUTDATED'
              else 'WITHDRAWN' end,
         e.occurred_at
  from public.prompter_consent_catalog c
  left join lateral (
    select x.* from public.prompter_consent_events x
     where x.code = c.code
       and ((left(c.code, 8) = 'CONNECT_' and x.tenant_id is not null and x.tenant_id = (select m.tenant_id from me m))
         or (left(c.code, 8) <> 'CONNECT_' and x.subject_user_id = auth.uid()))
     order by x.occurred_at desc, x.id desc limit 1
  ) e on auth.uid() is not null
  where c.active and c.version = (select max(m.version) from public.prompter_consent_catalog m where m.code = c.code and m.active)
  order by c.code;
$$;

-- 5. Pemeriksaan server per TENANT (hanya service_role). Pengguna harus anggota tenant; persetujuan = peristiwa terakhir tenant untuk kode itu,
--    dan pemberinya HARUS masih Owner tenant tersebut. Persetujuan Owner tenant lain tidak berlaku.
create or replace function public.fn_prompter_consent_check_tenant(p_user_id uuid, p_code text, p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_cat public.prompter_consent_catalog;
  v_last public.prompter_consent_events;
begin
  if p_user_id is null or p_code is null or p_tenant_id is null then
    return jsonb_build_object('consented', false, 'reason', 'INVALID_ARGUMENT');
  end if;
  if left(p_code, 8) <> 'CONNECT_' then
    return jsonb_build_object('consented', false, 'reason', 'NOT_TENANT_CODE');
  end if;
  select * into v_cat from public.prompter_consent_catalog c where c.code = p_code and c.active order by c.version desc limit 1;
  if not found then
    if exists (select 1 from public.prompter_consent_catalog c where c.code = p_code) then
      return jsonb_build_object('consented', false, 'reason', 'INACTIVE_CODE');
    end if;
    return jsonb_build_object('consented', false, 'reason', 'UNKNOWN_CODE');
  end if;
  if not exists (select 1 from public.user_profiles up where up.id = p_user_id and up.tenant_id = p_tenant_id) then
    return jsonb_build_object('consented', false, 'reason', 'NOT_IN_TENANT');
  end if;
  select * into v_last from public.prompter_consent_events e
   where e.tenant_id = p_tenant_id and e.code = p_code
   order by e.occurred_at desc, e.id desc limit 1;
  if not found then
    return jsonb_build_object('consented', false, 'reason', 'NO_RECORD');
  end if;
  if v_last.action <> 'GRANTED' then
    return jsonb_build_object('consented', false, 'reason', 'WITHDRAWN');
  end if;
  if not exists (select 1 from public.user_profiles up where up.id = v_last.subject_user_id and up.tenant_id = p_tenant_id and up.role::text = 'owner') then
    return jsonb_build_object('consented', false, 'reason', 'GRANTOR_NOT_OWNER');
  end if;
  if v_last.version <> v_cat.version then
    return jsonb_build_object('consented', false, 'reason', 'VERSION_OUTDATED');
  end if;
  return jsonb_build_object('consented', true, 'reason', 'GRANTED');
end;
$$;

-- 6. Anonimisasi PII audit: tabel allowlist + nonce (privat, tanpa hak klien).
create table if not exists public.prompter_audit_redaction_allowlist (
  resource_type text not null check (resource_type ~ '^[a-z][a-z0-9_]{2,63}$'
    and resource_type !~* '(finance|ledger|payment|billing|security|budget|automation|emergency|auth|tenant|profile)'),
  json_key text not null check (json_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  note text,
  primary key (resource_type, json_key)
);
-- Seed awal (dikonfirmasi dari trigger manual_ad_metrics): hanya kolom pengenal pengguna yang tersalin lewat before_data/after_data.
insert into public.prompter_audit_redaction_allowlist (resource_type, json_key, note) values
  ('prompter_manual_ad_metrics', 'entered_by', 'id pengguna penginput tersalin dari baris sumber lewat to_jsonb'),
  ('prompter_manual_ad_metrics', 'updated_by', 'id pengguna pengubah tersalin dari baris sumber lewat to_jsonb')
on conflict (resource_type, json_key) do nothing;

create table if not exists public.prompter_audit_redact_nonce (
  txid bigint primary key,
  nonce uuid not null,
  created_at timestamptz not null default now()
);
alter table public.prompter_audit_redaction_allowlist enable row level security;
alter table public.prompter_audit_redact_nonce enable row level security;
revoke all on public.prompter_audit_redaction_allowlist, public.prompter_audit_redact_nonce from public, anon, authenticated, service_role;

drop trigger if exists trg_prompter_audit_redaction_allowlist_guard on public.prompter_audit_redaction_allowlist;
create trigger trg_prompter_audit_redaction_allowlist_guard
  before update or delete on public.prompter_audit_redaction_allowlist
  for each row execute function public.fn_prompter_evidence_guard();
drop trigger if exists trg_prompter_audit_redaction_allowlist_block_truncate on public.prompter_audit_redaction_allowlist;
create trigger trg_prompter_audit_redaction_allowlist_block_truncate
  before truncate on public.prompter_audit_redaction_allowlist
  for each statement execute function public.fn_prompter_block_truncate_guard();

-- 7. Guard audit: tambah SATU jalur UPDATE sempit (nonce acak per transaksi yang hanya dibuat fungsi operator; hanya kolom data berubah).
--    Klien tidak bisa menebak nonce (tabel privat) dan tidak punya hak UPDATE. DELETE hanya cascade tenant seperti sebelumnya.
create or replace function public.fn_prompter_audit_logs_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_nonce text := coalesce(current_setting('linoe.audit_redact', true), '');
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.tenants t where t.id = old.tenant_id) then
    return old;
  end if;
  if tg_op = 'UPDATE'
     and v_nonce <> ''
     and exists (select 1 from public.prompter_audit_redact_nonce n where n.txid = txid_current() and n.nonce::text = v_nonce)
     and (to_jsonb(new) - 'before_data' - 'after_data' - 'context') = (to_jsonb(old) - 'before_data' - 'after_data' - 'context')
     and new.context is not null then
    return new;
  end if;
  raise exception 'prompter_audit_logs tidak menerima % lewat jalur ini (guard LINOE)', tg_op using errcode = '42501';
end;
$$;

-- Helper murni (hanya dipanggil fungsi operator).
create or replace function public.fn_prompter_audit_row_needs_redaction(p_type text, p_before jsonb, p_after jsonb, p_ctx jsonb)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
      from public.prompter_audit_redaction_allowlist a, unnest(array[p_before, p_after, p_ctx]) as d
     where a.resource_type = p_type
       and d is not null and jsonb_typeof(d) = 'object'
       and jsonb_exists(d, a.json_key)
       and (d -> a.json_key) is distinct from to_jsonb('[DIHAPUS-PII]'::text)
  );
$$;

create or replace function public.fn_prompter_audit_redact_doc(p_doc jsonb, p_type text)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select case
    when p_doc is null or jsonb_typeof(p_doc) <> 'object' then p_doc
    else coalesce((select jsonb_object_agg(e.k, case when exists (select 1 from public.prompter_audit_redaction_allowlist a
                                                                   where a.resource_type = p_type and a.json_key = e.k)
                                                     then to_jsonb('[DIHAPUS-PII]'::text) else e.v end)
                     from jsonb_each(p_doc) as e(k, v)), '{}'::jsonb)
  end;
$$;

-- 8. FUNGSI OPERATOR: anonimisasi PII audit satu tenant. TIDAK ada GRANT. dry_run=true default; eksekusi wajib didahului dry-run
--    dengan request_ref yang sama (<= 7 hari). Hanya kolom before_data/after_data/context pada baris resource_type ber-allowlist;
--    id/tenant/action/waktu tidak berubah. Menulis entri audit sendiri (hitungan saja, tanpa PII). Idempoten. Per batch.
create or replace function public.fn_prompter_audit_redact(p_request_ref text, p_tenant_id uuid, p_dry_run boolean default true, p_batch integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set lock_timeout = '3s'
set statement_timeout = '30s'
as $$
declare
  c_deny constant text := '(finance|ledger|payment|billing|security|budget|automation|emergency|auth|tenant|profile)';
  v_matched bigint;
  v_redacted bigint := 0;
  v_remaining bigint;
  v_nonce uuid;
begin
  if session_user in ('anon', 'authenticated', 'service_role', 'authenticator') then
    raise exception 'fungsi ini khusus operator' using errcode = '42501';
  end if;
  if p_request_ref is null or p_request_ref !~ '^[A-Za-z0-9._:-]{6,64}$' then
    raise exception 'request_ref wajib (6-64 karakter: huruf, angka, . _ : -)' using errcode = '22023';
  end if;
  if p_tenant_id is null or not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    raise exception 'tenant wajib dan harus ada' using errcode = '22023';
  end if;
  if p_dry_run is null or p_batch is null or p_batch not between 1 and 5000 then
    raise exception 'argumen tidak valid' using errcode = '22023';
  end if;

  select count(*) into v_matched from public.prompter_audit_logs r
   where r.tenant_id = p_tenant_id and r.resource_type !~* c_deny
     and public.fn_prompter_audit_row_needs_redaction(r.resource_type, r.before_data, r.after_data, r.context);

  if p_dry_run then
    insert into public.prompter_audit_logs (tenant_id, actor_user_id, action, resource_type, after_data, context)
    values (p_tenant_id, null, 'AUDIT_PII_REDACTION_DRYRUN', 'prompter_audit_logs',
            jsonb_build_object('rows_matched', v_matched),
            jsonb_build_object('request_ref', p_request_ref, 'dry_run', true, 'recorded_by', 'operator_function'));
    return jsonb_build_object('dry_run', true, 'rows_matched', v_matched, 'rows_redacted', 0, 'remaining', v_matched);
  end if;

  if not exists (select 1 from public.prompter_audit_logs d
                  where d.tenant_id = p_tenant_id and d.action = 'AUDIT_PII_REDACTION_DRYRUN'
                    and d.context ->> 'request_ref' = p_request_ref and d.created_at > now() - interval '7 days') then
    raise exception 'dry-run dengan request_ref ini wajib dijalankan lebih dulu (<= 7 hari)' using errcode = '22023';
  end if;

  delete from public.prompter_audit_redact_nonce where created_at < now() - interval '1 day';
  insert into public.prompter_audit_redact_nonce (txid, nonce) values (txid_current(), gen_random_uuid())
  on conflict (txid) do update set nonce = excluded.nonce
  returning nonce into v_nonce;
  perform set_config('linoe.audit_redact', v_nonce::text, true);

  with picked as (
    select r.id from public.prompter_audit_logs r
     where r.tenant_id = p_tenant_id and r.resource_type !~* c_deny
       and public.fn_prompter_audit_row_needs_redaction(r.resource_type, r.before_data, r.after_data, r.context)
     order by r.created_at, r.id
     limit p_batch
     for update skip locked
  ), done as (
    update public.prompter_audit_logs r
       set before_data = public.fn_prompter_audit_redact_doc(r.before_data, r.resource_type),
           after_data = public.fn_prompter_audit_redact_doc(r.after_data, r.resource_type),
           context = public.fn_prompter_audit_redact_doc(r.context, r.resource_type)
      from picked
     where r.id = picked.id
    returning 1
  )
  select count(*) into v_redacted from done;

  perform set_config('linoe.audit_redact', '', true);
  delete from public.prompter_audit_redact_nonce where txid = txid_current();

  select count(*) into v_remaining from public.prompter_audit_logs r
   where r.tenant_id = p_tenant_id and r.resource_type !~* c_deny
     and public.fn_prompter_audit_row_needs_redaction(r.resource_type, r.before_data, r.after_data, r.context);

  insert into public.prompter_audit_logs (tenant_id, actor_user_id, action, resource_type, after_data, context)
  values (p_tenant_id, null, 'AUDIT_PII_REDACTION', 'prompter_audit_logs',
          jsonb_build_object('rows_matched', v_matched, 'rows_redacted', v_redacted, 'remaining', v_remaining),
          jsonb_build_object('request_ref', p_request_ref, 'dry_run', false, 'recorded_by', 'operator_function'));
  return jsonb_build_object('dry_run', false, 'rows_matched', v_matched, 'rows_redacted', v_redacted, 'remaining', v_remaining);
end;
$$;

-- 9. Pemindaian canary BACA-SAJA (operator): PII yang masih ada pada kolom allowlist, dan kandidat kunci mirip PII yang BELUM di allowlist.
--    Prasyarat Paket 4b-2: jalankan sebelum/sesudah anonimisasi dan tinjau kandidat. Mengembalikan hitungan, bukan isi.
create or replace function public.fn_prompter_audit_pii_canary_scan(p_tenant_id uuid default null)
returns table (kind text, resource_type text, json_key text, location text, row_count bigint)
language sql
stable
security definer
set search_path = pg_catalog, public
set statement_timeout = '30s'
as $$
  with docs as (
    select r.resource_type as rt, v.loc, v.d
      from public.prompter_audit_logs r,
           lateral (values ('before_data', r.before_data), ('after_data', r.after_data), ('context', r.context)) as v(loc, d)
     where (p_tenant_id is null or r.tenant_id = p_tenant_id)
       and v.d is not null and jsonb_typeof(v.d) = 'object'
  ), keys as (
    select docs.rt, docs.loc, e.k, e.v from docs, lateral jsonb_each(docs.d) as e(k, v)
  )
  select 'ALLOWLISTED_UNREDACTED'::text, k.rt, k.k, k.loc, count(*)
    from keys k
    join public.prompter_audit_redaction_allowlist a on a.resource_type = k.rt and a.json_key = k.k
   where k.v is distinct from to_jsonb('[DIHAPUS-PII]'::text)
   group by k.rt, k.k, k.loc
  union all
  select 'UNLISTED_CANDIDATE'::text, k.rt, k.k, k.loc, count(*)
    from keys k
   where k.k ~* '(email|phone|telp|hp_|nama|name|alamat|address|nik|ktp|ip_addr|user_id|_by$)'
     and not exists (select 1 from public.prompter_audit_redaction_allowlist a where a.resource_type = k.rt and a.json_key = k.k)
   group by k.rt, k.k, k.loc
  order by 1, 2, 3, 4;
$$;

-- 10. Hak: fungsi operator TANPA GRANT; fungsi aplikasi sesuai peran.
revoke all on function public.fn_prompter_consent_set(text, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.fn_prompter_consent_my_status() from public, anon, authenticated, service_role;
revoke all on function public.fn_prompter_consent_check_tenant(uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.fn_prompter_record_signup_legal(uuid, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.fn_prompter_audit_logs_guard() from public, anon, authenticated, service_role;
revoke all on function public.fn_prompter_audit_row_needs_redaction(text, jsonb, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.fn_prompter_audit_redact_doc(jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.fn_prompter_audit_redact(text, uuid, boolean, integer) from public, anon, authenticated, service_role;
revoke all on function public.fn_prompter_audit_pii_canary_scan(uuid) from public, anon, authenticated, service_role;

grant execute on function public.fn_prompter_consent_set(text, text, text, uuid) to authenticated;
grant execute on function public.fn_prompter_consent_my_status() to authenticated;
grant execute on function public.fn_prompter_consent_check_tenant(uuid, text, uuid) to service_role;
grant execute on function public.fn_prompter_record_signup_legal(uuid, integer, integer) to service_role;

commit;
