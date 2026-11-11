import { isIP } from "node:net";

/**
 * Trusted client IP for abuse limiters that must not be bypassable or weaponisable by header forgery
 * (docs/SOFT_LAUNCH_10_TENANTS.md, section "Audit sesi demo").
 *
 * Why not lib/rate-limit.ts#getClientIp: that helper falls back to the first hop of `x-forwarded-for`, which a client
 * can set to anything when the request does not pass through a proxy that overwrites it. Two attacks follow:
 *  1. bypass: rotate a fake `x-forwarded-for` per request so every request lands in a fresh bucket;
 *  2. lock-out: send a victim's address in `x-forwarded-for` so the victim's bucket is exhausted.
 * getClientIp is shared with login/OTP (features/auth), so it is left untouched here (auth change = Founder approval).
 *
 * Source used: only `x-nf-client-connection-ip`, which Netlify documents (staff reply, answers.netlify.com thread
 * "Upcoming change: stripping exposed Netlify headers", accessed 2026-11-11) as "the right one for inspecting" the
 * connecting IP and keeps on function requests. Netlify's own docs do not state that a client-sent copy is overwritten,
 * so that part is NOT VERIFIED; the value is therefore validated as an IP literal, and `x-forwarded-for` is never used.
 * Without a valid value the caller gets `null` and must apply a stricter, shared fallback bucket.
 */
export function getTrustedClientIp(headers: { get(name: string): string | null }): string | null {
  const raw = headers.get("x-nf-client-connection-ip")?.trim();
  if (!raw || raw.length > 45) return null;
  return isIP(raw) === 0 ? null : raw.toLowerCase();
}

/** Expands an IPv6 literal to its 8 hextets, or null when it is not a plain IPv6 literal. */
function expandIpv6(ip: string): number[] | null {
  const parts = ip.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (parts.length === 1 ? missing !== 0 : missing < 1) return null;
  const hextets = [...head, ...Array<string>(parts.length === 2 ? missing : 0).fill("0"), ...tail];
  if (hextets.length !== 8) return null;
  const numbers = hextets.map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? Number.parseInt(h, 16) : Number.NaN));
  return numbers.some(Number.isNaN) ? null : numbers;
}

/**
 * Limiter bucket key for an IP. A single IPv6 subscriber normally owns a whole /64, so keying on the full address would
 * let one device mint unlimited "different" IPs; the key is the /64 prefix instead. IPv4 (and IPv4-mapped IPv6) is
 * keyed as is. Mobile carrier NAT (many subscribers behind one IPv4) cannot be separated by IP at all; see the
 * mitigation notes in app/api/demo/start/route.ts.
 */
export function ipBucketKey(ip: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return mapped[1];
  if (isIP(ip) !== 6) return ip;
  const hextets = expandIpv6(ip);
  if (!hextets) return ip;
  return `${hextets.slice(0, 4).map((h) => h.toString(16)).join(":")}::/64`;
}
