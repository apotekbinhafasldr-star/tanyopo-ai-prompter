-- Paket 3 "Consent & Audit Guard" (LINOE). BELUM DITERAPKAN ke database mana pun: penerapan butuh persetujuan Founder terpisah.
--
-- Isi (semua objek bernama eksplisit, awalan prompter_ / fn_prompter_):
--   1. Katalog persetujuan (prompter_consent_catalog) + peristiwa persetujuan (prompter_consent_events): bukti persetujuan PDP OPSIONAL yang
--      spesifik, tercatat, dapat ditarik. Terms/Privacy BUKAN persetujuan PDP: dicatat di tabel terpisah (prompter_legal_document_events).
--   2. Retensi bukti: kolom retain_until NULLABLE, parameter prompter_consent_settings.evidence_retention_months = NULL (usulan internal
--      belum disahkan; TIDAK ada angka tahun di sini). Fungsi jadwal dan purge hanya untuk operator (pemilik database), dry-run dahulu.
--   3. Guard UPDATE/DELETE/TRUNCATE pada prompter_audit_logs dan tabel bukti: REVOKE hak role klien + trigger. BUKAN klaim "immutable":
--      pemilik tabel/superuser tetap dapat menonaktifkan trigger atau mengubah hak. Penghapusan tenant (ON DELETE CASCADE) tetap berjalan.
--   4. prompter_audit_guard_state: menyimpan hak lama role klien pada prompter_audit_logs agar rollback memulihkan persis.
--
-- TIDAK menyentuh: auth.users, tenants, user_profiles, handle_new_user, fn_create_ai_job_if_entitled, tabel PUBLOE/MITAPENG/UMKMpro/Apotek,
-- budget_policies, automation_settings (Emergency Stop). Tanpa FK ke auth.users atau tenants (bukti tidak ikut terhapus bersama tenant).
-- prompter_audit_logs hanya DIBACA oleh guard (tenants dibaca untuk mengenali cascade) dan diberi trigger + pencabutan hak; baris tidak diubah.
-- Transaksi eksplisit: atomik walau dijalankan tanpa `psql -1`; lock_timeout 3 detik, statement_timeout 10 detik (jalankan di jam sepi).
-- Idempoten: aman dijalankan ulang. Rollback: supabase/rollback/20261127100000_prompter_consent_audit_guard.down.sql.
begin;

