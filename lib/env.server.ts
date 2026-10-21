import "server-only";

/**
 * Server-only environment access (moved verbatim from lib/env.ts; no variable name, value or
 * behaviour changed). Secrets (service-role key, AI provider keys, ad-platform app secrets,
 * payment and service tokens) are read lazily and never imported into client bundles: the
 * `server-only` import above makes any Client Component import of this module a build error.
 *
 * Anything a connector needs that is missing resolves to `NOT_CONFIGURED` rather than throwing
 * at import time, so the app can boot in development without every third-party credential.
 * Browser-safe values (`publicEnv`, `isConnectorConfigured`) stay in lib/env.ts.
 */

function readOptional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

/** Server-only configuration. `server-only` (above) rejects any Client Component import. */
export const serverEnv = {
  supabaseSecretKey: readOptional("SUPABASE_SECRET_KEY"),
  tokenEncryptionKey: readOptional("TOKEN_ENCRYPTION_KEY"),
  ai: {
    openaiApiKey: readOptional("OPENAI_API_KEY"),
    anthropicApiKey: readOptional("ANTHROPIC_API_KEY"),
    // Which provider serves a task class that has no AI_<CLASS>_PROVIDER
    // override. Left undefined when unset — lib/ai/router.ts then falls
    // back to whichever of the two keys above is actually present, so a
    // single-provider setup works with zero routing config.
    defaultProvider: readOptional("AI_DEFAULT_PROVIDER"),
    // Tried when the resolved primary provider's live call fails. Unset =
    // no fallback, a failure is just a failure (never silently faked).
    fallbackProvider: readOptional("AI_FALLBACK_PROVIDER"),
    // OpenAI has no hardcoded default model in this codebase (see
    // lib/ai/openai-provider.ts) — this is the one place a bare
    // `AI_DEFAULT_PROVIDER=openai` setup can supply a model without also
    // setting all four AI_<CLASS>_MODEL overrides below.
    openaiDefaultModel: readOptional("AI_OPENAI_DEFAULT_MODEL"),
    fast: { provider: readOptional("AI_FAST_PROVIDER"), model: readOptional("AI_FAST_MODEL") },
    standard: { provider: readOptional("AI_STANDARD_PROVIDER"), model: readOptional("AI_STANDARD_MODEL") },
    strategy: { provider: readOptional("AI_STRATEGY_PROVIDER"), model: readOptional("AI_STRATEGY_MODEL") },
    critical: { provider: readOptional("AI_CRITICAL_PROVIDER"), model: readOptional("AI_CRITICAL_MODEL") },
  },
  meta: {
    appId: readOptional("META_APP_ID"),
    appSecret: readOptional("META_APP_SECRET"),
    redirectUri: readOptional("META_REDIRECT_URI"),
    // Facebook Login for Business "Configuration ID". Optional and NOT a
    // secret (it appears in the login dialog URL), but it is still read
    // server-side only: it is per-Meta-app / per-environment configuration,
    // never hardcoded in the codebase and never a NEXT_PUBLIC_* value.
    // Unset = the classic `scope`-based dialog is used (previous behaviour).
    loginConfigId: readOptional("META_LOGIN_CONFIG_ID"),
  },
  tiktok: {
    appId: readOptional("TIKTOK_APP_ID"),
    appSecret: readOptional("TIKTOK_APP_SECRET"),
    redirectUri: readOptional("TIKTOK_REDIRECT_URI"),
  },
  x: {
    clientId: readOptional("X_CLIENT_ID"),
    clientSecret: readOptional("X_CLIENT_SECRET"),
    redirectUri: readOptional("X_REDIRECT_URI"),
  },
  umkmpro: {
    serviceToken: readOptional("UMKMPRO_SERVICE_TOKEN"),
  },
  // No specific processor is wired in yet (lib/billing/get-payment-provider.ts
  // always returns NullPaymentProvider today) — these are generic,
  // provider-neutral names a future adapter reads, not any one vendor's
  // own env var convention. All three unset (the only state today) means
  // billing_provider/success_fee_rate_bps stay NOT_CONFIGURED.
  payment: {
    providerName: readOptional("PAYMENT_PROVIDER_NAME"),
    apiKey: readOptional("PAYMENT_PROVIDER_API_KEY"),
    webhookSecret: readOptional("PAYMENT_PROVIDER_WEBHOOK_SECRET"),
  },
  jobs: {
    // Bearer secret app/api/internal/jobs/process/route.ts requires.
    // Unset = the endpoint always responds NOT_CONFIGURED, regardless of
    // what calls it — there is no external scheduler wired to call it in
    // this environment either, so production queue execution stays
    // NOT_CONFIGURED end-to-end until both exist.
    processorSecret: readOptional("JOBS_PROCESSOR_SECRET"),
  },
  // LINOE Demo Account & Safe Trial Environment (Phase 1). Signs the
  // isolated per-session demo token (lib/demo/session.ts) — never the
  // Supabase secret key or any other credential reused across purposes.
  // Unset = every demo entry point responds NOT_CONFIGURED rather than
  // falling back to a guessable/shared default secret (lib/demo/is-demo-request.ts).
  demo: {
    sessionSecret: readOptional("DEMO_SESSION_SECRET"),
  },
};
