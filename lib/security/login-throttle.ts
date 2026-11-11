import { peekRateLimit, checkRateLimit, resetRateLimit } from "@/lib/rate-limit";
import { getTrustedClientIp, ipBucketKey } from "@/lib/security/client-ip";

/**
 * Login throttle plus the shared "trusted IP bucket" helper for the unauthenticated auth actions
 * (docs/SECURITY_AUDIT_2026-11-11.md, SEC-01 and SEC-02). Wired into loginAction (features/auth/actions.ts), which calls
 * `checkLoginThrottle` after schema validation and BEFORE `signInWithPassword`.
 *
 * Design (what it is built to prevent):
 *  - It counts FAILED sign-ins only, in two buckets: (a) client IP + email, (b) client IP alone. There is deliberately
 *    NO email-only bucket: an attacker could burn it from anywhere and lock a victim out of their own account.
 *    Counting by IP+email means an attacker only ever blocks their own address (and anyone behind the same NAT).
 *  - A blocked attempt and a successful sign-in never add to the counters, so the window is never extended by the
 *    victim retrying. A successful sign-in clears the IP+email bucket (the IP-only bucket is left alone so one valid
 *    account cannot be used to keep resetting the guess budget against other accounts).
 *  - The IP comes only from getTrustedClientIp (lib/security/client-ip.ts), never from `x-forwarded-for`. When there is
 *    no trustworthy IP, every such request shares ONE bucket (stricter than "everyone", looser than one IP). A forged
 *    header therefore cannot create fresh buckets, and cannot exhaust a real user's bucket either.
 *  - The answer is one generic message for both reasons (LOGIN_THROTTLED_MESSAGE): not an account-enumeration oracle.
 *  - Fail-safe: if the limiter itself throws, login is NOT blocked (the throttle is a brake, not a gate; Supabase
 *    Auth's own per-IP limit still applies underneath).
 *
 * Honest limits: state is in process memory (lib/rate-limit.ts), per serverless instance, reset on deploy/cold start,
 * not shared across instances. It slows a naive guessing loop; it is not a distributed guarantee. Mobile carrier NAT
 * (many people behind one IPv4) can make one noisy user block neighbours for up to LOGIN_WINDOW_MS; the IPv6 key is the
 * /64 prefix.
 */
export const LOGIN_PAIR_LIMIT = 5;
export const LOGIN_IP_LIMIT = 30;
/** Shared bucket for requests with no trustworthy IP. */
export const LOGIN_UNIDENTIFIED_LIMIT = 60;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export const LOGIN_THROTTLED_MESSAGE = "Terlalu banyak percobaan masuk. Silakan coba lagi dalam beberapa menit.";

export type LoginThrottleResult = { allowed: true } | { allowed: false; reason: "IP" | "PAIR"; retryAt: number };

/** Bucket identity of a caller: a normalized IP key, or the single shared key when no trustworthy IP exists. */
export interface AuthClientBucket {
  key: string;
  identified: boolean;
}

export const UNIDENTIFIED_BUCKET_KEY = "unidentified";

/** Resolves the limiter identity of a request from its headers. Never reads `x-forwarded-for`. */
export function getAuthClientBucket(headers: { get(name: string): string | null }): AuthClientBucket {
  const ip = getTrustedClientIp(headers);
  return ip ? { key: ipBucketKey(ip), identified: true } : { key: UNIDENTIFIED_BUCKET_KEY, identified: false };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase().slice(0, 254);
}

function keysFor(bucket: AuthClientBucket, email: string) {
  return {
    ipKey: `login-ip:${bucket.key}`,
    ipLimit: bucket.identified ? LOGIN_IP_LIMIT : LOGIN_UNIDENTIFIED_LIMIT,
    pairKey: `login-pair:${bucket.key}:${normalizeEmail(email)}`,
  };
}

/** Read-only check (counts nothing). Call before signInWithPassword. Fails open if the limiter throws. */
export function checkLoginThrottle(bucket: AuthClientBucket, email: string, now: number = Date.now()): LoginThrottleResult {
  try {
    const { ipKey, ipLimit, pairKey } = keysFor(bucket, email);
    const byIp = peekRateLimit(ipKey, ipLimit, LOGIN_WINDOW_MS, now);
    if (!byIp.allowed) return { allowed: false, reason: "IP", retryAt: byIp.resetAt };
    const byPair = peekRateLimit(pairKey, LOGIN_PAIR_LIMIT, LOGIN_WINDOW_MS, now);
    if (!byPair.allowed) return { allowed: false, reason: "PAIR", retryAt: byPair.resetAt };
    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}

/** Counts one failed sign-in against both buckets. Never throws. */
export function recordLoginFailure(bucket: AuthClientBucket, email: string, now: number = Date.now()): void {
  try {
    const { ipKey, ipLimit, pairKey } = keysFor(bucket, email);
    checkRateLimit(ipKey, ipLimit, LOGIN_WINDOW_MS, now);
    checkRateLimit(pairKey, LOGIN_PAIR_LIMIT, LOGIN_WINDOW_MS, now);
  } catch {
    /* fail-safe: a broken limiter must not break login */
  }
}

/** Clears the IP+email bucket after a successful sign-in. The IP-only bucket is intentionally kept. Never throws. */
export function resetLoginThrottle(bucket: AuthClientBucket, email: string): void {
  try {
    resetRateLimit(keysFor(bucket, email).pairKey);
  } catch {
    /* fail-safe */
  }
}
