import { describe, expect, it } from "vitest";
import { isPublicAsset } from "@/proxy";

describe("isPublicAsset — B12 hotfix regression: auth routes that handle their own session-less auth", () => {
  it("exempts /auth/confirm from cookie gating (signup confirmation arrives with no session yet)", () => {
    expect(isPublicAsset("/auth/confirm")).toBe(true);
  });

  it("still exempts /auth/callback (password recovery — unaffected by this fix)", () => {
    expect(isPublicAsset("/auth/callback")).toBe(true);
  });

  it("does not exempt an actual protected app route", () => {
    expect(isPublicAsset("/dashboard")).toBe(false);
    expect(isPublicAsset("/billing")).toBe(false);
  });

  it("does not exempt an unrelated /auth/ path by accident (exact match only)", () => {
    expect(isPublicAsset("/auth/confirm/extra")).toBe(false);
    expect(isPublicAsset("/auth/confirmx")).toBe(false);
  });
});
