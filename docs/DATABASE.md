# Database

## Why one shared Supabase project

Tanyopo AI Promoter deliberately does **not** provision its own Supabase project. It uses the existing project that already runs UMKMpro AI (`umkmpro-ai`, project ref `wjjyqovhmwenbcvbnkgx`). This was an explicit product decision, not a default:

- Auth identity (`auth.users`) and tenant identity (`public.tenants`, `public.user_profiles`) already exist for every UMKMpro AI business owner. Reusing them means a business owner has one account across both products, immediately, with no bridging work.
- Promoter still behaves as a fully isolated tenant of data: every table it owns is prefixed `prompter_` and scoped by `tenant_id`, enforced by Row Level Security — not by application-level filtering.

**Hard rule:** migrations in this repository are additive-only. They create new `prompter_*` tables, functions, and policies. They never `ALTER`, `DROP`, or rename anything owned by UMKMpro AI (its ~80 existing tables, its RLS policies, its trigger functions). If a future feature genuinely needs to change shared behavior, that's a cross-team decision, not something a Promoter migration does unilaterally.

## Tenancy model

Promoter does **not** introduce its own `organizations` / `organization_members` schema. It reuses UMKMpro AI's:

| Table | Owned by | Promoter's relationship |
|---|---|---|
| `auth.users` | Supabase Auth | Shared identity |
| `public.tenants` | UMKMpro AI | One row = one business. Promoter's `tenant_id` foreign keys point here. |
| `public.user_profiles` | UMKMpro AI | `id = auth.uid()`, `tenant_id`, `role`. A signup trigger (`handle_new_user`, owned by UMKMpro AI) auto-creates a `tenants` + `user_profiles` row for every new `auth.users` row, regardless of which app the signup came from. |

RLS on every `prompter_*` table uses UMKMpro AI's existing helper functions rather than redefining tenant-scoping logic:

- `public.fn_current_tenant_id()` — the caller's `tenant_id`
- `public.fn_current_role()` — the caller's `user_profiles.role` (`owner`, `apoteker`, `kasir`, `admin_gudang`, `hr`, `marketing` — a UMKMpro-defined CHECK constraint Promoter does not control; Promoter's own permission language, e.g. OWNER/ADMIN/MARKETER/STAFF/VIEWER, maps onto these values in application code rather than changing the constraint)

### Standalone (non-UMKMpro) users

A user who registers directly through Promoter (`/register`) still gets a `tenants` + `user_profiles` row via the same shared trigger — `jenis_usaha` is set to `"lainnya"` since it isn't a UMKMpro business type. Real marketing context (business category, what they sell, primary goal, tone of voice, etc.) is collected in `/onboarding` and stored in `prompter_brand_profiles`, which is entirely Promoter's own table.

## Phase 0 schema

Migration: `supabase/migrations/20260829080000_prompter_foundation_schema.sql` (+ a follow-up linter fix in `20260829080100_prompter_fix_function_search_path.sql`).

### `prompter_brand_profiles`

One row per tenant. The AI-context/brand profile described in the product spec's "Brand Profile" and onboarding sections — distinct from `public.tenants`, which is UMKMpro's own business record.

| Column | Type | Notes |
|---|---|---|
| `tenant_id` | `uuid` PK | `references public.tenants(id) on delete cascade` |
| `brand_name`, `business_description`, `what_do_you_sell` | `text` | |
| `business_category` | `text` | CHECK: `PHYSICAL_PRODUCT`, `SERVICE`, `APPLICATION`, `SUBSCRIPTION`, `DIGITAL_PRODUCT` |
| `primary_goal` | `text` | CHECK: `INCREASE_SALES`, `GET_LEADS`, `INCREASE_FOLLOWERS`, `BRAND_AWARENESS`, `WEBSITE_TRAFFIC`, `PROMOTE_APP` |
| `tone_of_voice`, `target_market`, `prohibited_claims` | `text` | |
| `default_language` | `text` | CHECK: `id`, `en`. Default `id`. |
| `default_currency` | `text` | Default `IDR` (ISO code, not hard-coded formatting) |
| `default_timezone` | `text` | Default `Asia/Jakarta` |
| `logo_url`, `website_url` | `text` | |
| `onboarding_completed` | `boolean` | Gates access to `/dashboard` — see `services/session.ts` |
| `onboarding_step` | `smallint` | |
| `created_at`, `updated_at` | `timestamptz` | `updated_at` maintained by trigger |

