-- ============================================================================
-- Batch B3 (correction) — Smart Scheduling Recommendation, extended to the
-- Golden Path's own Review Campaign step. Adds a per-channel schedule to
-- prompter_channel_campaigns (channel_campaigns), the row B2 already uses
-- for per-channel selection/budget — no parallel table, and no change to
-- prompter_master_campaigns.start_date (a plain `date` column used
-- elsewhere) so every existing campaign renders exactly as before. Purely
-- additive: nullable column, no backfill, no data migration.
-- ============================================================================

alter table public.prompter_channel_campaigns add column if not exists scheduled_at timestamptz;

comment on column public.prompter_channel_campaigns.scheduled_at is
  'Batch B3: real UTC instant this channel is scheduled to publish/launch at, chosen from LINOE''s Smart Scheduling recommendation or set manually by the owner. Null until scheduled. Independent per channel — Instagram and Facebook under the same campaign can carry different times.';
