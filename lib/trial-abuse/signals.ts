/**
 * Minimal, non-invasive browser signals for repeat-trial detection.
 *
 * Deliberately NOT collected: canvas / WebGL / audio fingerprints, installed fonts, plugin lists, battery,
 * media devices, precise geolocation, any biometric or cross-site identifier. Only coarse values a site
 * already receives or can read without any permission prompt:
 *   tz (IANA time zone), lang (primary language), sw/sh (screen size rounded to 100px), dpr (rounded),
 *   hc (CPU cores, clamped), pf (coarse OS family taken from the User-Agent on the server).
 * These signals are WEAK on purpose (many people share them); they only ever add a small score and can
 * never cause a denial on their own (see fn_trial_signup_gate).
 */
export interface DeviceSignals {
  tz: string;
  lang: string;
  sw: number;
  sh: number;
  dpr: number;
  hc: number;
}

const TZ = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+){0,2}$/;
const LANG = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;

function clampInt(v: unknown, min: number, max: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.min(max, Math.max(min, Math.round(v)));
}

/** Parses the untrusted hidden-field payload. Anything malformed yields null (= "no device signals"). */
export function parseDeviceSignals(raw: unknown): DeviceSignals | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.tz !== "string" || !TZ.test(o.tz) || o.tz.length > 64) return null;
  if (typeof o.lang !== "string" || !LANG.test(o.lang)) return null;
  const sw = clampInt(o.sw, 200, 10000);
  const sh = clampInt(o.sh, 200, 10000);
  const dpr = clampInt(typeof o.dpr === "number" ? o.dpr * 10 : null, 5, 80);
  const hc = clampInt(o.hc, 1, 32);
  if (sw === null || sh === null || dpr === null || hc === null) return null;
  return { tz: o.tz, lang: o.lang.toLowerCase(), sw: Math.round(sw / 100) * 100, sh: Math.round(sh / 100) * 100, dpr: dpr / 10, hc };
}

/** Coarse OS family from the User-Agent; never stores or hashes the full UA string. */
export function platformFamily(userAgent: string | null): string {
  const ua = (userAgent ?? "").toLowerCase();
  if (ua.includes("android")) return "android";
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ios")) return "ios";
  if (ua.includes("windows")) return "windows";
  if (ua.includes("mac os") || ua.includes("macintosh")) return "mac";
  if (ua.includes("linux")) return "linux";
  return "other";
}

/** Stable canonical string fed to the HMAC (fixed key order, fixed formatting). */
export function canonicalSignals(s: DeviceSignals, platform: string): string {
  return [`tz=${s.tz}`, `lang=${s.lang}`, `sw=${s.sw}`, `sh=${s.sh}`, `dpr=${s.dpr}`, `hc=${s.hc}`, `pf=${platform}`].join("|");
}
