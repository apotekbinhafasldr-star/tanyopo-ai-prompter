-- LOCAL-ONLY test harness: re-creates, in a THROWAWAY database, the production
-- state of the objects touched by the P0 trial-security migrations (as read
-- from the production catalog on 2026-10-10: policies, grants, triggers,
-- columns) plus the REAL fn_create_ai_job_if_entitled from the B10 migration.
-- Never run against Supabase. Roles/auth stubs mimic Supabase/PostgREST.

do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub','')::uuid $$;
create or replace function auth.role() returns text language sql stable as
  $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'role','') $$;

grant usage on schema public, auth to anon, authenticated, service_role;
-- Supabase default privileges for objects created by postgres in public.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create table public.tenants (id uuid primary key default gen_random_uuid(), nama_usaha text);
create table public.user_profiles (id uuid primary key, tenant_id uuid references public.tenants(id), nama text, role text);

create function public.fn_current_tenant_id() returns uuid language sql stable security definer set search_path=public as
  $$ select tenant_id from public.user_profiles where id = auth.uid() $$;
create function public.fn_current_role() returns text language sql stable security definer set search_path=public as
  $$ select role from public.user_profiles where id = auth.uid() $$;

create function public.prompter_set_updated_at() returns trigger language plpgsql as
  $$ begin new.updated_at := now(); return new; end $$;

create table public.prompter_plan_entitlements (
  plan text primary key,
  ai_usage_allowance integer not null,
  max_active_products integer, max_active_campaigns integer, max_users integer,
  availability text not null default 'ACTIVE'
);
insert into public.prompter_plan_entitlements values
  ('FREE',30,3,2,1,'ACTIVE'),('STARTER',150,10,5,3,'ACTIVE'),('AGENCY',1000,null,null,null,'COMING_SOON');

create table public.prompter_subscriptions (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  plan text not null default 'FREE',
  status text not null default 'ACTIVE' check (status in ('ACTIVE','TRIALING','PAST_DUE','CANCELED')),
  billing_provider text,
  success_fee_rate_bps integer,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  billing_country text,
  invoice_currency text,
  payment_provider_customer_reference text,
  tax_metadata jsonb not null default '{}'::jsonb,
  cancel_at_period_end boolean not null default false,
  provider_subscription_id text
);
create trigger trg_prompter_subscriptions_updated_at before update on public.prompter_subscriptions
  for each row execute function public.prompter_set_updated_at();
create function public.fn_guard_subscription_plan_availability() returns trigger language plpgsql security definer set search_path=public as $f$
declare v text; begin
  select availability into v from public.prompter_plan_entitlements where plan = new.plan;
  if v is null then raise exception 'plan unknown'; end if;
  if v = 'COMING_SOON' then raise exception 'coming soon'; end if;
  return new; end $f$;
create trigger trg_prompter_subscriptions_guard_plan before insert or update of plan on public.prompter_subscriptions
  for each row execute function public.fn_guard_subscription_plan_availability();

alter table public.prompter_subscriptions enable row level security;
create policy "Lihat subscription tenant sendiri" on public.prompter_subscriptions for select using (tenant_id = public.fn_current_tenant_id());
create policy "Buat subscription tenant sendiri" on public.prompter_subscriptions for insert with check (
  tenant_id = public.fn_current_tenant_id() and status='TRIALING' and plan='FREE' and billing_provider is null and payment_provider_customer_reference is null);
create policy "Owner kelola subscription" on public.prompter_subscriptions for update
  using (tenant_id = public.fn_current_tenant_id() and public.fn_current_role()='owner')
  with check (tenant_id = public.fn_current_tenant_id() and public.fn_current_role()='owner');
-- B10: authenticated may UPDATE only `plan`
revoke update on public.prompter_subscriptions from authenticated, anon;
grant update (plan) on public.prompter_subscriptions to authenticated;

