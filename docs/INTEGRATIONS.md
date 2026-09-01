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
  createCampaign(accessToken, adAccountId, ...): Promise<{ id }>;
  createAdSet(accessToken, adAccountId, ...): Promise<{ id }>;
  createCreative(accessToken, adAccountId, ...): Promise<{ id }>;
  createAd(accessToken, adAccountId, ...): Promise<{ id }>;
  getInsights(accessToken, adAccountId, externalCampaignId): Promise<ConnectorInsights>;
  pauseCampaign(accessToken, adAccountId, externalCampaignId): Promise<void>;
  updateBudget(accessToken, adAccountId, externalCampaignId, dailyBudgetMinorUnits): Promise<void>;
}
```

`adAccountId` is threaded through every method (not just the create* ones, as of Phase 6) because not every platform's objects are globally addressable by id alone the way Meta's Graph API objects are — TikTok's and X's ad-management APIs scope nearly every endpoint under the advertiser/account id. Meta's implementation simply ignores the parameter where it doesn't need it.

As of Phase 7, `getInsights`/`pauseCampaign`/`updateBudget` are no longer unwired stubs: `features/campaigns/sync-insights-actions.ts#syncChannelCampaignInsightsAction()` calls `getInsights()` to pull real performance data into `prompter_marketing_metrics`, and `features/approvals/actions.ts#executeAutopilotAction()` calls `pauseCampaign()`/`updateBudget()` once an Owner approves an Optimization Agent recommendation — both against an `ACTIVE` channel campaign's real `external_campaign_id`, never a fabricated one.

`lib/connectors/get-connector.ts#getConnector(platform)` returns the implementation or `null` — as of Phase 6, every `ConnectorPlatform` has a real implementation, so `null` is now a forward-compatible fallback rather than an active TikTok/X state. A connector that exists but lacks credentials still renders `NOT_CONFIGURED` (`connector.isConfigured() === false`), distinct from `NOT_AVAILABLE` (no connector code at all).

**Implemented:** `lib/connectors/meta-connector.ts` (Facebook & Instagram, Marketing API v21.0), `lib/connectors/tiktok-connector.ts` (TikTok for Business Marketing API v1.3), `lib/connectors/x-connector.ts` (X Ads API v12). A method called on an unconfigured connector throws `ConnectorConfigError` — it never attempts the call, never falls back to a mock success, never simulates campaign data. Every object every connector creates is left paused/disabled (`PAUSED` on Meta, `operation_status: "DISABLE"` on TikTok, `entity_status: "PAUSED"` on X) — nothing this app does can start real ad spend on its own.

**Honesty about verification:** this environment has neither credentials nor network access for any of the three platforms' APIs, so all three connectors' request/response shapes follow their documented API contracts as closely as possible but have **not been exercised against a live ad account**. Treat each as a first implementation to verify once real credentials exist, not as battle-tested code.

**Known incomplete steps — one real missing prerequisite per platform, disclosed rather than worked around:**
- **Meta**: `createCreative` requires a Facebook Page ID (Meta ads run "as" a Page) and there's no Page-picker UI yet — throws `ConnectorConfigError` there.
- **TikTok**: `createAdSet` throws immediately — TikTok's targeting API takes numeric `location_id`s from TikTok's own location catalog, not ISO country codes, and this app has no verified mapping. Guessing a number would risk silently targeting the wrong location with real budget, which is worse than stopping. `createCreative` would also stop (TikTok ad creatives need an already-uploaded video/image asset and there's no upload UI), but the flow never reaches it since `createAdSet` runs first.
- **X**: `createCampaign` auto-selects the ad account's first funding instrument (same "no picker, use the first one" simplification already used for ad-account selection) — real code, not a gap. `createAdSet` then throws for the same reason as TikTok's (X also uses its own numeric location catalog, not ISO codes). `createCreative` would also stop (X Promoted Tweets require an existing tweet id and this app has no tweet-composition flow). X's connector additionally has **no PKCE** on its OAuth2 flow — X's docs state `code_challenge` is required for every client type, and this connector doesn't send one yet, so the authorization request will likely be rejected by X until that's added.

## Platform capability registry

`prompter_platform_capabilities` (product spec §31) — global reference data, seeded by migration, read-only from the app. Records per platform × capability whether it's `enabled` (this codebase has an implementation — not "verified against a live account" or "no remaining gaps," see Meta's own `CREATE_AD` row which was already `enabled=true` despite its Page-picker gap), `requires_oauth`, `requires_approval` (the platform's own app-review requirement, not Promoter's Approval Center), and `api_version`. As of Phase 6, every platform's `CONNECT_ACCOUNT`/`READ_ANALYTICS`/`CREATE_CAMPAIGN`/`CREATE_AD`/`UPDATE_BUDGET`/`PAUSE_CAMPAIGN` capability is enabled, each with a `notes` value naming its specific remaining gap where one exists (see above). `PUBLISH_CONTENT` (organic posting, as opposed to ads) stays disabled for all three — every phase so far only covers each platform's ads/marketing API.

