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

## TypeScript types

`types/database.ts` is **hand-authored**, not the full `supabase gen types typescript` output. The shared project's full schema is ~80 UMKMpro-specific tables (POS, inventory, HR, workshop, F&B, ...) that this app never queries; importing all of it would make every Promoter file's types depend on a schema this codebase doesn't own. Instead, `types/database.ts` declares only the tables Promoter actually touches: the three `prompter_*` tables plus a read-oriented slice of `tenants`/`user_profiles`.

**When adding a table or column Promoter depends on, update `types/database.ts` by hand alongside the migration.** If a future feature needs a genuinely broad read across UMKMpro's schema, that's a signal to reconsider the approach, not to switch wholesale to the generated file.

## Naming convention

Every table, function, and trigger this app introduces is prefixed `prompter_` (the one exception is calling UMKMpro's pre-existing `fn_current_tenant_id()`/`fn_current_role()` helpers directly, since duplicating them would just be two sources of truth for the same tenant check).
