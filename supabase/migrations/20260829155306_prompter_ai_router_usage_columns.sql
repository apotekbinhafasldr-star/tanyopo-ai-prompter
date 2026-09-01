-- ============================================================================
-- RECOVERY / DOCUMENTATION MIGRATION -- reconciles repository history with
-- schema that is ALREADY LIVE on the shared Supabase project (umkmpro-ai,
-- ref wjjyqovhmwenbcvbnkgx). This file was reconstructed on 2026-09-01 from the
-- project's own `supabase_migrations.schema_migrations` ledger (version
-- 20260829155306), which recorded this exact SQL as already applied on the live
-- database but never had a corresponding file committed to this repository
-- (Stage 1 production integration verification, Item 1 -- schema drift).
--
-- This file's version prefix matches the version already recorded as
-- applied in `supabase_migrations.schema_migrations` on the live project,
-- so a standard `supabase db push` against that project will recognize it
-- as already-applied and skip it -- it will NOT be re-executed there.
-- Defensive IF NOT EXISTS / DROP-IF-EXISTS-THEN-CREATE guards have been
-- added below (where Postgres syntax allows) purely so this file is also
-- safe to run once, from scratch, against a project that does NOT yet have
-- this schema (e.g. a fresh dev/staging replica) -- it must NOT be run
-- against the live umkmpro-ai project itself, since that would attempt to
-- recreate objects that already exist there under the same names.
-- ============================================================================

alter table public.prompter_ai_jobs
  add column if not exists provider text,
  add column if not exists actor_user_id uuid references public.user_profiles(id) on delete set null,
  add column if not exists fallback_provider text,
  add column if not exists error_category text check (
    error_category is null or error_category in (
      'AUTH', 'RATE_LIMIT', 'CONNECTION', 'API', 'REFUSAL', 'INVALID_OUTPUT', 'CONFIG', 'UNKNOWN'
    )
  );

comment on column public.prompter_ai_jobs.provider is
  'Which AI provider (e.g. "openai", "anthropic") actually produced this result -- set by the AI Router, never guessed by feature code.';
comment on column public.prompter_ai_jobs.actor_user_id is
  'The user who triggered this generation, when the call happened in a request context. Null for system-triggered jobs, if any exist in future.';
comment on column public.prompter_ai_jobs.fallback_provider is
  'Set only when the AI Router''s primary provider failed and a configured fallback provider served the request instead -- names the primary that failed.';
comment on column public.prompter_ai_jobs.error_category is
  'Coarse, provider-agnostic failure category for a FAILED job -- lets AI usage accounting query without parsing vendor-specific error text.';

create index if not exists idx_prompter_ai_jobs_actor on public.prompter_ai_jobs (actor_user_id) where actor_user_id is not null;
