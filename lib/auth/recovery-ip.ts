import { isIP } from "node:net";

/**
 * Client key for the resend-confirmation rate limit.
 *
 * Only Netlify's edge-set `x-nf-client-connection-ip` is accepted, and only after it validates as an IP address.
 * `x-forwarded-for` is NEVER read: its first hop can be supplied by the caller, so honouring it would let anyone mint a
 * fresh bucket per request and bypass the per-IP limit (or exhaust somebody else's bucket). When the trusted header is
 * missing or invalid, every such request shares the single "unidentified" bucket (see RECOVERY_UNIDENTIFIED_LIMIT).
 *
 * UNKNOWN (not provable from this repo): that Netlify overwrites a client-sent `x-nf-client-connection-ip`. The helper
 * is the safe default; confirm the platform behaviour on a real deploy before relying on it as a hard control.
 *
 * Deliberately separate from `getClientIp` in lib/rate-limit.ts (unchanged) and from the PR #141 helpers, so this file
 * does not conflict with them; fold it into `getAuthClientBucket` once #141 is merged.
 */
export const RECOVERY_UNIDENTIFIED_KEY = "unidentified";

/** Per-hour cap per identified client IP. */
export const RECOVERY_IP_LIMIT = 6;
/**
 * Per-hour cap for the shared "unidentified" bucket. Higher than the per-IP cap because every client without a
 * trustworthy header lands here together; the per-address cooldown (60 s) still applies to each of them. It is a
 * trade-off: a determined attacker without an identified IP can use this budget up for everyone on the same instance.
 */
export const RECOVERY_UNIDENTIFIED_LIMIT = 30;

const MAX_IP_LENGTH = 45;

/** First four hextets (/64) of an IPv6 address, lower-case, or null when it cannot be expanded safely. */
function ipv6Prefix64(raw: string): string | null {
  const address = raw.toLowerCase();
  if (address.includes("%")) return null; // zone identifiers are not part of a client address

  const dotted = address.includes(".");
  if (dotted) {
    // IPv4-mapped (::ffff:a.b.c.d) behaves like the IPv4 address.
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
    return mapped && isIP(mapped[1]) === 4 ? mapped[1] : null;
  }

  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  return groups
    .slice(0, 4)
    .map((group) => group.padStart(4, "0"))
    .join(":");
}

export function recoveryClientKey(headersList: { get(name: string): string | null }): string {
  const raw = headersList.get("x-nf-client-connection-ip")?.trim();
  if (!raw || raw.length > MAX_IP_LENGTH) return RECOVERY_UNIDENTIFIED_KEY;

  const version = isIP(raw);
  if (version === 4) return raw;
  if (version === 6) return ipv6Prefix64(raw) ?? RECOVERY_UNIDENTIFIED_KEY;
  return RECOVERY_UNIDENTIFIED_KEY;
}
