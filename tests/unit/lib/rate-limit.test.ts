import { beforeEach, describe, expect, it } from "vitest";
import { __resetRateLimitStateForTests, checkRateLimit } from "@/lib/rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    __resetRateLimitStateForTests();
  });

  it("allows requests under the limit", () => {
    const result = checkRateLimit("key-a", 3, 60_000, 0);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it("blocks once the limit is reached within the window", () => {
    checkRateLimit("key-b", 2, 60_000, 0);
    checkRateLimit("key-b", 2, 60_000, 10);

    const result = checkRateLimit("key-b", 2, 60_000, 20);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("resets once the window has elapsed", () => {
    checkRateLimit("key-c", 1, 1_000, 0);
    const blocked = checkRateLimit("key-c", 1, 1_000, 500);
    expect(blocked.allowed).toBe(false);

    const afterWindow = checkRateLimit("key-c", 1, 1_000, 1_500);
    expect(afterWindow.allowed).toBe(true);
  });

  it("tracks separate keys independently", () => {
    checkRateLimit("key-d", 1, 60_000, 0);
    const otherKey = checkRateLimit("key-e", 1, 60_000, 0);
    expect(otherKey.allowed).toBe(true);
  });
});
