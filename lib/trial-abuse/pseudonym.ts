import { createHmac } from "node:crypto";

/**
 * Pseudonymisation for trial anti-abuse. Everything here runs on the application server: the secret never
 * reaches the database or the browser, and only 64-char hex HMAC-SHA256 digests are ever stored.
 * Each identifier type uses its own derived sub-key (domain separation) so a digest of an email can never
 * be confused with, or replayed as, a digest of an IP or a cookie.
 *
 * These are PSEUDONYMS, not anonymous data: whoever holds the secret can test a guess (e.g. a known
 * email) against a stored digest. The privacy notice must say so and retention is limited to 90 days.
 */
export type PseudonymKind = "email" | "cookie" | "device" | "ip";

export function subKey(secret: Buffer, kind: PseudonymKind): Buffer {
  return createHmac("sha256", secret).update(`linoe-trial-abuse/v1/${kind}`).digest();
}

export function pseudonym(secret: Buffer, kind: PseudonymKind, value: string): string {
  return createHmac("sha256", subKey(secret, kind)).update(value).digest("hex");
}

/**
 * Normalises an email so trivial aliases collapse to one identity: lower-case, "+tag" removed, and for
 * Gmail the dots in the local part ignored. Never used for delivery, only as the pseudonym input.
 */
export function normalizeEmail(email: string): string {
  const [localRaw = "", domainRaw = ""] = email.trim().toLowerCase().split("@");
  let domain = domainRaw;
  let local = localRaw.split("+")[0] ?? "";
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.split(".").join("");
  return `${local}@${domain}`;
}

/**
 * Coarsens an IP before hashing: IPv4 -> /24, IPv6 -> /48. A whole mobile-carrier or home subnet is
 * treated as one weak "network" signal, which is all an IP can honestly be (CGNAT, offices, VPNs).
 * Returns null for anything that is not a plain IP (including "unknown").
 */
export function coarseIp(ip: string): string | null {
  const v = ip.trim();
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(v);
  if (v4) {
    const parts = [v4[1], v4[2], v4[3]].map(Number);
    if (parts.every((n) => n >= 0 && n <= 255)) return `${parts.join(".")}.0/24`;
    return null;
  }
  if (v.includes(":") && /^[0-9a-fA-F:.]+$/.test(v) && !v.includes(":::")) {
    const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/i.exec(v);
    if (mapped) return `${mapped[1]}.0/24`;
    const [head = ""] = v.toLowerCase().split("::");
    const groups = head.split(":").filter(Boolean);
    // "::" stands for zero groups, so a short head is padded with zeros.
    if (v.includes("::")) {
      while (groups.length < 3) groups.push("0");
    }
    if (groups.length < 3) return null;
    return `${groups.slice(0, 3).map((g) => g.padStart(4, "0")).join(":")}::/48`;
  }
  return null;
}
