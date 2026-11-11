/**
 * Back-off policy for Meta Graph / Marketing API throttling, as PURE data and
 * functions (no network, timers, environment or "server-only" import) so it is
 * directly unit-testable. `lib/connectors/meta-connector.ts` owns the loop.
 *
 * Source (Marketing API "Rate Limiting", developers.facebook.com, accessed
 * 2026-11-11): error code 4 = app-level limit, 17 = ad-account/user limit,
 * 613 = several subcodes, 80000/80003/80004/80014 = Business Use Case limits;
 * "Implement exponential backoff when receiving throttling errors". Code 32
 * is the classic page-level throttle and was NOT covered by that page
 * (unverified), it is included because it is a throttle code in the Graph API
 * error reference family; remove it if Meta's docs say otherwise.
 *
 * Rules:
 *  - Only a response that Meta actually returned is judged: an HTTP 429, or an
 *    error body whose `code` is a throttle code. A timeout or an unreadable
 *    body has no status/code and is never retried here.
 *  - Subcodes that Meta documents as long blocks are NOT retried in-process:
 *    1487632 (ad set budget changes, blocked for an hour), 1885172 (spending
 *    limit changes, 10 per day), 4841018 (concurrent edits, wait >= 30 s) and
 *    1487225 (ad creation tied to the daily spend limit). Code 613 with no
 *    subcode is "abuse prevention": contact Meta, never hammer it.
 *  - Delay doubles per attempt from 1 s and is capped; a `Retry-After` longer
 *    than the cap means "do not wait inside a request": no retry.
 *
 * The connector applies this ONLY to non-create calls (read, pause, budget):
 * the four CREATE calls keep their "no automatic retry" rule (launch
 * reconciliation depends on it, and Meta offers no idempotency key there).
 */

export const META_THROTTLE_CODES: ReadonlySet<number> = new Set([4, 17, 32, 613, 80000, 80003, 80004, 80014]);
export const META_NON_RETRYABLE_SUBCODES: ReadonlySet<number> = new Set([1487632, 1885172, 4841018, 1487225]);

export const META_RETRY_BASE_DELAY_MS = 1_000;
export const META_RETRY_MAX_DELAY_MS = 5_000;
/** Retries (not attempts) for non-create calls. Worst case adds 1 s + 2 s of waiting. */
export const META_READ_MAX_RETRIES = 2;

export interface MetaThrottleShape {
  status?: unknown;
  code?: unknown;
  subcode?: unknown;
  retryAfterSeconds?: unknown;
}

function toInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^\d{1,10}$/.test(value)) return Number(value);
  return undefined;
}

export function isMetaThrottleError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const shape = error as MetaThrottleShape;
  const subcode = toInt(shape.subcode);
  if (subcode !== undefined && META_NON_RETRYABLE_SUBCODES.has(subcode)) return false;

  if (shape.status === 429) return true;
  const code = toInt(shape.code);
  if (code === undefined || !META_THROTTLE_CODES.has(code)) return false;
  // 613 without a subcode is Meta's abuse-prevention response.
  if (code === 613 && subcode === undefined) return false;
  return true;
}

export type MetaRetryDecision = { retry: false } | { retry: true; delayMs: number };

/** `attempt` is 0 for the first failure. */
export function decideMetaRetry(error: unknown, attempt: number, maxRetries: number): MetaRetryDecision {
  if (!Number.isInteger(attempt) || attempt < 0 || !Number.isInteger(maxRetries) || attempt >= maxRetries) {
    return { retry: false };
  }
  if (!isMetaThrottleError(error)) return { retry: false };

  const backoff = Math.min(META_RETRY_BASE_DELAY_MS * 2 ** attempt, META_RETRY_MAX_DELAY_MS);
  const retryAfter = (error as MetaThrottleShape).retryAfterSeconds;
  if (typeof retryAfter === "number" && Number.isFinite(retryAfter) && retryAfter > 0) {
    const requested = retryAfter * 1000;
    if (requested > META_RETRY_MAX_DELAY_MS) return { retry: false };
    return { retry: true, delayMs: Math.max(backoff, requested) };
  }
  return { retry: true, delayMs: backoff };
}