RLS: any tenant member can `SELECT`/`INSERT` their own tenant's row; only `owner`/`marketing` roles can `UPDATE` it.

### `prompter_automation_settings`

One row per tenant. Governs Manual / AI Assist / Autopilot mode and the emergency stop switch. Defaults are the safest possible state (`manual`, stop inactive, no autopilot budget). No code path is allowed to set `automation_mode = 'autopilot'` without an explicit user action — see [SECURITY.md](SECURITY.md).

RLS: same pattern as `prompter_brand_profiles` (tenant `SELECT`/`INSERT`, `owner`/`marketing` `UPDATE`).

### `prompter_audit_logs`

Append-only. `tenant_id`, `actor_user_id`, `action`, `resource_type`, `resource_id`, `before_data`/`after_data` (JSONB), `context` (JSONB), `created_at`. Indexed on `(tenant_id, created_at desc)` and `(resource_type, resource_id)`.

RLS: tenant members can `SELECT` and `INSERT` (as themselves — `actor_user_id` must be `auth.uid()` or `null`). **No `UPDATE`/`DELETE` policy exists on purpose** — rows are immutable once written.

## Phase 1 schema

Migration: `supabase/migrations/20260829120000_prompter_phase1_schema.sql`. Same additive-only rule as Phase 0. Write access (`INSERT`/`UPDATE`/`DELETE`) on every table below is restricted to `owner`/`marketing` roles (these actions create real AI cost or are marketing-facing changes); `SELECT` is open to any tenant member.

| Table | Purpose |
|---|---|
| `prompter_products` | Product/service/app/subscription catalog. `source_system`/`source_product_id` are reserved for the Phase 4 UMKMpro handoff — every Phase 1 row has `source_system = 'promoter'`. |
| `prompter_product_media` | Uploaded product images/videos; `storage_path` points into the `product-media` bucket. |
| `prompter_ai_jobs` | One row per AI generation call — `job_type`, `status` (`QUEUED`/`PROCESSING`/`COMPLETED`/`FAILED`), `model`, token counts, `estimated_cost`, `error`. Written by `services/ai-jobs.ts#runAiJob()`, never left stuck `QUEUED`. |
| `prompter_marketing_blueprints` | One row per product (`unique(product_id)`) — regenerating overwrites via upsert rather than versioning. |
| `prompter_master_campaigns` | Campaign draft from the Promote Wizard. Phase 1 only ever writes `status = 'DRAFT'`; `channels` records the user's *intent*, not a live platform connection. `ai_proposal` is the validated `CampaignProposalSchema` output stored as JSONB. |
| `prompter_content_items` | AI-generated content (`CAPTION`/`AD_COPY`/`BLOG`/`VIDEO_SCRIPT`). Phase 1 only ever writes `status = 'DRAFT'` — scheduling/publishing states exist in the CHECK constraint for forward-compatibility but aren't reachable yet. |

### Storage buckets

Also created in the Phase 1 migration, all public-read (so they can be embedded in ad previews and social posts) with object paths namespaced `{tenant_id}/...` and a `storage.objects` RLS policy restricting writes to the caller's own tenant folder:

| Bucket | Limit | Status |
|---|---|---|
| `product-media` | 100 MB, image/video | In use (product media upload) |
| `creative-assets` | 100 MB, image/video | Reserved — Phase 3+ |
| `brand-assets` | 5 MB, image/svg | Reserved — logo upload, not yet built |
| `generated-content` | 100 MB, image/video | Reserved — AI-generated creative, not yet built |

## Phase 2 schema

Migration: `supabase/migrations/20260829140000_prompter_phase2_schema.sql`. Same additive-only rule as Phase 0/1.

