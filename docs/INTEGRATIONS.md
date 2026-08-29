# Integrations

## Principle

If a third-party API isn't configured — no credentials, no approval, nothing set up — the UI says **`NOT_CONFIGURED`**. It never says `CONNECTED`. See `components/ui/status-pill.tsx` for the shared status vocabulary (`CONNECTED`, `NOT_CONNECTED`, `EXPIRED`, `ACTION_REQUIRED`, `NOT_AVAILABLE`, `NOT_CONFIGURED`) every connector-facing screen must use.

`lib/env.ts` exposes `isConnectorConfigured()` for exactly this check — pass it the credential fields a connector needs, and it tells you whether to render the real UI or the not-configured state.

## Connector architecture

Every ad platform implements the same interface (`lib/connectors/types.ts#PlatformConnector`), so business logic never depends on which platform it's talking to:

```ts
interface PlatformConnector {
  readonly platform: "META" | "TIKTOK" | "X";
  isConfigured(): boolean;
  getAuthorizationUrl(state): string;
  exchangeCodeForToken(code): Promise<ConnectorTokenResult>;
  disconnect(accessToken, externalAccountId): Promise<void>;
  getAccounts(accessToken): Promise<ConnectorAccount[]>;
  createCampaign(...): Promise<{ id }>;
  createAdSet(...): Promise<{ id }>;
  createCreative(...): Promise<{ id }>;
  createAd(...): Promise<{ id }>;
  getInsights(accessToken, externalCampaignId): Promise<ConnectorInsights>;
  pauseCampaign(accessToken, externalCampaignId): Promise<void>;
  updateBudget(accessToken, externalCampaignId, dailyBudgetMinorUnits): Promise<void>;
}
```

`lib/connectors/get-connector.ts#getConnector(platform)` returns the implementation or `null` — `null` means **no connector code exists for that platform yet** (TikTok/X, Phase 6), which the UI must render as `NOT_AVAILABLE`, distinct from a connector that exists but lacks credentials (`connector.isConfigured() === false` → `NOT_CONFIGURED`).

**Implemented:** `lib/connectors/meta-connector.ts` (Facebook & Instagram, via the Meta Marketing API). A method called without `META_APP_ID`/`META_APP_SECRET`/`META_REDIRECT_URI` configured throws `ConnectorConfigError` — it never attempts the call, never falls back to a mock success, never simulates campaign data. Every object the connector creates (campaign, ad set, ad) is left in Meta's `PAUSED` state — nothing this app does can start real ad spend on its own.

**Not yet implemented:** `TikTokConnector`, `XConnector` (Phase 6) — `getConnector()` returns `null` for both today.

**Honesty about verification:** this environment has neither Meta credentials nor network access to `graph.facebook.com`, so the Meta connector's Graph API request/response shapes follow the documented Marketing API v21.0 contracts as closely as possible but have **not been exercised against a live ad account**. Treat it as a first implementation to verify once real credentials exist, not as battle-tested code. One known incomplete step: `createCreative` requires a Facebook Page ID (Meta ads run "as" a Page) and there's no Page-picker UI yet, so it throws a clear `ConnectorConfigError` until that's built — the campaign-launch flow below reaches that step and stops there today, honestly, rather than faking a completed ad.

## Platform capability registry

`prompter_platform_capabilities` (product spec §31) — global reference data, seeded by migration, read-only from the app. Records per platform × capability whether it's `enabled` (this codebase has an implementation), `requires_oauth`, `requires_approval` (the platform's own app-review requirement, not Promoter's Approval Center), and `api_version`. Meta's ads capabilities (`CONNECT_ACCOUNT`, `READ_ANALYTICS`, `CREATE_CAMPAIGN`, `CREATE_AD`, `UPDATE_BUDGET`, `PAUSE_CAMPAIGN`) are enabled; `PUBLISH_CONTENT` (organic posting, as opposed to ads) is not — Phase 3 only covers the Marketing API. Every TikTok/X row is disabled.

## OAuth token handling

- **Authorize:** `GET /api/connections/meta/authorize` — owner-only (checked in the route, and independently enforced by RLS on `prompter_connected_accounts`), generates a random `state`, stores `state:tenantId` in a short-lived httpOnly cookie, redirects to Meta's OAuth dialog.
- **Callback:** `GET /api/connections/meta/callback` — validates `state` against the cookie, exchanges the code for a short-lived token, exchanges that for a long-lived token (~60 days), reads granted scopes via `/debug_token`, fetches the user's ad accounts, and writes through the **service-role client only** (`lib/supabase/admin.ts`):
  - `prompter_connected_accounts` — metadata only (external account id/name, status, scopes, `expires_at`).
  - `prompter_oauth_credentials` — the token, encrypted via `lib/crypto/token-cipher.ts` (AES-256-GCM, key from `TOKEN_ENCRYPTION_KEY`) before it's written. This table has RLS enabled with **zero policies** for `anon`/`authenticated` — only the service-role key can ever read or write it, so a token can't reach the browser through any ordinary query path, not just by app-layer discipline.
