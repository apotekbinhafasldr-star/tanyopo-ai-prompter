/**
 * Trial anti-abuse configuration. Pure and read at CALL time (never at import) so it is unit-testable
 * and so an unset environment can never crash boot.
 *
 *   TRIAL_ABUSE_MODE        off (default) | shadow | enforce
 *   TRIAL_ABUSE_HMAC_SECRET base64 of >= 32 random bytes; a DEDICATED secret, never reused
 *   TRIAL_ABUSE_KEY_VERSION integer 1..100 (default 1); bump when the secret is rotated
 *
 * off     : nothing is collected, nothing is stored; behaviour is exactly the pre-existing signup flow.
 * shadow  : signals are collected and the gate runs and records, but the result NEVER blocks anybody
 *           and any failure is swallowed (fail-open). Used to measure false positives before enforcing.
 * enforce : the gate decides. Every failure (missing secret, database error) FAILS CLOSED.
 * An unrecognised non-empty mode is reported as "invalid" and treated as fail-closed by the caller:
 * a typo must never silently disable a security control.
 */
export type TrialAbuseMode = "off" | "shadow" | "enforce" | "invalid";

export interface TrialAbuseConfig {
  mode: TrialAbuseMode;
  /** Raw secret bytes; null when unset or too short. */
  secret: Buffer | null;
  keyVersion: number;
}

export const MIN_SECRET_BYTES = 32;

export function readTrialAbuseConfig(env: Record<string, string | undefined> = process.env): TrialAbuseConfig {
  const rawMode = (env.TRIAL_ABUSE_MODE ?? "").trim().toLowerCase();
  const mode: TrialAbuseMode =
    rawMode === "" || rawMode === "off" ? "off" : rawMode === "shadow" || rawMode === "enforce" ? rawMode : "invalid";

  let secret: Buffer | null = null;
  const rawSecret = (env.TRIAL_ABUSE_HMAC_SECRET ?? "").trim();
  if (rawSecret) {
    const bytes = Buffer.from(rawSecret, "base64");
    if (bytes.length >= MIN_SECRET_BYTES) secret = bytes;
  }

  const kv = Number.parseInt(env.TRIAL_ABUSE_KEY_VERSION ?? "1", 10);
  const keyVersion = Number.isInteger(kv) && kv >= 1 && kv <= 100 ? kv : 1;

  return { mode, secret, keyVersion };
}

/** True when the browser should gather signals and the privacy notice must describe them. */
export function isCollectionEnabled(config: TrialAbuseConfig = readTrialAbuseConfig()): boolean {
  return config.mode === "shadow" || config.mode === "enforce";
}
