import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  META_READ_MAX_RETRIES,
  META_RETRY_BASE_DELAY_MS,
  META_RETRY_MAX_DELAY_MS,
  decideMetaRetry,
  isMetaThrottleError,
} from "@/lib/connectors/meta-rate-limit";
import { ConnectorApiError } from "@/lib/connectors/types";

const apiError = (details: ConstructorParameters<typeof ConnectorApiError>[2]) => new ConnectorApiError("META", "provider text", details);

describe("isMetaThrottleError", () => {
  it.each([4, 17, 32, 613, 80000, 80003, 80004, 80014])("code %i with an HTTP 400 is a throttle", (code) => {
    // 613 needs a retryable subcode (1487742 = too many calls from this ad account); see below for 613 alone.
    expect(isMetaThrottleError(apiError({ status: 400, code, subcode: code === 613 ? 1487742 : undefined }))).toBe(true);
  });

  it("HTTP 429 is a throttle even without an error body", () => {
    expect(isMetaThrottleError(apiError({ status: 429 }))).toBe(true);
  });

  it("613 QPS subcode 5044001 is a throttle", () => {
    expect(isMetaThrottleError(apiError({ status: 400, code: 613, subcode: 5044001 }))).toBe(true);
  });

  it("613 with no subcode is Meta's abuse-prevention response: never retried", () => {
    expect(isMetaThrottleError(apiError({ status: 400, code: 613 }))).toBe(false);
  });

  it.each([1487632, 1885172, 4841018, 1487225])("documented long-block subcode %i is never retried in-process", (subcode) => {
    expect(isMetaThrottleError(apiError({ status: 400, code: 17, subcode }))).toBe(false);
    expect(isMetaThrottleError(apiError({ status: 400, code: 613, subcode }))).toBe(false);
  });

  it.each([100, 190, 200, 102, 368])("non-throttle code %i is not a throttle", (code) => {
    expect(isMetaThrottleError(apiError({ status: 400, code }))).toBe(false);
  });

  it("5xx, a timeout (no status, no code) and unknown values are not throttles", () => {
    expect(isMetaThrottleError(apiError({ status: 500 }))).toBe(false);
    expect(isMetaThrottleError(apiError({}))).toBe(false);
    expect(isMetaThrottleError(new Error("boom"))).toBe(false);
    expect(isMetaThrottleError(null)).toBe(false);
    expect(isMetaThrottleError("17")).toBe(false);
    expect(isMetaThrottleError(undefined)).toBe(false);
  });

  it("accepts a numeric-string code or subcode, and rejects odd strings", () => {
    expect(isMetaThrottleError({ code: "17" })).toBe(true);
    expect(isMetaThrottleError({ code: "17abc" })).toBe(false);
    expect(isMetaThrottleError({ code: 17, subcode: "1885172" })).toBe(false);
  });
});

describe("decideMetaRetry", () => {
  const throttled = apiError({ status: 400, code: 17 });

  it("doubles the delay per attempt starting at the base delay", () => {
    expect(decideMetaRetry(throttled, 0, 5)).toEqual({ retry: true, delayMs: META_RETRY_BASE_DELAY_MS });
    expect(decideMetaRetry(throttled, 1, 5)).toEqual({ retry: true, delayMs: META_RETRY_BASE_DELAY_MS * 2 });
    expect(decideMetaRetry(throttled, 2, 5)).toEqual({ retry: true, delayMs: META_RETRY_BASE_DELAY_MS * 4 });
  });

  it("caps the delay", () => {
    expect(decideMetaRetry(throttled, 10, 20)).toEqual({ retry: true, delayMs: META_RETRY_MAX_DELAY_MS });
  });

  it("stops once the retry budget is used up", () => {
    expect(decideMetaRetry(throttled, 2, 2)).toEqual({ retry: false });
    expect(decideMetaRetry(throttled, 0, 0)).toEqual({ retry: false });
  });

  it("never retries a non-throttle error", () => {
    expect(decideMetaRetry(apiError({ status: 400, code: 100 }), 0, 5)).toEqual({ retry: false });
  });

  it("honours a Retry-After that is longer than the back-off", () => {
    expect(decideMetaRetry(apiError({ status: 429, retryAfterSeconds: 4 }), 0, 2)).toEqual({ retry: true, delayMs: 4000 });
  });

  it("a Retry-After shorter than the back-off does not shorten the back-off", () => {
    expect(decideMetaRetry(apiError({ status: 429, retryAfterSeconds: 0.2 }), 1, 3)).toEqual({ retry: true, delayMs: 2000 });
  });

  it("a Retry-After beyond the cap means do not wait inside a request", () => {
    expect(decideMetaRetry(apiError({ status: 429, retryAfterSeconds: 60 }), 0, 2)).toEqual({ retry: false });
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("a bad attempt number %j never retries", (attempt) => {
    expect(decideMetaRetry(throttled, attempt, 3)).toEqual({ retry: false });
  });

  it("the default retry budget is small enough for a synchronous server action", () => {
    expect(META_READ_MAX_RETRIES).toBeLessThanOrEqual(2);
    let total = 0;
    for (let attempt = 0; attempt < META_READ_MAX_RETRIES; attempt += 1) {
      const decision = decideMetaRetry(throttled, attempt, META_READ_MAX_RETRIES);
      if (decision.retry) total += decision.delayMs;
    }
    expect(total).toBeLessThanOrEqual(5000);
  });
});

describe("meta-rate-limit module is pure", () => {
  it("has no imports, timers, network, environment or database access", () => {
    const src = readFileSync("lib/connectors/meta-rate-limit.ts", "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code.match(/^import .*$/gm)).toBeNull();
    expect(code).not.toMatch(/setTimeout|fetch\(|process\.env|supabase|server-only/);
  });
});