- **Disconnect:** `features/connections/actions.ts#disconnectAction()` — owner-only, attempts remote token revocation on a best-effort basis (Meta's `DELETE /me/permissions`), then always deletes the local rows regardless of whether that remote call succeeded, so this app never keeps showing `CONNECTED` for a connection the user asked to remove.
- Metadata (`expires_at`, `refreshable`, `scopes`, `status`, `last_refreshed_at`) is what the Connection Center displays — never the token itself, in any form.

## Campaign launch (Meta)

`features/campaigns/launch-actions.ts#launchChannelCampaignAction()` — the one code path in this app allowed to set a `prompter_channel_campaigns.status` to `ACTIVE`, and only after Meta's own API has confirmed each object (campaign → ad set → creative → ad) was actually created. Preconditions, all checked before any API call: the master campaign is `SCHEDULED` (i.e., already through Budget Guard + Approval Center), the channel is `FACEBOOK`/`INSTAGRAM`, and the tenant has a `CONNECTED` Meta account. A failure at any step — including the expected `createCreative` config error today — is stored on the channel campaign's `error` column and surfaces in the UI, never silently swallowed or reported as success.

## UMKMpro AI integration (Phase 4)

Namespace: `/api/v1/integrations/umkmpro/*` (`products`, `promotions`, `conversions`, `webhooks`). Authenticated via a signed service token (`UMKMPRO_SERVICE_TOKEN`) — HMAC-SHA256 over `${timestamp}.${rawBody}`, not direct database access. UMKMpro AI never queries Promoter's Postgres directly, and Promoter never queries UMKMpro's application logic directly, even though they share a Postgres instance. See [SECURITY.md](SECURITY.md) "Signed service authentication" for the full verification design.

Every route follows the same shape (`lib/umkmpro/route-helpers.ts#authorizeUmkmproRequest()`): verify the signature → apply a best-effort rate limit (60 req/min per route, see [SECURITY.md](SECURITY.md) "Rate limiting") → get a service-role client (`503 NOT_CONFIGURED` if `SUPABASE_SECRET_KEY` is unset) → validate the body with a Zod schema (`schemas/umkmpro.ts`) → confirm `tenantId` resolves to a real row in `public.tenants` (`404 TENANT_NOT_FOUND` otherwise — a signed request still can't write into a tenant that doesn't exist) → do the write. Every response uses the shared envelope (`lib/api/response.ts`): `{ data, error, meta }`.

- **`POST /products`** — `services/umkmpro.ts#upsertProductFromUmkmpro()`. Upserts the live `prompter_products` mirror (`unique(tenant_id, source_system, source_product_id)`, see [DATABASE.md](DATABASE.md)) and always inserts a **new** `prompter_product_snapshots` row (append-only, product spec §48) — a campaign built from a snapshot stays historically accurate even after the source product's price/stock later changes in UMKMpro. Idempotent by nature (an upsert), so a re-sync of the same product is always safe.
- **`POST /promotions`** — backs UMKMpro AI's "🚀 PROMOSIKAN DENGAN AI" button (product spec §47). Syncs the product (same path as above), creates a `prompter_promotion_handoffs` row, and returns `{ handoffId, handoffUrl }` where `handoffUrl` is `${NEXT_PUBLIC_APP_URL}/promote?handoff=<id>` for UMKMpro to redirect its user to. Idempotent on `(tenantId, idempotencyKey)` — a retried request (e.g. after a network timeout) returns the same handoff rather than creating a duplicate (`201` first time, `200` on replay).
- **`POST /conversions`** — `services/umkmpro.ts#recordConversionFromUmkmpro()`. Upserts into the same `prompter_conversions` table Phase 2's manual conversion logging writes to, distinguished by `source = 'umkmpro'` and a real `externalEventId` (`unique(tenant_id, source, external_event_id)`) — a resend with corrected values overwrites rather than duplicating.
- **`POST /webhooks`** — a generic, idempotent receipt log (product spec §56-57), `prompter_webhook_events`. Deliberately scoped to honest bookkeeping, not a dispatch pipeline: redelivery of the same `externalEventId` is a safe no-op (`unique(source_system, external_event_id)`), and a `tenantId` that doesn't resolve to a real tenant is recorded `IGNORED` with a reason rather than silently dropped or misattributed. No downstream processing is invented for arbitrary `eventType` values — that's out of scope until a concrete event needs it.

### Consuming a handoff (`/promote?handoff=<id>`)

`app/(app)/promote/page.tsx` resolves the `handoff` query param using the **normal session-scoped Supabase client**, not the admin client — `prompter_promotion_handoffs`' RLS SELECT/UPDATE policies are exactly what "this handoff belongs to the visiting user's tenant" means here: a handoff for a different tenant simply isn't returned by the query, no extra application check needed. An expired handoff (`expires_at` passed) shows a clear message instead of silently proceeding; a `PENDING` handoff is marked `CONSUMED` on resolution, and a link visited again after that still resolves the same product (the one-time semantics are about not re-triggering a fresh handoff record, not about blocking navigation).

Two pre-existing gaps had to be fixed for this to work for a visitor not already logged into Promoter: `proxy.ts` was dropping the query string in its post-login `next` redirect param (fixed — now preserves `pathname + search`), and `loginAction` always redirected to `/dashboard` regardless of `next` (fixed — now redirects to a validated same-origin `next` path, defaulting to `/dashboard`). **Known remaining gap:** a first-time UMKMpro user who hasn't completed Promoter's own `/onboarding` yet will be routed there first, and the `next=/promote?handoff=...` param doesn't currently survive that hop — the handoff will have expired (30 minutes) by the time onboarding is done in the realistic case, showing the expired-link message rather than silently failing.

## Current state (Phase 4)

Meta connector and OAuth flow are implemented and structurally complete but unverified against a live ad account (see above). TikTok and X connectors don't exist yet (`getConnector()` returns `null`) — `/connections` renders them as `NOT_AVAILABLE`. UMKMpro AI integration is implemented and its signed-authentication layer was verified against a real running local server (see [ROADMAP.md](ROADMAP.md) Phase 4 for what was and wasn't exercisable in this environment).
