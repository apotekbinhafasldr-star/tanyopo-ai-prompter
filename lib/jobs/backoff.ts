/**
 * Exponential backoff for a failed job's next retry. Pure function, no
 * Supabase/env dependency — kept out of the provider implementation
 * (lib/jobs/providers/supabase-job-queue.ts) so it's directly unit
 * testable, same split as lib/budget-guard.ts / services/budget-guard.ts.
 */
export function computeBackoffSeconds(attempt: number, baseSeconds = 30, maxSeconds = 3600): number {
  const clampedAttempt = Math.max(1, attempt);
  const seconds = baseSeconds * 2 ** (clampedAttempt - 1);
  return Math.min(seconds, maxSeconds);
}
