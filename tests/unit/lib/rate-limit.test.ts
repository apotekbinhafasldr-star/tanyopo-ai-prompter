import { beforeEach, describe, expect, it } from "vitest";
import { __resetRateLimitStateForTests, checkRateLimit, getClientIp } from "@/lib/rate-limit";

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

describe("getClientIp", () => {
  function headersFrom(values: Record<string, string>) {
    return { get: (name: string) => values[name] ?? null };
  }

  it("prefers Netlify's edge-set connection IP", () => {
    const ip = getClientIp(headersFrom({ "x-nf-client-connection-ip": "203.0.113.5" }));
    expect(ip).toBe("203.0.113.5");
  });

  it("falls back to the first hop of x-forwarded-for", () => {
    const ip = getClientIp(headersFrom({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }));
    expect(ip).toBe("203.0.113.9");
  });

  it("falls back to a shared 'unknown' bucket when no IP header is present", () => {
    const ip = getClientIp(headersFrom({}));
    expect(ip).toBe("unknown");
  });
});

describe("registerAction's rate-limit shape (5 attempts / hour per IP)", () => {
  const REGISTER_RATE_LIMIT = 5;
  const REGISTER_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

  beforeEach(() => {
    __resetRateLimitStateForTests();
  });

  it("allows a normal single signup", () => {
    const result = checkRateLimit("register:203.0.113.1", REGISTER_RATE_LIMIT, REGISTER_RATE_LIMIT_WINDOW_MS, 0);
    expect(result.allowed).toBe(true);
  });

  it("allows up to 5 genuine attempts from the same IP within the hour (no false-positive on normal shared-IP usage)", () => {
    for (let i = 0; i < 5; i++) {
      const result = checkRateLimit(
        "register:203.0.113.2",
        REGISTER_RATE_LIMIT,
        REGISTER_RATE_LIMIT_WINDOW_MS,
        i * 1000,
      );
      expect(result.allowed).toBe(true);
    }
  });

  it("blocks the 6th attempt from the same IP within the hour", () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit("register:203.0.113.3", REGISTER_RATE_LIMIT, REGISTER_RATE_LIMIT_WINDOW_MS, i * 1000);
    }
    const sixth = checkRateLimit(
      "register:203.0.113.3",
      REGISTER_RATE_LIMIT,
      REGISTER_RATE_LIMIT_WINDOW_MS,
      5 * 1000,
    );
    expect(sixth.allowed).toBe(false);
  });

  it("keys by IP, so a different registrant's attempts are never affected by another IP's usage", () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit("register:203.0.113.4", REGISTER_RATE_LIMIT, REGISTER_RATE_LIMIT_WINDOW_MS, i * 1000);
    }
    const otherIp = checkRateLimit(
      "register:203.0.113.5",
      REGISTER_RATE_LIMIT,
      REGISTER_RATE_LIMIT_WINDOW_MS,
      5 * 1000,
    );
    expect(otherIp.allowed).toBe(true);
  });
});
