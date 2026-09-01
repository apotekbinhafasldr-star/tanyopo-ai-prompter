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
}

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
    buckets.set(key, { count: 1, windowStart: now });
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

/** Test-only: clears all bucket state so unit tests don't leak between cases. */
export function __resetRateLimitStateForTests(): void {
  buckets.clear();
}
