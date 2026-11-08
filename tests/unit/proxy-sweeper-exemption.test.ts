import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  publicEnv: { supabaseUrl: "https://example.supabase.co", supabasePublishableKey: "pk" },
}));

import { isPublicAsset } from "@/proxy";

describe("proxy — C2 payment sweeper endpoint exemption (signed Bearer service auth, not cookie auth)", () => {
  it("exempts exactly /api/internal/payments/sweep from cookie gating", () => {
    expect(isPublicAsset("/api/internal/payments/sweep")).toBe(true);
  });

  it("does not exempt any sibling or nested /api/internal path", () => {
    expect(isPublicAsset("/api/internal/payments/sweep/extra")).toBe(false);
    expect(isPublicAsset("/api/internal/payments/sweepx")).toBe(false);
    expect(isPublicAsset("/api/internal/payments")).toBe(false);
    expect(isPublicAsset("/api/internal/jobs/process")).toBe(false);
    expect(isPublicAsset("/api/internal")).toBe(false);
  });
});
