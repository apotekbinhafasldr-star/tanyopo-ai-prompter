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

/**
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
