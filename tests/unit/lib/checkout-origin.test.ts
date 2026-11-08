// @vitest-environment node
import { describe, expect, it } from "vitest";
import { allowedCheckoutOrigins, resolveCheckoutOriginFromHeader } from "@/lib/billing/checkout-origin";

const APP = "https://app.linoe.example";
const base = { appUrl: APP };

describe("resolveCheckoutOriginFromHeader — C3 origin allowlist", () => {
  it("accepts the configured app origin", () => {
    expect(resolveCheckoutOriginFromHeader(APP, base)).toBe(APP);
  });
  it("falls back to the app URL when the header is absent", () => {
    expect(resolveCheckoutOriginFromHeader(null, base)).toBe(APP);
  });
  it("falls back to the app URL (trailing slash removed) for a foreign origin", () => {
    expect(resolveCheckoutOriginFromHeader("https://evil.example", { appUrl: `${APP}/` })).toBe(APP);
  });
  it("rejects http, paths, userinfo tricks, look-alike hosts and garbage", () => {
    for (const bad of [
      "http://app.linoe.example",
      "https://app.linoe.example/evil",
      "https://app.linoe.example@evil.example",
      "https://app.linoe.example.evil.example",
      "https://evil.example#https://app.linoe.example",
      "javascript:alert(1)",
      "not a url",
      "",
    ]) {
      expect(resolveCheckoutOriginFromHeader(bad, base), bad).toBe(APP);
    }
  });
  it("accepts an extra origin from CHECKOUT_ALLOWED_ORIGINS and Netlify deploy URLs, but only https", () => {
    const config = {
      appUrl: APP,
      extraOrigins: "https://staging.linoe.example, http://insecure.example",
      deployUrls: ["https://deploy-preview-7--linoe.netlify.app", undefined],
    };
    expect(resolveCheckoutOriginFromHeader("https://staging.linoe.example", config)).toBe("https://staging.linoe.example");
    expect(resolveCheckoutOriginFromHeader("https://deploy-preview-7--linoe.netlify.app", config)).toBe(
      "https://deploy-preview-7--linoe.netlify.app",
    );
    expect(resolveCheckoutOriginFromHeader("http://insecure.example", config)).toBe(APP);
    expect([...allowedCheckoutOrigins(config)].sort()).toEqual(
      [APP, "https://deploy-preview-7--linoe.netlify.app", "https://staging.linoe.example"].sort(),
    );
  });
  it("an http app URL (local dev) never allowlists an http header origin", () => {
    expect(resolveCheckoutOriginFromHeader("http://localhost:3000", { appUrl: "http://localhost:3000" })).toBe("http://localhost:3000");
    expect(allowedCheckoutOrigins({ appUrl: "http://localhost:3000" }).size).toBe(0);
  });
});
