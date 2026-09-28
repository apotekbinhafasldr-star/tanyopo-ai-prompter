import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";

/**
 * Isolated per-session demo tokens — LINOE Demo Account & Safe Trial
 * Environment, Phase 1 (Founder-approved: "Security lebih penting
 * daripada convenience").
 *
 * A demo visitor never signs in through Supabase auth and never gets a
 * row in `tenants`/`user_profiles` (those are owned by an external
 * system — see supabase/migrations/20260829080127_prompter_foundation_schema.sql).
 * Instead, this module issues a small, self-contained, signed token that
 * identifies one demo session. It carries no reference to any real
 * tenant, so there is nothing for it to leak into and nothing for one
 * demo visitor's token to grant access to another visitor's session.
 *
 * Deliberately dependency-free (only node:crypto) so sign/verify logic is
 * directly unit-testable, mirroring lib/umkmpro/signature.ts's shape.
 */

export const DEMO_SESSION_COOKIE = "linoe_demo_session";

/** How long a demo session stays valid before a fresh "Coba Demo" click is required. */
export const DEMO_SESSION_TTL_MS = 30 * 60 * 1000;

export interface DemoSessionPayload {
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** Creates a new signed demo session token. Pure — takes the secret and clock as input. */
export function createDemoSessionToken(secret: string, now: number = Date.now()): string {
  const sessionId = randomUUID();
  const issuedAt = now;
  const expiresAt = now + DEMO_SESSION_TTL_MS;
  const payload = `${sessionId}.${issuedAt}.${expiresAt}`;
  const signature = sign(payload, secret);
  return `${payload}.${signature}`;
}

export type VerifyDemoSessionResult =
  | { ok: true; session: DemoSessionPayload }
  | { ok: false; reason: "MALFORMED" | "INVALID_SIGNATURE" | "EXPIRED" };

/**
 * Verifies a demo session token. Fails closed: any malformed input,
 * signature mismatch, or expiry returns `ok: false` — never throws, never
 * guesses a session identity from a partially-valid token.
 */
export function verifyDemoSessionToken(
  token: string | null | undefined,
  secret: string,
  now: number = Date.now(),
): VerifyDemoSessionResult {
  if (!token) {
    return { ok: false, reason: "MALFORMED" };
  }

  const parts = token.split(".");
  if (parts.length !== 4) {
    return { ok: false, reason: "MALFORMED" };
  }

  const [sessionId, issuedAtRaw, expiresAtRaw, signature] = parts;
  const issuedAt = Number(issuedAtRaw);
  const expiresAt = Number(expiresAtRaw);

  if (!sessionId || !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) {
    return { ok: false, reason: "MALFORMED" };
  }

  const payload = `${sessionId}.${issuedAtRaw}.${expiresAtRaw}`;
  const expected = Buffer.from(sign(payload, secret), "hex");
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, "hex");
  } catch {
    return { ok: false, reason: "MALFORMED" };
  }

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reason: "INVALID_SIGNATURE" };
  }

  if (now > expiresAt) {
    return { ok: false, reason: "EXPIRED" };
  }

  return { ok: true, session: { sessionId, issuedAt, expiresAt } };
}