## OAuth token handling

- **Authorize:** `GET /api/connections/{meta,tiktok,x}/authorize` — owner-only (checked in the shared handler, and independently enforced by RLS on `prompter_connected_accounts`), generates a random `state`, stores `state:tenantId` in a short-lived httpOnly cookie (a distinct cookie name per platform — `lib/connectors/{meta,tiktok,x}-oauth-state.ts`), redirects to that platform's OAuth dialog. All three routes are two-line wrappers around the shared `lib/connectors/oauth-authorize.ts#handleConnectorOauthAuthorize()`.
- **Callback:** `GET /api/connections/{meta,tiktok,x}/callback` — validates `state` against the cookie, exchanges the code for a token, fetches the tenant's ad accounts, and writes through the **service-role client only** (`lib/supabase/admin.ts`):
  - `prompter_connected_accounts` — metadata only (external account id/name, status, scopes, `expires_at`).
  - `prompter_oauth_credentials` — the token, encrypted via `lib/crypto/token-cipher.ts` (AES-256-GCM, key from `TOKEN_ENCRYPTION_KEY`) before it's written. This table has RLS enabled with **zero policies** for `anon`/`authenticated` — only the service-role key can ever read or write it, so a token can't reach the browser through any ordinary query path, not just by app-layer discipline.
  
  All three routes wrap the shared `lib/connectors/oauth-callback.ts#handleConnectorOauthCallback()` — extracted in Phase 6 once three platforms needed the identical flow; nothing platform-specific lives in the callback route itself, only behind each connector's own `PlatformConnector` implementation.
