# Integrations

## Principle

If a third-party API isn't configured — no credentials, no approval, nothing set up — the UI says **`NOT_CONFIGURED`**. It never says `CONNECTED`. See `components/ui/status-pill.tsx` for the shared status vocabulary (`CONNECTED`, `NOT_CONNECTED`, `EXPIRED`, `ACTION_REQUIRED`, `NOT_AVAILABLE`, `NOT_CONFIGURED`) every connector-facing screen must use.

`lib/env.ts` exposes `isConnectorConfigured()` for exactly this check — pass it the credential fields a connector needs, and it tells you whether to render the real UI or the not-configured state.

## Planned connector architecture (Phase 3 / Phase 6)

Each ad platform gets a typed adapter implementing the same capability surface, so business logic never depends on which platform it's talking to:

```ts
interface PlatformConnector {
  connect(): Promise<...>;
  disconnect(): Promise<...>;
  getAccounts(): Promise<...>;
  createCampaign(...): Promise<...>;
  createAdSet(...): Promise<...>;
  createCreative(...): Promise<...>;
  createAd(...): Promise<...>;
  getInsights(...): Promise<...>;
  pauseCampaign(...): Promise<...>;
  updateBudget(...): Promise<...>;
}
```

- `MetaConnector` (Facebook & Instagram) — `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`
- `TikTokConnector` — `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET`, `TIKTOK_REDIRECT_URI`
- `XConnector` — `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REDIRECT_URI`

A method called without the underlying credentials configured returns a typed configuration error — it does not attempt the call, does not fall back to a mock success, and does not simulate campaign data.

Not every connector will support every capability on day one (TikTok/X should not be assumed to have feature parity with Meta). The `platform_capabilities` table (Phase 3, see product spec §31) records exactly which capability is enabled, whether it requires OAuth/approval, and the API version, per platform — the UI reads this rather than assuming.

## OAuth token handling (once implemented)

- Tokens are exchanged and stored **server-side only**, encrypted at rest.
- Tokens are never sent to the browser and never rendered in the UI.
- Metadata (`expires_at`, `refreshable`, `scopes`, `status`, `last_refreshed_at`) is what the Connection Center displays — never the token itself.

## UMKMpro AI integration (Phase 4)

Namespace: `/api/v1/integrations/umkmpro/*` (`products`, `promotions`, `conversions`, `webhooks`). Authenticated via a signed service token (`UMKMPRO_SERVICE_TOKEN`), not direct database access — UMKMpro AI never queries Promoter's Postgres directly, and Promoter never queries UMKMpro's application logic directly, even though they share a Postgres instance.

Product handoff creates a `product_snapshots` row (Phase 4) rather than a live foreign key to UMKMpro's `products` table, so a campaign built from a snapshot stays valid even if the source product's price or details later change in UMKMpro.

## Current state (Phase 0)

No connector code exists yet. `/connections` renders a stub stating the phase it ships in. This document exists now so the capability boundaries are decided before any connector code is written.