set local lock_timeout = '3s';
set local statement_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 0. Sisa rollback lama: fungsi yatim fn_prompter_block_truncate_clients() (QA P2). Dibuang HANYA bila tidak ada trigger yang memakainya.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'fn_prompter_block_truncate_clients' and p.pronargs = 0) then
    if exists (select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'fn_prompter_block_truncate_clients' and not t.tgisinternal) then
      raise notice 'Paket 3: fn_prompter_block_truncate_clients() masih dipakai trigger, TIDAK dibuang';
    else
      drop function public.fn_prompter_block_truncate_clients();
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Tabel
-- ---------------------------------------------------------------------------
create table if not exists public.prompter_consent_catalog (
  code text not null check (code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  version integer not null check (version between 1 and 10000),
  text_id text not null check (length(text_id) between 20 and 1000),
  purpose_id text not null check (length(purpose_id) between 3 and 200),
  withdrawable boolean not null default true,
  server_gated boolean not null default true,
  active boolean not null default false,
  text_sha256 text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (code, version)
);

create table if not exists public.prompter_consent_events (
  id uuid primary key default gen_random_uuid(),
  subject_user_id uuid not null,
  tenant_id uuid,
  code text not null,
  version integer not null,
  action text not null check (action in ('GRANTED', 'WITHDRAWN')),
  source text not null check (source in ('REGISTER', 'SETTINGS', 'CONNECT_FLOW', 'REACCEPT_BANNER', 'NOTICE_BANNER', 'OPERATOR')),
  occurred_at timestamptz not null default now(),
  retain_until timestamptz,
  legal_hold boolean not null default false,
  constraint prompter_consent_events_catalog_fkey foreign key (code, version) references public.prompter_consent_catalog (code, version)
);
create index if not exists idx_prompter_consent_events_subject_code
  on public.prompter_consent_events (subject_user_id, code, occurred_at desc);
create index if not exists idx_prompter_consent_events_retain
  on public.prompter_consent_events (retain_until) where retain_until is not null;

create table if not exists public.prompter_legal_document_events (
  id uuid primary key default gen_random_uuid(),
  subject_user_id uuid not null,
  tenant_id uuid,
  doc_code text not null check (doc_code in ('TERMS', 'PRIVACY_NOTICE')),
  version integer not null check (version between 1 and 10000),
  event text not null check (event in ('ACCEPTED', 'DELIVERED')),
  source text not null check (source in ('REGISTER', 'SETTINGS', 'CONNECT_FLOW', 'REACCEPT_BANNER', 'NOTICE_BANNER', 'OPERATOR')),
  occurred_at timestamptz not null default now(),
  retain_until timestamptz,
  legal_hold boolean not null default false,
  -- Terms = penerimaan perjanjian (ACCEPTED); Privacy Notice = pemberitahuan disampaikan (DELIVERED). Bukan persetujuan PDP.
  constraint prompter_legal_document_events_pair_chk check ((doc_code = 'TERMS' and event = 'ACCEPTED') or (doc_code = 'PRIVACY_NOTICE' and event = 'DELIVERED')),
  constraint prompter_legal_document_events_once_key unique (subject_user_id, doc_code, version, event)
);

create table if not exists public.prompter_consent_settings (
  key text primary key check (key in ('evidence_retention_months')),
  value text check (value is null or value ~ '^[0-9]{1,3}$'),
  updated_at timestamptz not null default now()
);

create table if not exists public.prompter_consent_purge_runs (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  dry_run boolean not null,
  approval_ref text,
  candidates integer not null default 0,
  deleted integer not null default 0,
  status text not null check (status in ('NOT_APPROVED', 'DRY_RUN', 'EXECUTED', 'REFUSED'))
);

create table if not exists public.prompter_audit_guard_state (
  role_name text not null,
  privilege_type text not null check (privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE')),
  was_granted boolean not null,
  captured_at timestamptz not null default now(),
  primary key (role_name, privilege_type)
);

comment on table public.prompter_consent_events is
  'LINOE: bukti persetujuan PDP opsional (append-only via guard; BUKAN immutable: pemilik tabel tetap dapat mengubah trigger). Tanpa PII selain uuid.';
comment on table public.prompter_legal_document_events is
  'LINOE: penerimaan Terms (ACCEPTED) dan penyampaian Privacy Notice (DELIVERED). Bukan persetujuan PDP.';

-- Parameter retensi: NULL = belum disahkan. Sengaja tanpa angka.
insert into public.prompter_consent_settings (key, value) values ('evidence_retention_months', null) on conflict (key) do nothing;

-- Hak lama role klien pada prompter_audit_logs (hanya yang pertama kali tertangkap; ulang tidak menimpa keadaan asli).
insert into public.prompter_audit_guard_state (role_name, privilege_type, was_granted)
select r.role_name, p.privilege_type,
       case when exists (select 1 from pg_roles x where x.rolname = r.role_name)
            then has_table_privilege(r.role_name, 'public.prompter_audit_logs', p.privilege_type) else false end
from (values ('anon'), ('authenticated'), ('service_role')) as r(role_name)
cross join (values ('UPDATE'), ('DELETE'), ('TRUNCATE')) as p(privilege_type)
on conflict (role_name, privilege_type) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Katalog v1 (teks final; hash dihitung dari teks yang sama). Teks versi terbit TIDAK diedit: perubahan = versi baru.
--    active=false: terdaftar tetapi belum ditawarkan (fitur belum ada atau koneksi dinonaktifkan).
-- ---------------------------------------------------------------------------
insert into public.prompter_consent_catalog (code, version, text_id, purpose_id, withdrawable, server_gated, active, text_sha256)
select v.code, v.version, v.text_id, v.purpose_id, true, true, v.active, encode(sha256(convert_to(v.text_id, 'UTF8')), 'hex')
from (values
  ('CONNECT_META', 1, 'Saya setuju LINOE mengakses akun iklan dan halaman Meta yang saya hubungkan, serta data kinerja iklan yang saya izinkan di Meta, untuk menyiapkan dan menganalisis kampanye saya. Saya dapat memutus koneksi kapan saja.', 'Koneksi Meta', true),
  ('CONNECT_TIKTOK', 1, 'Saya setuju LINOE mengakses akun TikTok yang saya hubungkan dan data yang saya izinkan di TikTok untuk menyiapkan dan menganalisis kampanye saya. Saya dapat memutus koneksi kapan saja.', 'Koneksi TikTok', true),
  ('CONNECT_X', 1, 'Saya setuju LINOE mengakses akun X yang saya hubungkan dan data yang saya izinkan di X untuk menyiapkan dan menganalisis kampanye saya. Saya dapat memutus koneksi kapan saja.', 'Koneksi X', false),
  ('MARKETING_COMMS', 1, 'Saya setuju menerima email dari LINOE tentang fitur baru, tips, dan penawaran. Pesan layanan seperti verifikasi dan pemberitahuan akun tetap dikirim. Saya dapat berhenti kapan saja.', 'Email promosi', false),
  ('ANALYTICS_TELEMETRY', 1, 'Saya setuju LINOE mencatat data pemakaian fitur yang terbatas dan berpengenal samaran untuk meningkatkan layanan. Isi prompt dan hasil AI tidak termasuk.', 'Telemetri pemakaian', false)
) as v(code, version, text_id, purpose_id, active)
on conflict (code, version) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Fungsi guard (trigger)
-- ---------------------------------------------------------------------------
-- 3a. Tabel bukti/katalog/purge_runs: UPDATE dan DELETE ditolak, kecuali dua jalur operator sempit (diset hanya oleh fungsi operator di bawah,
--     dan hanya bila yang berjalan BUKAN role klien). Pemilik tabel/superuser tetap dapat menonaktifkan trigger: ini BUKAN klaim immutable.
create or replace function public.fn_prompter_evidence_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_client boolean := current_user in ('anon', 'authenticated', 'service_role', 'authenticator');
begin
  if tg_op = 'UPDATE'
     and tg_table_name = 'prompter_consent_events'
     and not v_client
     and coalesce(current_setting('linoe.consent_retention', true), '') = 'on'
     and old.retain_until is null
     and (to_jsonb(new) - 'retain_until') = (to_jsonb(old) - 'retain_until') then
    return new;
  end if;
  if tg_op = 'DELETE'
     and tg_table_name in ('prompter_consent_events', 'prompter_legal_document_events')
     and not v_client
     and coalesce(current_setting('linoe.consent_purge', true), '') = 'on'
     and old.legal_hold = false
     and old.retain_until is not null
     and old.retain_until < now() then
    return old;
  end if;
  raise exception 'tabel % tidak menerima % lewat jalur ini (guard LINOE)', tg_table_name, tg_op using errcode = '42501';
end;
$$;

-- 3b. prompter_audit_logs: UPDATE ditolak; DELETE ditolak KECUALI cascade dari penghapusan tenant (baris tenant induk sudah tidak ada).
--     SECURITY DEFINER hanya agar dapat MEMBACA public.tenants (tidak pernah mengubahnya).
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

create or replace function public.fn_prompter_block_truncate_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'TRUNCATE ditolak pada % (guard LINOE)', tg_table_name using errcode = '42501';
end;
$$;

revoke all on function public.fn_prompter_evidence_guard() from public, anon, authenticated, service_role;
revoke all on function public.fn_prompter_audit_logs_guard() from public, anon, authenticated, service_role;
revoke all on function public.fn_prompter_block_truncate_guard() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Pasang trigger (idempoten)
-- ---------------------------------------------------------------------------
drop trigger if exists trg_prompter_audit_logs_guard on public.prompter_audit_logs;
create trigger trg_prompter_audit_logs_guard
  before update or delete on public.prompter_audit_logs
  for each row execute function public.fn_prompter_audit_logs_guard();
drop trigger if exists trg_prompter_audit_logs_block_truncate on public.prompter_audit_logs;
create trigger trg_prompter_audit_logs_block_truncate
  before truncate on public.prompter_audit_logs
  for each statement execute function public.fn_prompter_block_truncate_guard();

drop trigger if exists trg_prompter_consent_catalog_guard on public.prompter_consent_catalog;
create trigger trg_prompter_consent_catalog_guard
  before update or delete on public.prompter_consent_catalog
  for each row execute function public.fn_prompter_evidence_guard();
drop trigger if exists trg_prompter_consent_catalog_block_truncate on public.prompter_consent_catalog;
create trigger trg_prompter_consent_catalog_block_truncate
  before truncate on public.prompter_consent_catalog
  for each statement execute function public.fn_prompter_block_truncate_guard();

drop trigger if exists trg_prompter_consent_events_guard on public.prompter_consent_events;
create trigger trg_prompter_consent_events_guard
  before update or delete on public.prompter_consent_events
  for each row execute function public.fn_prompter_evidence_guard();
drop trigger if exists trg_prompter_consent_events_block_truncate on public.prompter_consent_events;
create trigger trg_prompter_consent_events_block_truncate
  before truncate on public.prompter_consent_events
  for each statement execute function public.fn_prompter_block_truncate_guard();

drop trigger if exists trg_prompter_legal_document_events_guard on public.prompter_legal_document_events;
create trigger trg_prompter_legal_document_events_guard
  before update or delete on public.prompter_legal_document_events
  for each row execute function public.fn_prompter_evidence_guard();
drop trigger if exists trg_prompter_legal_document_events_block_truncate on public.prompter_legal_document_events;
create trigger trg_prompter_legal_document_events_block_truncate
  before truncate on public.prompter_legal_document_events
  for each statement execute function public.fn_prompter_block_truncate_guard();

drop trigger if exists trg_prompter_consent_purge_runs_guard on public.prompter_consent_purge_runs;
create trigger trg_prompter_consent_purge_runs_guard
  before update or delete on public.prompter_consent_purge_runs
  for each row execute function public.fn_prompter_evidence_guard();
drop trigger if exists trg_prompter_consent_purge_runs_block_truncate on public.prompter_consent_purge_runs;
create trigger trg_prompter_consent_purge_runs_block_truncate
  before truncate on public.prompter_consent_purge_runs
  for each statement execute function public.fn_prompter_block_truncate_guard();

-- ---------------------------------------------------------------------------
-- 5. Hak akses dan RLS
-- ---------------------------------------------------------------------------
-- prompter_audit_logs: cabut HANYA UPDATE/DELETE/TRUNCATE dari role klien. INSERT/SELECT dan RLS yang ada tidak diubah.
revoke update, delete, truncate on public.prompter_audit_logs from public, anon, authenticated, service_role;

alter table public.prompter_consent_catalog enable row level security;
alter table public.prompter_consent_events enable row level security;
alter table public.prompter_legal_document_events enable row level security;
alter table public.prompter_consent_settings enable row level security;
alter table public.prompter_consent_purge_runs enable row level security;
alter table public.prompter_audit_guard_state enable row level security;

revoke all on public.prompter_consent_catalog, public.prompter_consent_events, public.prompter_legal_document_events,
  public.prompter_consent_settings, public.prompter_consent_purge_runs, public.prompter_audit_guard_state
  from public, anon, authenticated, service_role;
grant select on public.prompter_consent_catalog, public.prompter_consent_events, public.prompter_legal_document_events to authenticated;
grant select on public.prompter_consent_catalog, public.prompter_consent_events, public.prompter_legal_document_events to service_role;

drop policy if exists "Lihat katalog persetujuan" on public.prompter_consent_catalog;
create policy "Lihat katalog persetujuan" on public.prompter_consent_catalog
  for select to authenticated using (true);
drop policy if exists "Lihat persetujuan milik sendiri" on public.prompter_consent_events;
create policy "Lihat persetujuan milik sendiri" on public.prompter_consent_events
  for select to authenticated using (subject_user_id = auth.uid());
drop policy if exists "Lihat catatan dokumen hukum milik sendiri" on public.prompter_legal_document_events;
create policy "Lihat catatan dokumen hukum milik sendiri" on public.prompter_legal_document_events
  for select to authenticated using (subject_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 6. Fungsi aplikasi
-- ---------------------------------------------------------------------------
-- 6a. Pendaftaran: catat Terms (ACCEPTED) dan Privacy Notice (DELIVERED) sebagai DUA baris terpisah, idempoten. Hanya service_role (server).
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

-- 6b. Beri/tarik persetujuan opsional oleh pengguna masuk. Versi diambil dari katalog (BUKAN dari klien).
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
  if p_action not in ('GRANTED', 'WITHDRAWN') or p_source not in ('SETTINGS', 'CONNECT_FLOW') or p_code is null then
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

-- 6c. Status milik pengguna masuk: satu baris per kode AKTIF (hormati RLS pemanggil: SECURITY INVOKER).
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

-- 6d. Pemeriksaan server (tanpa mengetahui flag enforcement; flag dibaca aplikasi). Hanya service_role.
create or replace function public.fn_prompter_consent_check(p_user_id uuid, p_code text)
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
  if p_user_id is null or p_code is null then
    return jsonb_build_object('consented', false, 'reason', 'INVALID_ARGUMENT');
  end if;
  select * into v_cat from public.prompter_consent_catalog c where c.code = p_code order by c.version desc limit 1;
  if not found then
    return jsonb_build_object('consented', false, 'reason', 'UNKNOWN_CODE');
  end if;
  if not v_cat.active then
    return jsonb_build_object('consented', false, 'reason', 'INACTIVE_CODE');
  end if;
  select * into v_last from public.prompter_consent_events e
   where e.subject_user_id = p_user_id and e.code = p_code
   order by e.occurred_at desc, e.id desc limit 1;
  if not found then
    return jsonb_build_object('consented', false, 'reason', 'NO_RECORD');
  end if;
  if v_last.action <> 'GRANTED' then
    return jsonb_build_object('consented', false, 'reason', 'WITHDRAWN');
  end if;
  if v_last.version <> v_cat.version then
    return jsonb_build_object('consented', false, 'reason', 'VERSION_OUTDATED');
  end if;
  return jsonb_build_object('consented', true, 'reason', 'GRANTED');
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Fungsi OPERATOR (retensi). EXECUTE tidak diberikan ke role mana pun: dijalankan oleh pemilik database/operator.
-- ---------------------------------------------------------------------------
-- 7a. Mengisi retain_until HANYA bila parameter retensi disahkan (bukan NULL). Dry-run default. Tanpa PII pada keluaran.
create or replace function public.fn_prompter_consent_schedule_retention(p_dry_run boolean default true)
returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_value text;
  v_months integer;
  v_count integer := 0;
begin
  select s.value into v_value from public.prompter_consent_settings s where s.key = 'evidence_retention_months';
  if v_value is null then
    return jsonb_build_object('status', 'NOT_APPROVED', 'dry_run', coalesce(p_dry_run, true), 'candidates', 0, 'updated', 0);
  end if;
  v_months := v_value::integer;
  -- kandidat: peristiwa persetujuan milik (subjek, kode) yang peristiwa terakhirnya WITHDRAWN dan belum berpenjadwalan
  select count(*) into v_count from public.prompter_consent_events e
   where e.retain_until is null and not e.legal_hold
     and (select l.action from public.prompter_consent_events l where l.subject_user_id = e.subject_user_id and l.code = e.code
           order by l.occurred_at desc, l.id desc limit 1) = 'WITHDRAWN';
  if coalesce(p_dry_run, true) then
    raise notice 'consent_schedule dry_run=true candidates=%', v_count;
    return jsonb_build_object('status', 'DRY_RUN', 'dry_run', true, 'candidates', v_count, 'updated', 0);
  end if;
  perform set_config('linoe.consent_retention', 'on', true);
  update public.prompter_consent_events e
     set retain_until = (select l.occurred_at from public.prompter_consent_events l where l.subject_user_id = e.subject_user_id and l.code = e.code
                          order by l.occurred_at desc, l.id desc limit 1) + make_interval(months => v_months)
   where e.retain_until is null and not e.legal_hold
     and (select l.action from public.prompter_consent_events l where l.subject_user_id = e.subject_user_id and l.code = e.code
           order by l.occurred_at desc, l.id desc limit 1) = 'WITHDRAWN';
  perform set_config('linoe.consent_retention', 'off', true);
  raise notice 'consent_schedule dry_run=false updated=%', v_count;
  return jsonb_build_object('status', 'EXECUTED', 'dry_run', false, 'candidates', v_count, 'updated', v_count);
end;
$$;

-- 7b. Purge terkendali. Dry-run default; eksekusi nyata butuh p_approval_ref, dry-run terbaru (<= 1 jam) dengan hitungan SAMA, batas p_batch.
--     Hanya baris dengan retain_until terlewat dan legal_hold = false. Keluaran dan log: hitungan saja (tanpa user id/tenant id/isi baris).
create or replace function public.fn_prompter_consent_evidence_purge(p_dry_run boolean default true, p_approval_ref text default null, p_batch integer default 500)
returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_value text;
  v_cand integer;
  v_cand_events integer;
  v_cand_docs integer;
  v_prev integer;
  v_deleted integer := 0;
  v_part integer;
  v_detail jsonb;
  v_batch integer := least(greatest(coalesce(p_batch, 500), 1), 5000);
  v_dry boolean := coalesce(p_dry_run, true);
begin
  select s.value into v_value from public.prompter_consent_settings s where s.key = 'evidence_retention_months';
  if v_value is null then
    insert into public.prompter_consent_purge_runs (dry_run, approval_ref, candidates, deleted, status) values (v_dry, null, 0, 0, 'NOT_APPROVED');
    raise notice 'consent_purge status=NOT_APPROVED candidates=0';
    return jsonb_build_object('status', 'NOT_APPROVED', 'dry_run', v_dry, 'candidates', 0, 'deleted', 0);
  end if;

  select count(*) into v_cand_events from public.prompter_consent_events e where e.retain_until < now() and not e.legal_hold;
  select count(*) into v_cand_docs from public.prompter_legal_document_events e where e.retain_until < now() and not e.legal_hold;
  v_cand := v_cand_events + v_cand_docs;

  -- Ringkasan kasar per kode dan rentang usia lewat-jatuh-tempo. TANPA identitas.
  select coalesce(jsonb_agg(jsonb_build_object('kind', k, 'code', c, 'age_band', b, 'count', n) order by k, c, b), '[]'::jsonb) into v_detail
  from (
    select 'consent'::text as k, e.code as c,
           case when now() - e.retain_until <= interval '30 days' then '0-30d' when now() - e.retain_until <= interval '365 days' then '31-365d' else '>365d' end as b,
           count(*)::int as n
      from public.prompter_consent_events e where e.retain_until < now() and not e.legal_hold group by 1, 2, 3
    union all
    select 'document', e.doc_code,
           case when now() - e.retain_until <= interval '30 days' then '0-30d' when now() - e.retain_until <= interval '365 days' then '31-365d' else '>365d' end,
           count(*)::int
      from public.prompter_legal_document_events e where e.retain_until < now() and not e.legal_hold group by 1, 2, 3
  ) q;

  if v_dry then
    insert into public.prompter_consent_purge_runs (dry_run, approval_ref, candidates, deleted, status) values (true, null, v_cand, 0, 'DRY_RUN');
    raise notice 'consent_purge dry_run=true candidates=%', v_cand;
    return jsonb_build_object('status', 'DRY_RUN', 'dry_run', true, 'candidates', v_cand, 'deleted', 0, 'detail', v_detail);
  end if;

  if p_approval_ref is null or p_approval_ref !~ '^[A-Za-z0-9][A-Za-z0-9 ._:/#-]{2,119}$' then
    insert into public.prompter_consent_purge_runs (dry_run, approval_ref, candidates, deleted, status) values (false, null, v_cand, 0, 'REFUSED');
    raise notice 'consent_purge status=REFUSED reason=approval_ref candidates=%', v_cand;
    return jsonb_build_object('status', 'REFUSED', 'reason', 'APPROVAL_REF_REQUIRED', 'dry_run', false, 'candidates', v_cand, 'deleted', 0);
  end if;

  select r.candidates into v_prev from public.prompter_consent_purge_runs r
   where r.dry_run and r.status = 'DRY_RUN' and r.ran_at > now() - interval '1 hour'
   order by r.ran_at desc limit 1;
  if v_prev is null or v_prev <> v_cand then
    insert into public.prompter_consent_purge_runs (dry_run, approval_ref, candidates, deleted, status) values (false, p_approval_ref, v_cand, 0, 'REFUSED');
    raise notice 'consent_purge status=REFUSED reason=dry_run_mismatch candidates=%', v_cand;
    return jsonb_build_object('status', 'REFUSED', 'reason', 'FRESH_DRY_RUN_REQUIRED', 'dry_run', false, 'candidates', v_cand, 'deleted', 0);
  end if;

  perform set_config('linoe.consent_purge', 'on', true);
  with d as (
    delete from public.prompter_consent_events
     where id in (select e.id from public.prompter_consent_events e where e.retain_until < now() and not e.legal_hold order by e.retain_until limit v_batch)
    returning 1)
  select count(*) into v_part from d;
  v_deleted := v_part;
  if v_deleted < v_batch then
    with d as (
      delete from public.prompter_legal_document_events
       where id in (select e.id from public.prompter_legal_document_events e where e.retain_until < now() and not e.legal_hold order by e.retain_until limit (v_batch - v_deleted))
      returning 1)
    select count(*) into v_part from d;
    v_deleted := v_deleted + v_part;
  end if;
  perform set_config('linoe.consent_purge', 'off', true);

  insert into public.prompter_consent_purge_runs (dry_run, approval_ref, candidates, deleted, status) values (false, p_approval_ref, v_cand, v_deleted, 'EXECUTED');
  raise notice 'consent_purge dry_run=false candidates=% deleted=%', v_cand, v_deleted;
  return jsonb_build_object('status', 'EXECUTED', 'dry_run', false, 'candidates', v_cand, 'deleted', v_deleted);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. EXECUTE
-- ---------------------------------------------------------------------------
revoke all on function public.fn_prompter_record_signup_legal(uuid, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.fn_prompter_consent_set(text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.fn_prompter_consent_my_status() from public, anon, authenticated, service_role;
revoke all on function public.fn_prompter_consent_check(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.fn_prompter_consent_schedule_retention(boolean) from public, anon, authenticated, service_role;
revoke all on function public.fn_prompter_consent_evidence_purge(boolean, text, integer) from public, anon, authenticated, service_role;

grant execute on function public.fn_prompter_record_signup_legal(uuid, integer, integer) to service_role;
grant execute on function public.fn_prompter_consent_set(text, text, text) to authenticated;
grant execute on function public.fn_prompter_consent_my_status() to authenticated;
grant execute on function public.fn_prompter_consent_check(uuid, text) to service_role;
-- fn_prompter_consent_schedule_retention dan fn_prompter_consent_evidence_purge: SENGAJA tanpa GRANT (operator = pemilik database).

commit;