| Table | Purpose | Write access |
|---|---|---|
| `prompter_budget_policies` | One row per tenant (lazily created via `services/budget-guard.ts#getOrCreateBudgetPolicy()`). Hard limits (`daily_limit`, `campaign_limit`) checked before a campaign can be submitted. | **Owner only** — financial governance, stricter than the owner/marketing pattern used elsewhere |
| `prompter_channel_campaigns` | Per-channel row under a master campaign (`unique(master_campaign_id, channel)`), materialized from the campaign's `channels` + the AI proposal's `budget_allocation`. `status` mirrors the parent master campaign. `external_campaign_id` stays `null` until a Phase 3+ connector actually creates the ad — nothing in this app writes a fake one. | owner/marketing |
| `prompter_approvals` | Approval Center queue. Phase 2 only creates `CAMPAIGN_LAUNCH` rows (`resource_type = 'prompter_master_campaigns'`); the other types in the CHECK constraint (`BUDGET_CHANGE`, `CAMPAIGN_SCALE`, `CONTENT_PUBLISH`, `AUTOPILOT_ACTION`) are forward-compatible reservations. | Insert: owner/marketing (`requested_by` must be the caller). **Decide (update): owner only** — enforced by RLS, not just the UI, giving a real separation of duties between who submits and who approves. |
| `prompter_marketing_metrics` | Normalized daily metrics per channel campaign (spend, impressions, reach, clicks, conversions, revenue, ...). Empty until a Phase 3+ connector syncs real platform data — `/analytics` reads this table and shows an honest empty state, never a fabricated number. | owner/marketing |
| `prompter_conversions` | Conversion events. Phase 2 supports manual entry only (`source` defaults to `'manual'`) via the Analytics page's "Catat Konversi" form — there's no ad-platform conversion API or UMKMpro bridge yet (Phase 4). | owner/marketing |
| `prompter_attributions` | Attribution schema (`LAST_CLICK`/`FIRST_CLICK`/`MANUAL`/`UMKMPRO_VERIFIED` models). Modeled now so a future attribution engine doesn't need a schema migration on launch day — **no code path writes to this table yet**. | owner/marketing |

### Campaign status machine (Phase 2)

```
DRAFT --submit (passes Budget Guard)--> AWAITING_APPROVAL --Owner approves--> SCHEDULED
  ^                                           |
  |___________Owner rejects, or submitter cancels___________|
```

As of Phase 2, `ACTIVE`, `PAUSED`, `COMPLETED`, `FAILED` exist in the CHECK constraint (both `prompter_master_campaigns.status` and `prompter_channel_campaigns.status`) for forward compatibility, but no code path sets them yet — those transitions require a real platform connector to confirm the campaign is actually live, per the product spec's status-transparency rule (never claim "berhasil tayang" without external confirmation). Phase 3 adds exactly one such path — see below.

## Phase 3 schema

Migrations: `supabase/migrations/20260829160000_prompter_phase3_schema.sql` and a small follow-up (`20260829160100_prompter_channel_campaigns_add_error.sql`, adds `prompter_channel_campaigns.error`). Same additive-only rule as Phase 0-2.

| Table | Purpose | Write access |
|---|---|---|
| `prompter_platform_capabilities` | Global connector capability registry (`platform` × `capability` → `enabled`/`requires_oauth`/`requires_approval`/`api_version`), not tenant-scoped. Seeded by the migration itself. | **None** — no INSERT/UPDATE/DELETE policy exists at all; a capability change is a new migration, never a runtime write. |
| `prompter_connected_accounts` | OAuth connection metadata per tenant per platform (`unique(tenant_id, platform)`) — external account id/name, `status`, `scopes`, `expires_at`. **Never the token.** A missing row means `NOT_CONNECTED`; a row is only ever written after a real OAuth callback succeeds. | Owner only |
| `prompter_oauth_credentials` | Encrypted tokens (`lib/crypto/token-cipher.ts`, AES-256-GCM). RLS enabled with **zero policies** — see [SECURITY.md](SECURITY.md) "OAuth token storage." Only the service-role client can touch this table. | Service-role only (no app-level policy) |

`platform` here (`META`/`TIKTOK`/`X`) names an OAuth connector/provider, deliberately distinct from the `Channel` enum used on campaigns/content (`FACEBOOK`/`INSTAGRAM`/`TIKTOK`/`X`/`SEO`) — a single Meta connection covers both the Facebook and Instagram channels, matching the Connection Center's one "Facebook & Instagram" card.

