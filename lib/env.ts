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
  aiProviderApiKey: readOptional("AI_PROVIDER_API_KEY"),
  aiProviderName: process.env.AI_PROVIDER_NAME ?? "not_configured",
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
};

/** True when every credential a connector needs to operate is present. */
export function isConnectorConfigured(
  credentials: Record<string, string | undefined>,
): boolean {
  return Object.values(credentials).every((v) => !!v && v.length > 0);
}
