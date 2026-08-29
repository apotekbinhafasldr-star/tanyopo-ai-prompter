import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encryptToken, decryptToken, isTokenCipherConfigured } from "@/lib/crypto/token-cipher";

const ORIGINAL_KEY = process.env.TOKEN_ENCRYPTION_KEY;

describe("token-cipher", () => {
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) {
      delete process.env.TOKEN_ENCRYPTION_KEY;
    } else {
      process.env.TOKEN_ENCRYPTION_KEY = ORIGINAL_KEY;
    }
  });

  describe("without a configured key", () => {
    beforeEach(() => {
      delete process.env.TOKEN_ENCRYPTION_KEY;
    });

    it("reports not configured", () => {
      expect(isTokenCipherConfigured()).toBe(false);
    });

    it("throws a clear error on encrypt", () => {
      expect(() => encryptToken("secret")).toThrow(/TOKEN_ENCRYPTION_KEY/);
    });

    it("throws a clear error on decrypt", () => {
      expect(() => decryptToken("anything")).toThrow(/TOKEN_ENCRYPTION_KEY/);
    });
  });

  describe("with a configured key", () => {
    beforeEach(() => {
      process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    });

    it("reports configured", () => {
      expect(isTokenCipherConfigured()).toBe(true);
    });

    it("round-trips a plaintext token", () => {
      const plaintext = "EAAG_example_access_token_value";
      const encrypted = encryptToken(plaintext);
      expect(encrypted).not.toBe(plaintext);
      expect(decryptToken(encrypted)).toBe(plaintext);
    });

    it("produces a different ciphertext each time (random IV)", () => {
      const a = encryptToken("same-plaintext");
      const b = encryptToken("same-plaintext");
      expect(a).not.toBe(b);
    });

    it("rejects a tampered ciphertext", () => {
      const encrypted = encryptToken("secret-token");
      const tampered = encrypted.slice(0, -4) + "abcd";
      expect(() => decryptToken(tampered)).toThrow();
    });
  });

  it("rejects a key that isn't 32 bytes", () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");
    expect(isTokenCipherConfigured()).toBe(false);
  });
});
