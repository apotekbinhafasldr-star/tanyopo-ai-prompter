-- Rollback untuk 20261127100000_prompter_consent_audit_guard.sql. Idempoten. Hanya objek LINOE bernama eksplisit.
-- AMAN: menolak (RAISE) bila tabel bukti berisi baris, agar bukti persetujuan tidak hilang tanpa sengaja.
--   Untuk sengaja membuang bukti (setelah ekspor dan persetujuan Founder): jalankan dengan PGOPTIONS="-c linoe.drop_evidence=YA".
-- Memulihkan hak UPDATE/DELETE/TRUNCATE role klien pada prompter_audit_logs sesuai keadaan SEBELUM migrasi (tertangkap di prompter_audit_guard_state).
-- Tidak menyentuh prompter_audit_logs (baris), auth.users, tenants, atau tabel produk lain.
begin;

set local lock_timeout = '3s';
set local statement_timeout = '10s';

do $$
declare
  v_rows bigint := 0;
begin
  if to_regclass('public.prompter_consent_events') is not null then
    v_rows := v_rows + (select count(*) from public.prompter_consent_events);
  end if;
  if to_regclass('public.prompter_legal_document_events') is not null then
    v_rows := v_rows + (select count(*) from public.prompter_legal_document_events);
  end if;
  if v_rows > 0 and coalesce(current_setting('linoe.drop_evidence', true), '') <> 'YA' then
    raise exception 'ROLLBACK BERHENTI: tabel bukti persetujuan berisi % baris. Ekspor dahulu; untuk sengaja membuang set linoe.drop_evidence=YA', v_rows;
  end if;
end $$;

-- 1. Lepas guard audit lebih dulu, lalu pulihkan hak lama.
drop trigger if exists trg_prompter_audit_logs_guard on public.prompter_audit_logs;
drop trigger if exists trg_prompter_audit_logs_block_truncate on public.prompter_audit_logs;

do $$
declare
  r record;
begin
  if to_regclass('public.prompter_audit_guard_state') is not null and to_regclass('public.prompter_audit_logs') is not null then
    for r in select role_name, privilege_type from public.prompter_audit_guard_state s
              where s.was_granted and exists (select 1 from pg_roles x where x.rolname = s.role_name) loop
      execute format('grant %s on public.prompter_audit_logs to %I', r.privilege_type, r.role_name);
    end loop;
  end if;
end $$;

-- 2. Objek baru (fungsi dahulu, lalu tabel; trigger ikut terhapus bersama tabel).
drop function if exists public.fn_prompter_consent_evidence_purge(boolean, text, integer);
drop function if exists public.fn_prompter_consent_schedule_retention(boolean);
drop function if exists public.fn_prompter_consent_check(uuid, text);
drop function if exists public.fn_prompter_consent_my_status();
drop function if exists public.fn_prompter_consent_set(text, text, text);
drop function if exists public.fn_prompter_record_signup_legal(uuid, integer, integer);

drop table if exists public.prompter_consent_events;
drop table if exists public.prompter_legal_document_events;
drop table if exists public.prompter_consent_purge_runs;
drop table if exists public.prompter_consent_settings;
drop table if exists public.prompter_consent_catalog;
drop table if exists public.prompter_audit_guard_state;

drop function if exists public.fn_prompter_evidence_guard();
drop function if exists public.fn_prompter_audit_logs_guard();
drop function if exists public.fn_prompter_block_truncate_guard();

commit;
