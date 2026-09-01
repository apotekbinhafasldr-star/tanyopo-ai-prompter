-- Tanyopo AI Promoter — fixes the compliance flags uniqueness approach.
-- A partial unique index (WHERE market_country_code IS NULL) can't be
-- targeted by PostgREST's upsert onConflict (which emits a plain
-- ON CONFLICT (cols) with no WHERE clause, so Postgres can't infer the
-- partial index as the arbiter). Switches to the same non-NULL empty-
-- string sentinel already used by prompter_platform_capabilities.country_code
-- ('' = "applies globally") so a plain full unique constraint works.
-- Additive/non-destructive -- table has 0 rows.
drop index if exists idx_prompter_compliance_flags_global_unique;

alter table public.prompter_compliance_flags
  alter column market_country_code set default '',
  alter column market_country_code set not null;

update public.prompter_compliance_flags set market_country_code = '' where market_country_code is null;

alter table public.prompter_compliance_flags
  add constraint prompter_compliance_flags_unique unique (tenant_id, market_country_code, flag_type);

comment on column public.prompter_compliance_flags.market_country_code is
  'ISO 3166-1 alpha-2, or '''' (empty string) meaning "applies to every market this tenant targets". Never NULL -- kept non-NULL so a plain unique constraint (not a partial index) backs upsert.';
