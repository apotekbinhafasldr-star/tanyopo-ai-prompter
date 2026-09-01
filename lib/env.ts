/**
 * Centralized environment access.
 *
 * Server-only secrets (service key, AI provider keys, ad-platform app secrets)
 * are read lazily and never imported into client bundles. Anything a
 * connector needs that is missing resolves to `NOT_CONFIGURED` rather than
 * throwing at import time, so the app can boot in development without every
 * third-party credential present.
 */

function readPublic(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required public environment variable: ${name}. Check .env.example and your .env.local.`,
    );
  }
  return value;
}

function readOptional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export const publicEnv = {
  supabaseUrl: readPublic("NEXT_PUBLIC_SUPABASE_URL"),
  supabasePublishableKey: readPublic("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
};

/** Server-only. Never import this module from a Client Component. */
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
};

/** True when every credential a connector needs to operate is present. */
export function isConnectorConfigured(
  credentials: Record<string, string | undefined>,
): boolean {
  return Object.values(credentials).every((v) => !!v && v.length > 0);
}
