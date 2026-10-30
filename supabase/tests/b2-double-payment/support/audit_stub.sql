-- LOCAL-ONLY: audit table stub the REAL fn_apply_verified_payment writes to.
create table public.prompter_audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_user_id uuid, action text not null, resource_type text not null, resource_id uuid,
  before_data jsonb, after_data jsonb, context jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
insert into public.prompter_plan_entitlements values
  ('PRO',1500,25,10,5,'ACTIVE'),('BUSINESS',4000,null,null,15,'ACTIVE'),('GROWTH',500,null,null,10,'ACTIVE'),('UMKMPRO_BUNDLE',500,25,10,5,'ACTIVE')
on conflict (plan) do nothing;
