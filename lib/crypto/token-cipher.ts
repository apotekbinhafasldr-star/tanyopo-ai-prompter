import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for OAuth tokens at rest (product spec §32 —
 * tokens are encrypted server-side and never sent to the browser). Key
 * comes from `TOKEN_ENCRYPTION_KEY` (32 raw bytes, base64-encoded) and is
 * never read at import time, so this module has no side effect if the key
 * is unset — callers get a clear error instead of a crash at boot.
 *
 * No "server-only" guard here on purpose: `node:crypto` cannot bundle into
 * a client component build regardless, and keeping this module free of
 * Next.js/Supabase specifics is what makes it directly unit-testable — see
 * tests/unit/lib/token-cipher.test.ts.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer | null {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) return null;

  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    return null;
  }

  return key.length === 32 ? key : null;
}

export function isTokenCipherConfigured(): boolean {
  return getKey() !== null;
}

/** Encrypts plaintext into a single base64 blob: iv || authTag || ciphertext. */
export function encryptToken(plaintext: string): string {
  const key = getKey();
  if (!key) {
    throw new Error("TOKEN_ENCRYPTION_KEY belum dikonfigurasi atau tidak valid (harus 32 byte base64).");
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decryptToken(blob: string): string {
  const key = getKey();
  if (!key) {
    throw new Error("TOKEN_ENCRYPTION_KEY belum dikonfigurasi atau tidak valid (harus 32 byte base64).");
  }

  const data = Buffer.from(blob, "base64");
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
