-- ROLLBACK for 20261019120000_prompter_shared_tables_truncate_delete_hardening.sql
-- NOT a migration. Restores the grants observed on production on 2026-10-19 (anon and authenticated each held
-- INSERT, UPDATE, DELETE, TRUNCATE on all three tables).
-- WARNING: rolling back reopens TRUNCATE (ignores RLS) on shared tables.

grant insert, update, delete, truncate on public.tenants to anon, authenticated;
grant insert, update, delete, truncate on public.ai_assistant_usage_log to anon, authenticated;
grant insert, update, delete, truncate on public.fitur_ai_usage_log to anon, authenticated;
