-- LOCAL-ONLY harness addition: tables the REAL billing functions need, then the REAL function bodies are
-- extracted verbatim from the repository migrations by run-local.sh (so the test cannot drift from them).
-- Never run against Supabase.
create table public.prompter_audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_user_id uuid, action text not null, resource_type text not null, resource_id uuid,
  before_data jsonb, after_data jsonb, context jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table public.prompter_payment_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid references public.user_profiles(id) on delete set null,
  provider text not null, provider_payment_id text, provider_event_id text,
  plan text not null check (plan in ('FREE','STARTER','PRO','BUSINESS','GROWTH','AGENCY','UMKMPRO_BUNDLE')),
  amount numeric(14,2) not null check (amount >= 0), currency text not null default 'IDR',
  status text not null default 'PENDING' check (status in ('PENDING','PAID','FAILED','EXPIRED','CANCELLED')),
  failure_reason text, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), paid_at timestamptz,
  unique (provider, provider_payment_id)
);
-- production state of the plan table beyond the snapshot's three rows (read-only catalog audit)
insert into public.prompter_plan_entitlements values
  ('PRO',500,25,10,5,'ACTIVE'),('BUSINESS',2000,null,null,15,'ACTIVE'),('GROWTH',1000,null,null,10,'ACTIVE'),('UMKMPRO_BUNDLE',500,25,10,5,'ACTIVE')
on conflict (plan) do nothing;