### The one path to `ACTIVE`

`features/campaigns/launch-actions.ts#launchChannelCampaignAction()` is the only code in this repository that sets `prompter_channel_campaigns.status = 'ACTIVE'` — and only after Meta's Graph API has confirmed the campaign, ad set, creative, and ad were all actually created. A failure at any step is stored in the new `error` column and the row's status becomes `FAILED` instead; nothing is left in an ambiguous or fabricated state.

## Phase 4 schema

Migration: `supabase/migrations/20260829180000_prompter_phase4_schema.sql`. Same additive-only rule as Phase 0-3.

| Table | Purpose | Write access |
|---|---|---|
| `prompter_product_snapshots` | Append-only historical snapshot of a product as UMKMpro AI reported it at sync time (product spec §48). A campaign built from a snapshot stays historically accurate even after the source product's price/stock later changes in UMKMpro — `linked_product_id` points at the live, mutable `prompter_products` mirror the rest of the app queries; the snapshot itself is never mutated. | Service-role only (no app-level INSERT/UPDATE/DELETE policy) |
| `prompter_promotion_handoffs` | One-time "🚀 PROMOSIKAN DENGAN AI" handoff (product spec §47). UMKMpro AI creates one via the signed API, then redirects its user to `/promote?handoff=<id>`; Promoter's own tenant-scoped RLS SELECT is what "validates this belongs to the visiting user's tenant" means — a handoff for a different tenant simply never comes back from the query a logged-in user's browser makes. `status` moves `PENDING` → `CONSUMED` when `/promote` resolves it, or `EXPIRED` after `expires_at` (30 minutes). `unique(tenant_id, source_system, idempotency_key)` makes a retried UMKMpro request safe. | Insert: service-role only. Update (marking consumed): any tenant member |
| `prompter_webhook_events` | Idempotent receipt log for the generic webhook endpoint (product spec §56-57). `unique(source_system, external_event_id)` makes redelivery a safe no-op — a duplicate insert is caught and the existing row's id is returned instead of erroring. This table is the audit trail for webhook deliveries; it does not drive any further automated processing today. | Service-role only |

Two existing tables also gained a Phase 4 column/constraint:

- `prompter_products` — `unique(tenant_id, source_system, source_product_id)`. Every `'promoter'`-sourced row keeps `source_product_id = null`, and Postgres treats multiple `NULL`s in a unique constraint as mutually non-conflicting, so this constraint only actually constrains `'umkmpro'`-sourced rows — exactly what makes `upsertProductFromUmkmpro()` (`services/umkmpro.ts`) a safe upsert rather than a duplicate-row risk on every re-sync.
- `prompter_conversions` — new `external_event_id` column plus `unique(tenant_id, source, external_event_id)`, same NULL-distinctness trick: Phase 2's manual entries (`external_event_id IS NULL`) never collide with each other or with UMKMpro-sourced rows.

### UMKMpro AI integration surface

`/api/v1/integrations/umkmpro/{products,promotions,conversions,webhooks}` — signed service-to-service routes, no Supabase user session involved. See [INTEGRATIONS.md](INTEGRATIONS.md) and [SECURITY.md](SECURITY.md) for the authentication design; `services/umkmpro.ts` is the data-access layer every route calls into.

## TypeScript types

`types/database.ts` is **hand-authored**, not the full `supabase gen types typescript` output. The shared project's full schema is ~80 UMKMpro-specific tables (POS, inventory, HR, workshop, F&B, ...) that this app never queries; importing all of it would make every Promoter file's types depend on a schema this codebase doesn't own. Instead, `types/database.ts` declares only the tables Promoter actually touches: the `prompter_*` tables plus a read-oriented slice of `tenants`/`user_profiles`.

**When adding a table or column Promoter depends on, update `types/database.ts` by hand alongside the migration.** If a future feature needs a genuinely broad read across UMKMpro's schema, that's a signal to reconsider the approach, not to switch wholesale to the generated file.

## Naming convention

Every table, function, and trigger this app introduces is prefixed `prompter_` (the one exception is calling UMKMpro's pre-existing `fn_current_tenant_id()`/`fn_current_role()` helpers directly, since duplicating them would just be two sources of truth for the same tenant check).
