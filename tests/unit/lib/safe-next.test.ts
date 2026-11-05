import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/safe-next";

describe("safeNextPath", () => {
  it("keeps a same-origin path, including its query string (UMKMpro handoff links)", () => {
    expect(safeNextPath("/promote?handoff=abc")).toBe("/promote?handoff=abc");
    expect(safeNextPath("/billing")).toBe("/billing");
  });

  it.each([
    "//evil.com",
    "https://evil.com",
    "http://evil.com/x",
    "javascript:alert(1)",
    "/\\evil.com",
    "evil.com",
    "",
  ])("falls back to /dashboard for %j", (value) => {
    expect(safeNextPath(value)).toBe("/dashboard");
  });

  it("falls back to /dashboard for non-string input", () => {
    expect(safeNextPath(null)).toBe("/dashboard");
    expect(safeNextPath(undefined)).toBe("/dashboard");
    expect(safeNextPath(42)).toBe("/dashboard");
    expect(safeNextPath(new File([], "x"))).toBe("/dashboard");
  });
});
