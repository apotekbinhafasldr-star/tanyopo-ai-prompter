-- ============================================================================
-- Batch B5 — SEO & Discovery without a website. Additive only: loosens one
-- NOT NULL constraint (no data loss — every existing row already has a
-- real website_url) and adds nullable columns with safe defaults. No new
-- table, reusing prompter_seo_projects/prompter_seo_recommendations as the
-- single home for both modes, and prompter_brand_profiles for the one
-- piece of durable contact context (WhatsApp) this batch needs that had
-- no existing home.
-- ============================================================================

alter table public.prompter_seo_projects
  alter column website_url drop not null,
  add column if not exists discovery_mode text not null default 'WEBSITE'
    check (discovery_mode in ('WEBSITE', 'NO_WEBSITE')),
  add column if not exists product_id uuid references public.prompter_products(id) on delete set null;

comment on column public.prompter_seo_projects.discovery_mode is
  'Batch B5: WEBSITE keeps the existing website-SEO flow (website_url required at the app layer); NO_WEBSITE is discovery via social/marketplace instead — website_url stays null for those rows.';
comment on column public.prompter_seo_projects.product_id is
  'Batch B5: optional link back to the product this project was opened from, so context (name/description/category/target market) can be re-inherited without asking again on a later visit or regenerate.';

alter table public.prompter_seo_recommendations
  add column if not exists discovery_recommendations jsonb;

comment on column public.prompter_seo_recommendations.discovery_recommendations is
  'Batch B5: structured AI output for a NO_WEBSITE project (keywords, profile/bio tips, content ideas, hashtags, CTA, recommended discovery channels). Null for WEBSITE-mode rows, which keep using the existing on_page_recommendations/content_plan columns unchanged.';

alter table public.prompter_brand_profiles
  add column if not exists whatsapp_number text;

comment on column public.prompter_brand_profiles.whatsapp_number is
  'Batch B5: tenant contact number/link, used only as CTA/contact context in AI recommendations (e.g. "arahkan ke WhatsApp Anda"). Never used to send a message — no WhatsApp API/automation exists in this app.';
