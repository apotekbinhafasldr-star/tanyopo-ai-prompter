/**
 * PostHog telemetry configuration (server-side only).
 *
 * OFF by default. Telemetry is enabled only when ALL of the following are set
 * and valid; anything missing or malformed yields `{ enabled: false }`, which
 * makes every emit a no-op with no network request and no SDK load.
 *
 *   POSTHOG_TELEMETRY_ENABLED = "true"   (kill switch; any other value = OFF)
 *   POSTHOG_API_KEY           = project token (phc_...)
 *   POSTHOG_ID_SALT           = >= 32 chars, LINOE-specific, server-only
 *
 * Optional: POSTHOG_HOST (allowlisted), POSTHOG_ENV, and the Netlify-provided
 * CONTEXT / COMMIT_REF. None of these is ever NEXT_PUBLIC_*.
 */

export const ALLOWED_POSTHOG_HOSTS = ["https://us.i.posthog.com", "https://eu.i.posthog.com"] as const;
export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
export const MIN_SALT_LENGTH = 32;

export type TelemetryEnvName = "production" | "preview";

export type TelemetryConfig =
  | { enabled: false }
  | {
      enabled: true;
      apiKey: string;
      host: string;
      salt: string;
      env: TelemetryEnvName;
      appVersion: string;
    };

const API_KEY_PATTERN = /^phc_[A-Za-z0-9]{20,100}$/;
const APP_VERSION_PATTERN = /^[A-Za-z0-9._-]{1,40}$/;

type EnvLike = Record<string, string | undefined>;

function resolveEnvName(env: EnvLike): TelemetryEnvName {
  const explicit = env.POSTHOG_ENV;
  if (explicit === "production" || explicit === "preview") return explicit;
  // Unknown context is treated as "preview" so test data never counts as production.
  return env.CONTEXT === "production" ? "production" : "preview";
}

function resolveAppVersion(env: EnvLike): string {
  const ref = (env.COMMIT_REF ?? "").slice(0, 7);
  return APP_VERSION_PATTERN.test(ref) ? ref : "unknown";
}

export function readTelemetryConfig(env: EnvLike = process.env): TelemetryConfig {
  if (env.POSTHOG_TELEMETRY_ENABLED !== "true") return { enabled: false };

  const apiKey = env.POSTHOG_API_KEY ?? "";
  if (!API_KEY_PATTERN.test(apiKey)) return { enabled: false };

  const salt = env.POSTHOG_ID_SALT ?? "";
  if (salt.length < MIN_SALT_LENGTH) return { enabled: false };

  const host = env.POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST;
  if (!(ALLOWED_POSTHOG_HOSTS as readonly string[]).includes(host)) return { enabled: false };

  return { enabled: true, apiKey, host, salt, env: resolveEnvName(env), appVersion: resolveAppVersion(env) };
}
