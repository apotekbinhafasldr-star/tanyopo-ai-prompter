/**
 * The real, authoritative IANA timezone database via the runtime's own
 * Intl implementation — never a hand-curated/fabricated list. Falls back
 * to just the two zones this app has ever actually used
 * (Asia/Jakarta, UTC) on a runtime old enough to lack
 * Intl.supportedValuesOf (Node 18+ / all evergreen browsers have it).
 */
export function listTimezones(): string[] {
  if (typeof Intl.supportedValuesOf === "function") {
    return Intl.supportedValuesOf("timeZone");
  }
  return ["Asia/Jakarta", "UTC"];
}
