import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { verifyUmkmproServiceToken, verifyWebhookSignature } from "@/lib/umkmpro/auth";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("UMKMpro auth — NOT_CONFIGURED path (ambient env has no UMKMPRO_SERVICE_TOKEN)", () => {
  it("verifyUmkmproServiceToken reports NOT_CONFIGURED even with a plausible header", () => {
    const result = verifyUmkmproServiceToken("Bearer some-token-someone-guessed");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("NOT_CONFIGURED");
  });

  it("verifyWebhookSignature refuses to validate anything", () => {
    expect(verifyWebhookSignature("{}", "any-signature")).toBe(false);
  });
});

describe("UMKMpro auth — configured with a service token", () => {
  const TOKEN = "test-umkmpro-service-token-disposable";

  async function loadWithToken() {
    vi.stubEnv("UMKMPRO_SERVICE_TOKEN", TOKEN);
    vi.resetModules();
    return import("@/lib/umkmpro/auth");
  }

  it("accepts the exact bearer token", async () => {
    const auth = await loadWithToken();
    const result = auth.verifyUmkmproServiceToken(`Bearer ${TOKEN}`);
    expect(result.ok).toBe(true);
  });

  it("rejects a wrong token (UNAUTHORIZED, not NOT_CONFIGURED)", async () => {
    const auth = await loadWithToken();
    const result = auth.verifyUmkmproServiceToken("Bearer wrong-token");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("UNAUTHORIZED");
  });

  it("rejects a missing/malformed Authorization header", async () => {
    const auth = await loadWithToken();
    expect(auth.verifyUmkmproServiceToken(null).ok).toBe(false);
    expect(auth.verifyUmkmproServiceToken(TOKEN).ok).toBe(false); // missing "Bearer " prefix
  });

  it("validates a correct HMAC-SHA256 signature over the raw body", async () => {
    const auth = await loadWithToken();
    const rawBody = JSON.stringify({ eventId: "evt_1", eventType: "product.updated" });
    const signature = createHmac("sha256", TOKEN).update(rawBody).digest("hex");
    expect(auth.verifyWebhookSignature(rawBody, signature)).toBe(true);
  });

  it("rejects a signature computed over a different body (tamper detection)", async () => {
    const auth = await loadWithToken();
    const rawBody = JSON.stringify({ eventId: "evt_1" });
    const signature = createHmac("sha256", TOKEN).update(rawBody).digest("hex");
    const tamperedBody = JSON.stringify({ eventId: "evt_2" });
    expect(auth.verifyWebhookSignature(tamperedBody, signature)).toBe(false);
  });

  it("rejects a missing signature header", async () => {
    const auth = await loadWithToken();
    expect(auth.verifyWebhookSignature("{}", null)).toBe(false);
  });
});
