import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { serverEnv } from "@/lib/env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

/**
 * Encrypts an OAuth token for storage in prompter_oauth_credentials
 * (product spec §32 — tokens are never persisted in plaintext). Returns
 * `null` when TOKEN_ENCRYPTION_KEY is not configured; callers must treat
 * that as NOT_CONFIGURED and refuse to persist the token at all rather
 * than falling back to storing it unencrypted.
 */
export function encryptToken(plaintext: string): string | null {
  const key = resolveKey();
  if (!key) return null;

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // iv.ciphertext.authTag, each base64 — self-contained for decryption.
  return [iv, ciphertext, authTag].map((b) => b.toString("base64")).join(".");
}

/**
 * Decrypts a token previously produced by encryptToken(). Returns `null`
 * (never throws) when the key is not configured or the ciphertext is
 * malformed/tampered — callers must treat a null result as
 * ACTION_REQUIRED (the connection needs to be re-authenticated), never
 * crash the caller.
 */
export function decryptToken(stored: string): string | null {
  const key = resolveKey();
  if (!key) return null;

  try {
    const [ivB64, ciphertextB64, authTagB64] = stored.split(".");
    if (!ivB64 || !ciphertextB64 || !authTagB64) return null;

    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextB64, "base64")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch {
    return null;
  }
}

/** True when TOKEN_ENCRYPTION_KEY is present and the right length. */
export function isTokenEncryptionConfigured(): boolean {
  return resolveKey() !== null;
}

function resolveKey(): Buffer | null {
  const raw = serverEnv.tokenEncryptionKey;
  if (!raw) return null;

  try {
    const key = Buffer.from(raw, "base64");
    // AES-256 requires exactly 32 bytes.
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}
