import { checkRateLimit } from "@/lib/rate-limit";
import { ipBucketKey } from "@/lib/security/client-ip";

/**
 * Guards for GET /api/demo/start (docs/SOFT_LAUNCH_10_TENANTS.md, "Audit sesi demo"). Pure and unit-tested.
 *
 * Everything here is an in-memory brake (lib/rate-limit.ts: per serverless instance, reset on deploy). It is NOT the
 * cost control. The controls that hold across instances are the DB-backed per-session AI hard cap
 * (lib/demo/ai-usage.ts) and the spend limit set at the AI provider (Founder action G5).
 */

/** New demo sessions per identified IP per window. */
export const DEMO_START_IP_LIMIT = 10;
/** Shared bucket for requests without a trustworthy IP header; stricter than "everyone", looser than one IP. */
export const DEMO_START_UNIDENTIFIED_LIMIT = 60;
/** All new sessions per instance per window, whatever the IP. Bounds cost even against a many-IP attacker. */
export const DEMO_START_GLOBAL_LIMIT = 300;
export const DEMO_START_WINDOW_MS = 60 * 60 * 1000;

export type DemoStartLimit = { allowed: true } | { allowed: false; scope: "IP" | "UNIDENTIFIED" | "GLOBAL"; retryAt: number };

export function checkDemoStartLimit(ip: string | null, now: number = Date.now()): DemoStartLimit {
  const perClient = ip
    ? checkRateLimit(`demo-start:ip:${ipBucketKey(ip)}`, DEMO_START_IP_LIMIT, DEMO_START_WINDOW_MS, now)
    : checkRateLimit("demo-start:unidentified", DEMO_START_UNIDENTIFIED_LIMIT, DEMO_START_WINDOW_MS, now);
  if (!perClient.allowed) {
    return { allowed: false, scope: ip ? "IP" : "UNIDENTIFIED", retryAt: perClient.resetAt };
  }

  const global = checkRateLimit("demo-start:global", DEMO_START_GLOBAL_LIMIT, DEMO_START_WINDOW_MS, now);
  if (!global.allowed) return { allowed: false, scope: "GLOBAL", retryAt: global.resetAt };

  return { allowed: true };
}

const BOT_USER_AGENT = /bot\/|crawler|spider|slurp|facebookexternalhit|whatsapp\/|headlesschrome|lighthouse/i;

/**
 * True for requests that must never mint a session or spend quota: link prefetch (Next <Link>, browser speculation),
 * sub-resource loads (an <img>/<script>/<iframe> on a third-party page forcing a visitor to burn their IP quota) and
 * known crawlers/link-preview fetchers. Real browser navigations send `sec-fetch-mode: navigate` and
 * `sec-fetch-dest: document`; clients that send no Sec-Fetch-* headers at all (older browsers, curl) are still allowed,
 * because they are subject to the IP limits anyway.
 */
export function isNonNavigationRequest(headers: { get(name: string): string | null }): boolean {
  if (headers.get("next-router-prefetch") || headers.get("rsc")) return true;
  if (/prefetch/i.test(headers.get("purpose") ?? "") || /prefetch/i.test(headers.get("sec-purpose") ?? "")) return true;
  if (/prefetch/i.test(headers.get("x-moz") ?? "")) return true;

  const mode = headers.get("sec-fetch-mode");
  if (mode && mode !== "navigate") return true;
  const dest = headers.get("sec-fetch-dest");
  if (dest && dest !== "document") return true;

  return BOT_USER_AGENT.test(headers.get("user-agent") ?? "");
}
