-- Tanyopo AI Promoter — Global Edition: Marketing Blueprint localization fields.
--
-- Additive only. All nullable/empty-default -- every existing blueprint
-- row (if any) keeps working with these simply unset, and reading an
-- old blueprint back never breaks because a new field is missing.
--
-- home_market/target_markets/target_languages/target_currency are
-- metadata computed server-side from real tenant/product data
-- (prompter_brand_profiles.country_code, prompter_products.target_countries/
-- currency) at generation time -- never asked of or invented by the AI.
-- localization_strategy is the one genuinely AI-reasoned addition
-- (product spec §9-10): how to adapt positioning/content for the
-- target market(s), not a factual claim.
alter table public.prompter_marketing_blueprints
  add column if not exists home_market text,
  add column if not exists target_markets jsonb not null default '[]'::jsonb,
  add column if not exists target_languages jsonb not null default '[]'::jsonb,
  add column if not exists target_currency text,
  add column if not exists localization_strategy text;

comment on column public.prompter_marketing_blueprints.localization_strategy is
  'AI-generated reasoning on adapting this blueprint for its target market(s) -- never a legal/compliance claim, never fabricated local statistics, never a promised result.';