create table public.prompter_ai_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  job_type text not null,
  status text not null default 'QUEUED' check (status in ('QUEUED','PROCESSING','COMPLETED','FAILED')),
  model text, input_reference jsonb default '{}'::jsonb, output_reference jsonb,
  tokens_input integer, tokens_output integer, estimated_cost numeric, error text,
  created_at timestamptz not null default now(), completed_at timestamptz,
  provider text, actor_user_id uuid, fallback_provider text, error_category text
);
alter table public.prompter_ai_jobs enable row level security;
create policy "Lihat ai job tenant sendiri" on public.prompter_ai_jobs for select using (tenant_id = public.fn_current_tenant_id());
create policy "Owner/marketing buat & ubah ai job" on public.prompter_ai_jobs for all
  using (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner','marketing'))
  with check (tenant_id = public.fn_current_tenant_id() and public.fn_current_role() in ('owner','marketing'));

create or replace function public.fn_create_ai_job_if_entitled(
  p_job_type text,
  p_input_reference jsonb default '{}'::jsonb
)
returns table(job_id uuid, allowed boolean, reason text, used_count integer, allowance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_actor_user_id uuid;
  v_sub public.prompter_subscriptions%rowtype;
  v_entitlement public.prompter_plan_entitlements%rowtype;
  v_entitlement_plan text;
  v_period_start timestamptz;
  v_used integer;
  v_new_job_id uuid;
begin
  v_tenant_id := public.fn_current_tenant_id();
  v_actor_user_id := auth.uid();

  if v_tenant_id is null then
    return query select null::uuid, false, 'NO_TENANT'::text, 0, 0;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('prompter_ai_usage:' || v_tenant_id::text));

  select * into v_sub from public.prompter_subscriptions where tenant_id = v_tenant_id for update;

  if not found then
    return query select null::uuid, false, 'NO_SUBSCRIPTION'::text, 0, 0;
    return;
  end if;

  if v_sub.status = 'TRIALING' and v_sub.current_period_end is not null and now() > v_sub.current_period_end then
    return query select null::uuid, false, 'TRIAL_EXPIRED'::text, 0, 0;
    return;
  end if;

  -- Batch B10 Gap 2: a subscription that has fallen behind on payment or
  -- been cancelled never gets paid-plan entitlement, regardless of what
  -- `plan` still says.
  if v_sub.status in ('PAST_DUE', 'CANCELED') then
    return query select null::uuid, false, 'SUBSCRIPTION_' || v_sub.status, 0, 0;
    return;
  end if;

  -- Batch B10 Gap 1: the trial is always the trial -- a `plan` value set
  -- via changePlan() (governance preference only, no payment) never
  -- grants paid-tier numbers while status is still TRIALING.
  v_entitlement_plan := case when v_sub.status = 'TRIALING' then 'FREE' else coalesce(v_sub.plan, 'FREE') end;

  select * into v_entitlement from public.prompter_plan_entitlements where plan = v_entitlement_plan;
  if not found then
    select * into v_entitlement from public.prompter_plan_entitlements where plan = 'FREE';
  end if;

  if v_sub.status = 'TRIALING' then
    v_period_start := coalesce(v_sub.current_period_start, v_sub.created_at);
  else
    v_period_start := date_trunc('month', now());
  end if;

  select count(*) into v_used
  from public.prompter_ai_jobs
  where tenant_id = v_tenant_id and created_at >= v_period_start;

  if v_used >= v_entitlement.ai_usage_allowance then
    return query select null::uuid, false, 'AI_USAGE_LIMIT_REACHED'::text, v_used, v_entitlement.ai_usage_allowance;
    return;
  end if;

  insert into public.prompter_ai_jobs (tenant_id, actor_user_id, job_type, status, input_reference)
  values (v_tenant_id, v_actor_user_id, p_job_type, 'PROCESSING', p_input_reference)
  returning id into v_new_job_id;

  return query select v_new_job_id, true, null::text, v_used + 1, v_entitlement.ai_usage_allowance;
end;
$$;
revoke all on function public.fn_create_ai_job_if_entitled(text, jsonb) from public, anon;
grant execute on function public.fn_create_ai_job_if_entitled(text, jsonb) to authenticated;