- **Disconnect:** `features/connections/actions.ts#disconnectAction()` — owner-only, attempts remote token revocation on a best-effort basis (Meta's `DELETE /me/permissions`, TikTok's `/oauth2/revoke/`, X's `/2/oauth2/revoke`), then always deletes the local rows regardless of whether that remote call succeeded, so this app never keeps showing `CONNECTED` for a connection the user asked to remove.
- Metadata (`expires_at`, `refreshable`, `scopes`, `status`, `last_refreshed_at`) is what the Connection Center displays — never the token itself, in any form.

## Campaign launch

`features/campaigns/launch-actions.ts#launchChannelCampaignAction()` — the one code path in this app allowed to set a `prompter_channel_campaigns.status` to `ACTIVE`, and only after the target platform's own API has confirmed each object (campaign → ad set → creative → ad) was actually created. Entirely platform-agnostic: which connector runs is resolved once via `getConnector(connectorPlatform)` from the campaign's channel (`FACEBOOK`/`INSTAGRAM` → `META`, `TIKTOK` → `TIKTOK`, `X` → `X`), and a per-platform `OBJECTIVE_MAP` translates Promoter's `PrimaryGoal` into each platform's own objective vocabulary (Meta's `OUTCOME_*`, TikTok's `objective_type` values, X's `objective` values) rather than assuming one platform's names apply everywhere. Preconditions, all checked before any API call: the master campaign is `SCHEDULED` (i.e., already through Budget Guard + Approval Center) and the tenant has a `CONNECTED` account for that platform. A failure at any step — including each connector's own documented incomplete step above — is stored on the channel campaign's `error` column and surfaces in the UI, never silently swallowed or reported as success.

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

## Payment provider architecture (Final Blocker Resolution pass)

Same discipline as the ad-platform connectors: one vendor-neutral interface (`lib/billing/payment-provider.ts#PaymentProvider`), resolved through a single choke point (`lib/billing/get-payment-provider.ts#getPaymentProvider()`) so nothing else in the app ever picks a processor itself.

```ts
interface PaymentProvider {
  readonly name: string;
  isConfigured(): boolean;
  createCheckoutSession(input): Promise<CheckoutSessionResult>;
  getSubscriptionStatus(externalSubscriptionId): Promise<RemoteSubscriptionStatus>;
  cancelSubscription(externalSubscriptionId): Promise<void>;
  verifyWebhookSignature(rawBody, signatureHeader): boolean;
}
```

Today `getPaymentProvider()` always returns `NullPaymentProvider` — every method throws `PaymentProviderConfigError` (or, for `verifyWebhookSignature`, returns `false`) rather than simulating a checkout, a subscription status, or a passing signature check. No real adapter (Stripe/Midtrans/Xendit/...) exists yet; one plugs in behind this same interface once a processor is chosen, driven by `PAYMENT_PROVIDER_NAME`/`PAYMENT_PROVIDER_API_KEY`/`PAYMENT_PROVIDER_WEBHOOK_SECRET` (all blank today — see `.env.example`).

Supporting schema (`prompter_subscriptions`, `prompter_invoices`) and the `/billing` page already exist and read/write real data — see [ROADMAP.md](ROADMAP.md) "Billing foundation" and "Payment provider abstraction". Absence of a configured processor does not block any other part of the app: `/billing` renders an honest "not configured" state, and plan changes still work as a pure governance/usage-gating change (no proration, no charge) until a real processor exists to actually bill one.

## Background job architecture (Final Blocker Resolution pass)

Provider-neutral, same discipline as everything else above: business logic depends only on `lib/jobs/job-queue.ts#JobQueueProvider`, never on how jobs are actually claimed/run.

```ts
interface JobQueueProvider {
  readonly name: string;
  enqueue(input): Promise<{ jobId, alreadyExisted }>;
  claimNext(jobTypes?): Promise<Job | null>;
  complete(jobId, result?): Promise<void>;
  fail(jobId, errorMessage): Promise<void>;   // backoff-delayed retry, or terminal FAILED past max_attempts
  cancel(jobId): Promise<{ canceled }>;       // PENDING only — never interrupts a RUNNING job
}
```

Today's only implementation, `lib/jobs/providers/supabase-job-queue.ts#SupabaseJobQueue`, is a DB-backed "local/development" queue: `prompter_jobs` + `prompter_claim_next_job()` (an atomic `for update skip locked` claim, `SECURITY DEFINER`, revoked from `anon`/`authenticated`, granted only to `service_role` — verified live end-to-end: enqueue → claim → double-claim returns null → idempotent re-insert raises the expected unique-violation → complete, then cleaned up). A real external provider (SQS, Cloud Tasks, a Redis-backed queue, ...) could implement the same interface later with zero caller changes.

`app/api/internal/jobs/process/route.ts` claims and runs due jobs — gated by a bearer secret (`JOBS_PROCESSOR_SECRET`, unset in every environment this app has run in, so the route always responds `NOT_CONFIGURED`) and, separately, by there being no external scheduler configured to call it at all. Its `JOB_HANDLERS` registry starts **empty on purpose** — a job of a type with no registered handler fails immediately with a clear "no handler registered" error rather than the route guessing what to do with it. This is also the "no uncontrolled AI loops" boundary: an `AI_GENERATION` job can only ever run through whatever governed pipeline (Budget Guard, Approval Center, `runAiJob()`) its future handler is written to call — the queue itself never grants an AI call new authority.

**No existing feature is rewired to enqueue into this queue in this pass.** Campaign submission/launch, AI generation, metrics sync, etc. all still run exactly as documented in their own phase sections above — synchronously, through their already-verified Budget-Guard/Approval-Center-gated pipelines. Adopting the queue for a genuinely async/retryable need (e.g. a failed metrics sync retry) is a deliberate, scoped follow-up, not bundled into this pass, specifically to avoid destabilizing those already-verified flows. In practice this means `prompter_jobs` is empty and the processor route is a no-op in every environment this app has run in — the architecture exists and is verified correct; production autonomous execution is a separate, still-`NOT_CONFIGURED` decision (external scheduler + a chosen job type's handler).

## Current state (Phase 7)

Meta, TikTok, and X connectors and OAuth flows are all implemented and structurally complete but unverified against a live ad account on any of the three (see above) — `/connections` renders real Connect/Disconnect flows for all three, gated by each connector's own `isConfigured()`. UMKMpro AI integration is implemented and its signed-authentication layer was verified against a real running local server (see [ROADMAP.md](ROADMAP.md) Phase 4 for what was and wasn't exercisable in this environment). As of Phase 7, `getInsights`, `pauseCampaign`, and `updateBudget` are wired to real UI-triggered actions (metrics sync, and Owner-approved autopilot execution) for the first time — see [ROADMAP.md](ROADMAP.md) Phase 7 and [SECURITY.md](SECURITY.md) "Automation safety" for the approval/Budget Guard/Emergency Stop boundaries around when `pauseCampaign`/`updateBudget` are actually allowed to run.
