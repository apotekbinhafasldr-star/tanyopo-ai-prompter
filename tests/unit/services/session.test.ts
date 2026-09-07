import { describe, expect, it } from "vitest";
import { resolveBusinessName } from "@/services/session";

describe("resolveBusinessName", () => {
  it("prefers LINOE's own brand name when it has been set", () => {
    expect(resolveBusinessName("Jaya Kosmetik", "Sehat Farma")).toBe("Jaya Kosmetik");
  });

  it("falls back to the shared tenant's UMKMpro AI business name when no LINOE brand name exists yet", () => {
    expect(resolveBusinessName(null, "Sehat Farma")).toBe("Sehat Farma");
    expect(resolveBusinessName(undefined, "Sehat Farma")).toBe("Sehat Farma");
  });

  it("falls back to a generic placeholder when neither is set", () => {
    expect(resolveBusinessName(null, null)).toBe("Bisnis Anda");
    expect(resolveBusinessName(undefined, undefined)).toBe("Bisnis Anda");
  });

  it("does not fall back once a real LINOE brand name is set, even if the tenant name is also present", () => {
    // Existing LINOE users who already completed onboarding must keep
    // seeing their own brand name, not regress to the tenant name.
    expect(resolveBusinessName("Toko Baru", "Toko Baru Lama")).toBe("Toko Baru");
  });
});
