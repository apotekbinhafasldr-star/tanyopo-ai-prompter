-- ============================================================================
-- Batch B4 — Media Workflow. Lets a campaign remember which of its
-- product's already-uploaded media (prompter_product_media, Phase 1) is
-- the one selected for promotion, instead of building a parallel
-- campaign-media table. Nullable and additive:
-- - Existing campaigns default to null, which the app reads as "use the
--   product's first media" (or "no media yet" if the product has none) —
--   no backfill needed, no behavior change for any row until an owner
--   explicitly picks a different one.
-- - `on delete set null` so deleting a product media row (already-existing
--   deleteProductMediaAction) never leaves a dangling reference.
-- ============================================================================

alter table public.prompter_master_campaigns
  add column if not exists selected_media_id uuid references public.prompter_product_media(id) on delete set null;

comment on column public.prompter_master_campaigns.selected_media_id is
  'Batch B4: which prompter_product_media row this campaign uses as its promotional creative. Null = inherit the product''s first media (or none, if the product has no media yet) — media stays optional throughout Quick Promote.';
