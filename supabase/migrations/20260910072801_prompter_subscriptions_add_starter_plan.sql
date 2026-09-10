-- Batch B8 — LINOE Pricing v1.0 introduces "Starter" as a real plan tier
-- between Free Trial and Growth. Additive only: widens the existing plan
-- check constraint, no RLS change, no data migration, no existing row
-- touched (every current row keeps whatever plan it already has).
alter table public.prompter_subscriptions drop constraint if exists prompter_subscriptions_plan_check;

alter table public.prompter_subscriptions add constraint prompter_subscriptions_plan_check
  check (plan in ('FREE', 'STARTER', 'PRO', 'BUSINESS', 'GROWTH', 'AGENCY', 'UMKMPRO_BUNDLE'));
