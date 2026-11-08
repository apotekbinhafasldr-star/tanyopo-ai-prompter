import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";

async function headerMap() {
  const rules = await nextConfig.headers!();
  expect(rules).toHaveLength(1);
  expect(rules[0].source).toBe("/:path*");
  return Object.fromEntries(rules[0].headers.map((h) => [h.key, h.value]));
}

describe("next.config security headers", () => {
  it("sets the baseline headers", async () => {
    const h = await headerMap();
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Strict-Transport-Security"]).toBe("max-age=31536000");
    expect(h["Strict-Transport-Security"]).not.toContain("preload");
  });

  it("denies camera, microphone and geolocation", async () => {
    const h = await headerMap();
    expect(h["Permissions-Policy"]).toBe("camera=(), microphone=(), geolocation=()");
  });

  it("ships CSP as report-only only, never enforced", async () => {
    const h = await headerMap();
    expect(h["Content-Security-Policy"]).toBeUndefined();
    const csp = h["Content-Security-Policy-Report-Only"];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("https://*.supabase.co");
    expect(csp).toContain("midtrans.com");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
