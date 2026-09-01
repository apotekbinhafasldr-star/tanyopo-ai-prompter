import { afterEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptToken, decryptToken, isTokenEncryptionConfigured } from "@/lib/crypto/token-cipher";

const VALID_KEY = randomBytes(32).toString("base64");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("token cipher — NOT_CONFIGURED path (ambient env has no TOKEN_ENCRYPTION_KEY)", () => {
  it("isTokenEncryptionConfigured() is false", () => {
    expect(isTokenEncryptionConfigured()).toBe(false);
  });

  it("encryptToken() returns null rather than storing plaintext", () => {
    expect(encryptToken("super-secret-access-token")).toBeNull();
  });

  it("decryptToken() returns null rather than throwing", () => {
    expect(decryptToken("anything")).toBeNull();
  });
});

describe("token cipher — configured with a valid 32-byte key", () => {
  async function loadWithKey() {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", VALID_KEY);
    vi.resetModules();
    return import("@/lib/crypto/token-cipher");
  }

  it("round-trips a token through encrypt/decrypt", async () => {
    const cipher = await loadWithKey();
    expect(cipher.isTokenEncryptionConfigured()).toBe(true);

    const plaintext = "EAABwzLixnjYBO-real-looking-meta-token";
    const encrypted = cipher.encryptToken(plaintext);
    expect(encrypted).not.toBeNull();
    expect(encrypted).not.toContain(plaintext); // never store plaintext, even as a substring

    const decrypted = cipher.decryptToken(encrypted!);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertext for the same plaintext each time (random IV)", async () => {
    const cipher = await loadWithKey();
    const a = cipher.encryptToken("same-token");
    const b = cipher.encryptToken("same-token");
    expect(a).not.toBe(b);
  });

  it("fails closed (returns null) on tampered ciphertext rather than returning garbage", async () => {
    const cipher = await loadWithKey();
    const encrypted = cipher.encryptToken("token-to-tamper-with")!;
    const tampered = encrypted.slice(0, -4) + "abcd";
    expect(cipher.decryptToken(tampered)).toBeNull();
  });

  it("rejects a key that isn't exactly 32 bytes", async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.from("too-short").toString("base64"));
    vi.resetModules();
    const cipher = await import("@/lib/crypto/token-cipher");
    expect(cipher.isTokenEncryptionConfigured()).toBe(false);
    expect(cipher.encryptToken("x")).toBeNull();
  });
});
