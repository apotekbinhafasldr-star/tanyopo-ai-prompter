/**
 * Best-effort, in-memory fixed-window rate limiter (product spec §72).
 *
 * Honest limitation, documented rather than hidden: state lives in a
 * process-local Map, so it resets on every deploy/restart and is not
 * shared across serverless instances. That's a real gap for a
 * high-traffic multi-instance deployment, but it's still a genuine limit
 * — not a fake one — and is the correct scope for this app today (no
 * existing shared-cache infra like Redis to lean on). Revisit if/when one
 * exists.
 */

interface WindowState {
  count: number;
  windowStart: number;
  windowMs: number;
}

/** Above this many keys, expired windows are swept so attacker-chosen keys (e.g. random emails) cannot grow memory forever. */
const SWEEP_THRESHOLD = 5_000;

const buckets = new Map<string, WindowState>();

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const existing = buckets.get(key);

  if (!existing || now - existing.windowStart >= windowMs) {
    if (buckets.size >= SWEEP_THRESHOLD) sweepExpired(now);
    buckets.set(key, { count: 1, windowStart: now, windowMs });
    return { allowed: true, limit, remaining: limit - 1, resetAt: now + windowMs };
  }

  if (existing.count >= limit) {
    return { allowed: false, limit, remaining: 0, resetAt: existing.windowStart + windowMs };
  }

  existing.count += 1;
  return {
    allowed: true,
    limit,
    remaining: limit - existing.count,
    resetAt: existing.windowStart + windowMs,
  };
}

function sweepExpired(now: number): void {
  for (const [key, state] of buckets) {
    if (now - state.windowStart >= state.windowMs) buckets.delete(key);
  }
}

/**
 * Reads a bucket WITHOUT counting a hit. `allowed` is false only when the bucket is already at `limit` inside its
 * window. Used where only failures should count (login), so a blocked or successful attempt never extends a window.
 */
export function peekRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const existing = buckets.get(key);
  if (!existing || now - existing.windowStart >= windowMs) {
    return { allowed: true, limit, remaining: limit, resetAt: now + windowMs };
  }
  const remaining = Math.max(0, limit - existing.count);
  return { allowed: remaining > 0, limit, remaining, resetAt: existing.windowStart + windowMs };
}

/** Forgets one bucket (e.g. after a successful login). */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/** Test-only: clears all bucket state so unit tests don't leak between cases. */
export function __resetRateLimitStateForTests(): void {
  buckets.clear();
}

/**
 * @deprecated NOT SAFE for abuse limiters (SEC-01): it falls back to the first hop of a client-controllable
 * `x-forwarded-for`, so rotating that header yields a fresh bucket per request, and a victim's address can be put in it
 * to exhaust the victim's bucket. Auth actions now use `getTrustedClientIp` + `ipBucketKey`
 * (lib/security/client-ip.ts) with a shared bucket when the IP is unknown. Kept only for backward compatibility; do
 * not add new callers.
 *
 * Original description:
 * Best-effort client IP for rate-limiting a Server Action, which has no
 * direct Request object to read a socket address from. Prefers Netlify's
 * edge-set `x-nf-client-connection-ip` (set by Netlify's infrastructure
 * from the real TCP connection, not editable by the client) over
 * `x-forwarded-for` (whose first hop can be client-supplied depending on
 * proxy configuration), and never throws — an unresolvable IP shares one
 * "unknown" bucket rather than skipping the rate limit entirely.
 */
export function getClientIp(headersList: { get(name: string): string | null }): string {
  const nfIp = headersList.get("x-nf-client-connection-ip");
  if (nfIp) return nfIp.trim();

  const forwardedFor = headersList.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }

  return "unknown";
}
