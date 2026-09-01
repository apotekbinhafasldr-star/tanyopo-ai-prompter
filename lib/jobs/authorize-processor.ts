import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time bearer-token check for app/api/internal/jobs/process's
 * JOBS_PROCESSOR_SECRET. Split out from the route so the timing-safe
 * comparison (and its edge cases — no secret configured, no/malformed
 * header, mismatched length) is directly unit testable, same reasoning
 * as lib/umkmpro/signature.ts's separation from its route.
 */
export function isAuthorizedProcessorRequest(authorizationHeader: string | null, configuredSecret: string | undefined): boolean {
  if (!configuredSecret) return false;
  if (!authorizationHeader?.startsWith("Bearer ")) return false;

  const provided = Buffer.from(authorizationHeader.slice("Bearer ".length));
  const expected = Buffer.from(configuredSecret);
  if (provided.length !== expected.length) return false;

  return timingSafeEqual(provided, expected);
}
