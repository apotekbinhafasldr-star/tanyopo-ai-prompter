-- Tanyopo AI Promoter — Phase 4 schema (UMKMpro Integration)
--
-- Additive only, same rules as Phase 0-3. No UMKMpro table is touched.
--
-- Every write from the /api/v1/integrations/umkmpro/* routes happens
-- through the service-role client (there is no logged-in Supabase user in
-- a server-to-server request signed with UMKMPRO_SERVICE_TOKEN) — see
-- lib/umkmpro/auth.ts and docs/SECURITY.md. RLS policies below cover the
-- read path (a tenant member viewing their own sync history) and, where
-- noted, a narrow write path for the app's own authenticated users.

-- ============================================================================
-- prompter_products: allow safe upsert-by-source
-- Multiple NULL source_product_id values (every 'promoter'-sourced product)
-- remain mutually non-conflicting — Postgres treats NULLs as distinct in a
-- unique constraint — so this only actually constrains 'umkmpro'-sourced
-- rows, which is exactly what product sync needs.
-- ============================================================================
alter table public.prompter_products
  add constraint prompter_products_source_unique unique (tenant_id, source_system, source_product_id);

-- ============================================================================
-- prompter_conversions: idempotency for externally-pushed events
-- Same NULL-distinctness trick — Phase 2's manual entries (external_event_id
-- IS NULL) never collide with each other or with umkmpro-sourced rows.
-- ============================================================================
alter table public.prompter_conversions add column external_event_id text;

alter table public.prompter_conversions
  add constraint prompter_conversions_external_event_unique unique (tenant_id, source, external_event_id);

-- ============================================================================
-- prompter_product_snapshots
-- Append-only history (product spec §48) — every sync from UMKMpro inserts
-- a NEW row rather than mutating one, so a campaign built from a snapshot
-- stays historically accurate even after the source product's price
-- changes. `linked_product_id` points at the live, mutable
-- prompter_products mirror that the rest of the app (Promote Wizard,
-- Marketing Blueprint, ...) actually queries.
-- ============================================================================
create table public.prompter_product_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_system text not null default 'umkmpro',
  source_product_id text not null,
  linked_product_id uuid references public.prompter_products(id) on delete set null,
  name text not null,
  description text,
  price numeric(14, 2),
  currency text not null default 'IDR',
  stock integer,
  hpp numeric(14, 2),
  category text,
  images jsonb not null default '[]'::jsonb,
  snapshot_at timestamptz not null default now(),
  source_updated_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.prompter_product_snapshots is
  'Tanyopo AI Promoter: append-only historical product snapshots from UMKMpro AI (product spec §48). Never mutated, only inserted.';

create index idx_prompter_product_snapshots_tenant on public.prompter_product_snapshots (tenant_id, snapshot_at desc);
create index idx_prompter_product_snapshots_source on public.prompter_product_snapshots (tenant_id, source_system, source_product_id);

alter table public.prompter_product_snapshots enable row level security;

create policy "Lihat snapshot produk tenant sendiri"
  on public.prompter_product_snapshots for select
  using (tenant_id = public.fn_current_tenant_id());

-- No INSERT/UPDATE/DELETE policy for anon/authenticated — every snapshot is
-- written by the service-role client from a signed UMKMpro request.

-- ============================================================================
-- prompter_promotion_handoffs
-- The "secure promotion handoff" from product spec §47: UMKMpro asks
-- Promoter to create one of these, then redirects its user to
-- /promote?handoff=<id>. Promoter's own tenant-scoped RLS is what
-- "validates organization/user" — the visiting user simply can't see a
-- handoff belonging to a different tenant, full stop.
-- ============================================================================
create table public.prompter_promotion_handoffs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  snapshot_id uuid references public.prompter_product_snapshots(id) on delete set null,
  product_id uuid references public.prompter_products(id) on delete set null,
  source_system text not null default 'umkmpro',
  external_user_reference text,
  status text not null default 'PENDING' check (status in ('PENDING', 'CONSUMED', 'EXPIRED')),
  idempotency_key text,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint prompter_promotion_handoffs_idempotency_unique unique (tenant_id, source_system, idempotency_key)
);

comment on table public.prompter_promotion_handoffs is
  'Tanyopo AI Promoter: one-time "Promosikan dengan AI" handoff from UMKMpro. Consumed by /promote?handoff=<id>.';

create index idx_prompter_promotion_handoffs_tenant on public.prompter_promotion_handoffs (tenant_id, created_at desc);

alter table public.prompter_promotion_handoffs enable row level security;

create policy "Lihat handoff tenant sendiri"
  on public.prompter_promotion_handoffs for select
  using (tenant_id = public.fn_current_tenant_id());

create policy "Tenant sendiri bisa menandai handoff terpakai"
  on public.prompter_promotion_handoffs for update
  using (tenant_id = public.fn_current_tenant_id())
  with check (tenant_id = public.fn_current_tenant_id());

-- Insert has no authenticated-role policy — handoffs are only ever created
-- by the service-role client from a signed UMKMpro request.

-- ============================================================================
-- prompter_webhook_events
-- Idempotent receipt log for /api/v1/integrations/umkmpro/webhooks
-- (product spec §56-57). `external_event_id` is UMKMpro's own event id;
-- the unique constraint is what makes redelivery a safe no-op.
-- ============================================================================
create table public.prompter_webhook_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  source_system text not null default 'umkmpro',
  external_event_id text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'RECEIVED' check (status in ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED')),
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint prompter_webhook_events_unique unique (source_system, external_event_id)
);

comment on table public.prompter_webhook_events is
  'Tanyopo AI Promoter: idempotent webhook receipt log. tenant_id is null only when the tenant could not be resolved (status = IGNORED).';

create index idx_prompter_webhook_events_tenant on public.prompter_webhook_events (tenant_id, received_at desc);

alter table public.prompter_webhook_events enable row level security;

create policy "Lihat webhook event tenant sendiri"
  on public.prompter_webhook_events for select
  using (tenant_id = public.fn_current_tenant_id());
