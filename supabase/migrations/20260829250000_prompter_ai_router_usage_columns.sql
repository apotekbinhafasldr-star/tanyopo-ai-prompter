-- Tanyopo AI Promoter — AI Router usage-accounting columns.
-- Additive only: extends the existing prompter_ai_jobs table (Phase 1) so
-- the multi-provider AI Router (lib/ai/router.ts) can record which
-- provider actually served a request, who triggered it, whether a
-- fallback provider had to be used, and a coarse failure category —
-- without ever fabricating a value the provider/router didn't actually
-- produce. No UMKMpro AI table is touched.

alter table public.prompter_ai_jobs
  add column provider text,
  add column actor_user_id uuid references public.user_profiles(id) on delete set null,
  add column fallback_provider text,
  add column error_category text check (
    error_category is null or error_category in (
      'AUTH', 'RATE_LIMIT', 'CONNECTION', 'API', 'REFUSAL', 'INVALID_OUTPUT', 'CONFIG', 'UNKNOWN'
    )
  );

comment on column public.prompter_ai_jobs.provider is
  'Which AI provider (e.g. "openai", "anthropic") actually produced this result — set by the AI Router, never guessed by feature code.';
comment on column public.prompter_ai_jobs.actor_user_id is
  'The user who triggered this generation, when the call happened in a request context. Null for system-triggered jobs, if any exist in future.';
comment on column public.prompter_ai_jobs.fallback_provider is
  'Set only when the AI Router''s primary provider failed and a configured fallback provider served the request instead — names the primary that failed.';
comment on column public.prompter_ai_jobs.error_category is
  'Coarse, provider-agnostic failure category for a FAILED job — lets AI usage accounting query without parsing vendor-specific error text.';

create index idx_prompter_ai_jobs_actor on public.prompter_ai_jobs (actor_user_id) where actor_user_id is not null;
