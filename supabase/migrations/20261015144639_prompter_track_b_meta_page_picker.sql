-- Track B — Meta Page Picker.
--
-- Additive only: two new nullable columns on the existing
-- prompter_connected_accounts table, no new table, no RLS change, no
-- backfill needed. Existing rows get NULL for both (== "no Page selected
-- yet"), which is exactly today's behavior — lib/connectors/meta-connector.ts
-- #createCreative() already throws a clear, existing error when no pageId
-- is supplied, so a tenant that never selects a Page sees the same
-- behavior as before this migration.
--
-- Why these live on prompter_connected_accounts rather than a new table:
-- a selected Facebook Page is 1:1 with a tenant's Meta connection (one ad
-- account connection, one Page used for ad creatives), exactly like
-- external_account_id/external_account_name already do for the ad
-- account itself. No new RLS policy is needed either — the existing
-- "Owner kelola koneksi platform" policy on this table is a for-all-columns
-- USING/WITH CHECK on (tenant_id, role), so it already covers these two
-- new columns for both read and write.
alter table public.prompter_connected_accounts
  add column if not exists selected_page_id text,
  add column if not exists selected_page_name text;

comment on column public.prompter_connected_accounts.selected_page_id is
  'Track B — the Facebook Page id (from Meta''s /me/accounts) an Owner has selected to run ad creatives as. NULL means no Page selected yet. Never trust a client-supplied value for this column directly: features/connections/actions.ts#selectMetaPageAction() only ever persists an id that was just re-verified against a live /me/accounts call using the tenant''s own token.';

comment on column public.prompter_connected_accounts.selected_page_name is
  'Track B — display-only cache of the selected Page''s name at selection time, so the Connections UI does not need a live Graph API call just to render it. Never used for authorization — only selected_page_id is passed to the Graph API.';
