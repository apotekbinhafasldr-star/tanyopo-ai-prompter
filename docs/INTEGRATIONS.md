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

Namespace: `/api/v1/integrations/umkmpro/*` (`products`, `promotions`, `conversions`, `webhooks`). Authenticated via a signed service token (`UMKMPRO_SERVICE_TOKEN`), not direct database access — UMKMpro AI never queries Promoter's Postgres directly, and Promoter never queries UMKMpro's application logic directly, even though they share a Postgres instance.

Product handoff creates a `product_snapshots` row (Phase 4) rather than a live foreign key to UMKMpro's `products` table, so a campaign built from a snapshot stays valid even if the source product's price or details later change in UMKMpro.

## Current state (Phase 3)

Meta connector and OAuth flow are implemented and structurally complete but unverified against a live ad account (see above). TikTok and X connectors don't exist yet (`getConnector()` returns `null`) — `/connections` renders them as `NOT_AVAILABLE`. UMKMpro AI integration (Phase 4) hasn't started.
