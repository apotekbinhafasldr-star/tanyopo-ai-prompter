-- Tanyopo AI Promoter — unique index needed for upsert on the global
-- (market_country_code is null) compliance flag case, which is the only
-- one the app writes to in this pass (features/settings/actions.ts#updateComplianceFlagAction).
-- Additive, non-destructive -- no existing row can violate this (the
-- table was created empty in the same migration pass and has 0 rows).
--
-- Superseded by 20260901142236_prompter_compliance_flags_market_sentinel.sql
-- (a partial index can't be targeted by PostgREST's upsert onConflict,
-- which doesn't emit a matching WHERE clause) -- kept here, dropped
-- there, to match the live ledger's real applied history exactly.
create unique index if not exists idx_prompter_compliance_flags_global_unique
  on public.prompter_compliance_flags (tenant_id, flag_type)
  where market_country_code is null;
