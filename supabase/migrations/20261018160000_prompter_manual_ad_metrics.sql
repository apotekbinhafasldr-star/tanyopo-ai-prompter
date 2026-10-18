-- LINOE Winning Ads Intelligence -- Phase 2B: manual ad metrics.
-- Founder-approved design (Option B): a NEW, isolated table for ad metrics a
-- user types in by hand for ads they run themselves, so the Ad Performance
-- Verdict (Phase 2A) can be computed without waiting for the Meta Ads API.
--
-- PREPARED FOR REVIEW ONLY. NOT APPLIED TO PRODUCTION BY THIS CHANGE.
-- Applying it to the shared Supabase project needs separate Founder approval
-- (never `supabase db push` on that project -- see README / docs/DATABASE.md).
-- The application fails closed (feature shows "belum aktif") while the table
-- does not exist.
--
-- ADDITIVE ONLY: one new table, two new functions, one new trigger. It does
-- not alter public.prompter_marketing_metrics (the connector-written table that
-- Budget Guard, Optimization and Analytics read), public.prompter_channel_campaigns,
-- or any other existing object. Nothing reads this table except the Phase 2B
-- verdict section -- in particular NOT Budget Guard (manual spend must never
-- count toward, or lower, an enforcement limit) and NOT the H1/H2 launch path.
--
-- Tenant integrity (the point of this migration's design): the references
-- master_campaign_id / channel_campaign_id are validated against the
-- tenant-owned channel campaign in TWO independent layers that both apply when
-- a client writes straight through the database API (PostgREST), bypassing any
-- server action:
--   1. RLS WITH CHECK (insert/update) requires the channel campaign to exist
--      with the same tenant_id, the same master campaign and channel, and no
--      external_campaign_id.
--   2. A BEFORE INSERT/UPDATE trigger (SECURITY DEFINER, pinned search_path)
--      re-checks the same facts without depending on the caller's RLS view,
--      rejects a future date, and freezes identity columns on update.
-- The older prompter_marketing_metrics policy does NOT do this; that finding is
-- documented in docs/DATABASE.md and is remediated separately, not in this PR.

create table if not exists public.prompter_manual_ad_metrics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  master_campaign_id uuid not null references public.prompter_master_campaigns(id) on delete cascade,
  channel_campaign_id uuid not null references public.prompter_channel_campaigns(id) on delete cascade,
  channel text not null,
  metric_date date not null,
  spend numeric(14, 2) not null,
  impressions bigint not null,
  clicks bigint not null,
  conversions bigint not null,
  revenue numeric(14, 2) not null,
  currency text not null,
  entered_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prompter_manual_ad_metrics_unique unique (channel_campaign_id, metric_date),
  constraint prompter_manual_ad_metrics_channel check (channel in ('FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'X')),
  constraint prompter_manual_ad_metrics_currency check (currency ~ '^[A-Z]{3}$'),
  constraint prompter_manual_ad_metrics_date_floor check (metric_date >= date '2020-01-01'),
  constraint prompter_manual_ad_metrics_spend_range check (spend >= 0 and spend <= 100000000000),
  constraint prompter_manual_ad_metrics_revenue_range check (revenue >= 0 and revenue <= 100000000000),
  constraint prompter_manual_ad_metrics_impressions_range check (impressions >= 0 and impressions <= 10000000000),
  constraint prompter_manual_ad_metrics_clicks_le_impressions check (clicks >= 0 and clicks <= impressions),
  constraint prompter_manual_ad_metrics_conversions_le_clicks check (conversions >= 0 and conversions <= clicks),
  constraint prompter_manual_ad_metrics_revenue_needs_conversions check (revenue = 0 or conversions > 0)
);

comment on table public.prompter_manual_ad_metrics is
  'LINOE Winning Ads Phase 2B: daily ad metrics typed in manually by owner/marketing for ads run outside LINOE. UNVERIFIED by any ad platform. Isolated from prompter_marketing_metrics (connector data): never read by Budget Guard, Optimization or the launch path.';

create index if not exists idx_prompter_manual_ad_metrics_tenant
  on public.prompter_manual_ad_metrics (tenant_id, metric_date desc);
create index if not exists idx_prompter_manual_ad_metrics_master
  on public.prompter_manual_ad_metrics (master_campaign_id);

-- Tenant / ownership / state guard. SECURITY DEFINER so the check does not
-- depend on what the caller's RLS lets them see; the tenant comparison is
-- explicit. Not callable as a function by clients (revoked below); it only
-- runs as a trigger.
create or replace function public.fn_prompter_manual_ad_metrics_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cc record;
  v_actor uuid;
begin
  select tenant_id, master_campaign_id, channel, external_campaign_id
    into v_cc
    from public.prompter_channel_campaigns
   where id = new.channel_campaign_id;

  if not found then
    raise exception 'manual_ad_metrics: channel campaign not found' using errcode = '23503';
  end if;
  if v_cc.tenant_id is distinct from new.tenant_id then
    raise exception 'manual_ad_metrics: channel campaign belongs to another tenant' using errcode = '42501';
  end if;
  if v_cc.master_campaign_id is distinct from new.master_campaign_id then
    raise exception 'manual_ad_metrics: master campaign does not match the channel campaign' using errcode = '23514';
  end if;
  if v_cc.channel is distinct from new.channel then
    raise exception 'manual_ad_metrics: channel does not match the channel campaign' using errcode = '23514';
  end if;
  if v_cc.external_campaign_id is not null then
    raise exception 'manual_ad_metrics: channel campaign already has an external campaign id (platform data is the source of truth)' using errcode = '23514';
  end if;
  if new.metric_date > (current_date + 1) then
    raise exception 'manual_ad_metrics: metric_date is in the future' using errcode = '23514';
  end if;

  v_actor := auth.uid();

  if tg_op = 'INSERT' then
    if v_actor is not null then
      new.entered_by := v_actor;
    end if;
    new.updated_by := new.entered_by;
  else
    if new.tenant_id is distinct from old.tenant_id
       or new.master_campaign_id is distinct from old.master_campaign_id
       or new.channel_campaign_id is distinct from old.channel_campaign_id
       or new.channel is distinct from old.channel
       or new.metric_date is distinct from old.metric_date
       or new.currency is distinct from old.currency then
      raise exception 'manual_ad_metrics: identity columns are immutable (delete and re-add instead)' using errcode = '23514';
    end if;
    new.entered_by := old.entered_by;
    new.created_at := old.created_at;
    new.updated_by := coalesce(v_actor, new.updated_by);
    new.updated_at := now();
  end if;

  return new;
end;
$$;

revoke all on function public.fn_prompter_manual_ad_metrics_guard() from public, anon, authenticated;

drop trigger if exists trg_prompter_manual_ad_metrics_guard on public.prompter_manual_ad_metrics;
create trigger trg_prompter_manual_ad_metrics_guard
  before insert or update on public.prompter_manual_ad_metrics
  for each row execute function public.fn_prompter_manual_ad_metrics_guard();

alter table public.prompter_manual_ad_metrics enable row level security;

revoke all on public.prompter_manual_ad_metrics from anon;
grant select, insert, update, delete on public.prompter_manual_ad_metrics to authenticated;

drop policy if exists "Lihat metrik iklan manual tenant sendiri" on public.prompter_manual_ad_metrics;
create policy "Lihat metrik iklan manual tenant sendiri"
  on public.prompter_manual_ad_metrics for select
  using (tenant_id = public.fn_current_tenant_id());

drop policy if exists "Owner/marketing tambah metrik iklan manual" on public.prompter_manual_ad_metrics;
create policy "Owner/marketing tambah metrik iklan manual"
  on public.prompter_manual_ad_metrics for insert
  with check (
    tenant_id = public.fn_current_tenant_id()
    and public.fn_current_role() in ('owner', 'marketing')
    and exists (
      select 1
        from public.prompter_channel_campaigns cc
       where cc.id = prompter_manual_ad_metrics.channel_campaign_id
         and cc.tenant_id = prompter_manual_ad_metrics.tenant_id
         and cc.master_campaign_id = prompter_manual_ad_metrics.master_campaign_id
         and cc.channel = prompter_manual_ad_metrics.channel
         and cc.external_campaign_id is null
    )
  );

drop policy if exists "Owner/marketing ubah metrik iklan manual" on public.prompter_manual_ad_metrics;
create policy "Owner/marketing ubah metrik iklan manual"
  on public.prompter_manual_ad_metrics for update
  using (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'))
  with check (
    tenant_id = public.fn_current_tenant_id()
    and public.fn_current_role() in ('owner', 'marketing')
    and exists (
      select 1
        from public.prompter_channel_campaigns cc
       where cc.id = prompter_manual_ad_metrics.channel_campaign_id
         and cc.tenant_id = prompter_manual_ad_metrics.tenant_id
         and cc.master_campaign_id = prompter_manual_ad_metrics.master_campaign_id
         and cc.channel = prompter_manual_ad_metrics.channel
         and cc.external_campaign_id is null
    )
  );

drop policy if exists "Owner/marketing hapus metrik iklan manual" on public.prompter_manual_ad_metrics;
create policy "Owner/marketing hapus metrik iklan manual"
  on public.prompter_manual_ad_metrics for delete
  using (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner', 'marketing'));
