import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/safe-next";

describe("safeNextPath", () => {
  it("keeps a same-origin path, including its query string (UMKMpro handoff links)", () => {
    expect(safeNextPath("/promote?handoff=abc")).toBe("/promote?handoff=abc");
    expect(safeNextPath("/billing")).toBe("/billing");
    expect(safeNextPath("/")).toBe("/");
    expect(safeNextPath("/campaigns/abc-123?tab=a&b=c#top")).toBe("/campaigns/abc-123?tab=a&b=c#top");
  });

  it("keeps safe URL-encoded values (an encoded control character is just a path character, not a bypass)", () => {
    expect(safeNextPath("/%09/evil.com")).toBe("/%09/evil.com");
    expect(safeNextPath("/%0A/evil.com")).toBe("/%0A/evil.com");
    expect(safeNextPath("/%5Cevil.com")).toBe("/%5Cevil.com");
    expect(safeNextPath("/path%20with%20space")).toBe("/path%20with%20space");
    expect(new URL("/%09/evil.com", "http://safe-next.invalid").origin).toBe("http://safe-next.invalid");
  });

  it.each([
    ["TAB between slashes", "/\t/evil.com"],
    ["LF between slashes", "/\n/evil.com"],
    ["CR between slashes", "/\r/evil.com"],
    ["CRLF between slashes", "/\r\n/evil.com"],
    ["TAB after the first slash then host", "/\tevil.com"],
    ["NUL byte", "/\u0000/evil.com"],
    ["DEL byte", "/\u007f/evil.com"],
    ["other control char (US)", "/\u001f/evil.com"],
    ["control char at the end", "/ok\n"],
    ["control char inside a normal path", "/dash\tboard"],
  ])("falls back for %s", (_label, value) => {
    expect(safeNextPath(value)).toBe("/dashboard");
  });

  it.each([
    "//evil.com",
    "//evil.com/path",
    "///evil.com",
    "https://evil.com",
    "http://evil.com/x",
    "HTTPS://EVIL.COM",
    "javascript:alert(1)",
    "data:text/html,x",
    "/\\evil.com",
    "/\\/evil.com",
    "\\\\evil.com",
    "\\/evil.com",
    "evil.com",
    "./relative",
    "",
    " /dashboard",
  ])("falls back for %j", (value) => {
    expect(safeNextPath(value)).toBe("/dashboard");
  });

  it("falls back for non-string input", () => {
    expect(safeNextPath(null)).toBe("/dashboard");
    expect(safeNextPath(undefined)).toBe("/dashboard");
    expect(safeNextPath(42)).toBe("/dashboard");
    expect(safeNextPath({})).toBe("/dashboard");
    expect(safeNextPath(["/ok"])).toBe("/dashboard");
    expect(safeNextPath(new File([], "x"))).toBe("/dashboard");
  });

  it("every accepted value stays on the app origin when parsed like a browser would", () => {
    const candidates = ["/a", "/a?b=c", "/%09/x", "/a/../b", "/..//x", "/a//b", "/x#y"];
    for (const c of candidates) {
      const out = safeNextPath(c);
      expect(new URL(out, "https://app.example").origin).toBe("https://app.example");
    }
  });
});
