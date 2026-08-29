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

`ACTIVE`, `PAUSED`, `COMPLETED`, `FAILED` exist in the CHECK constraint (both `prompter_master_campaigns.status` and `prompter_channel_campaigns.status`) for forward compatibility, but **no code path in this repository sets them** — those transitions require a real platform connector (Phase 3+) to confirm the campaign is actually live, per the product spec's status-transparency rule (never claim "berhasil tayang" without external confirmation).

## TypeScript types

`types/database.ts` is **hand-authored**, not the full `supabase gen types typescript` output. The shared project's full schema is ~80 UMKMpro-specific tables (POS, inventory, HR, workshop, F&B, ...) that this app never queries; importing all of it would make every Promoter file's types depend on a schema this codebase doesn't own. Instead, `types/database.ts` declares only the tables Promoter actually touches: the `prompter_*` tables plus a read-oriented slice of `tenants`/`user_profiles`.

**When adding a table or column Promoter depends on, update `types/database.ts` by hand alongside the migration.** If a future feature needs a genuinely broad read across UMKMpro's schema, that's a signal to reconsider the approach, not to switch wholesale to the generated file.

## Naming convention

Every table, function, and trigger this app introduces is prefixed `prompter_` (the one exception is calling UMKMpro's pre-existing `fn_current_tenant_id()`/`fn_current_role()` helpers directly, since duplicating them would just be two sources of truth for the same tenant check).
