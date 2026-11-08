import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AIProviderError, type AIErrorCategory } from "@/lib/ai/provider";
import {
  AI_MAX_RETRIES,
  AI_REQUEST_TIMEOUT_MS,
  AI_RETRY_DELAY_MS,
  callWithResilience,
  isRetryableAiError,
} from "@/lib/ai/resilience";

const noSleep = vi.fn(async () => {});

beforeEach(() => {
  noSleep.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("named constants", () => {
  it("expose sane defaults: one retry, finite timeout well under the SDK default of 10 minutes", () => {
    expect(AI_MAX_RETRIES).toBe(1);
    expect(AI_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
    expect(AI_REQUEST_TIMEOUT_MS).toBeLessThan(10 * 60_000);
    expect(AI_RETRY_DELAY_MS).toBeGreaterThanOrEqual(0);
  });
});

describe("isRetryableAiError", () => {
  const cases: Array<[AIErrorCategory, boolean]> = [
    ["RATE_LIMIT", true],
    ["CONNECTION", true],
    ["AUTH", false],
    ["REFUSAL", false],
    ["INVALID_OUTPUT", false],
    ["CONFIG", false],
    ["API", false],
    ["UNKNOWN", false],
  ];
  it.each(cases)("%s -> retryable=%s", (category, expected) => {
    expect(isRetryableAiError(new AIProviderError("x", category))).toBe(expected);
  });

  it("never retries a plain Error or a non-error value", () => {
    expect(isRetryableAiError(new Error("boom"))).toBe(false);
    expect(isRetryableAiError("RATE_LIMIT")).toBe(false);
    expect(isRetryableAiError(undefined)).toBe(false);
  });
});

describe("callWithResilience — retry", () => {
  it("returns the first success without sleeping or retrying", async () => {
    const attempt = vi.fn(async () => "ok");
    await expect(callWithResilience(attempt, { sleep: noSleep })).resolves.toBe("ok");
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(noSleep).not.toHaveBeenCalled();
  });

  it.each(["RATE_LIMIT", "CONNECTION"] as const)("retries exactly once after a %s failure and returns the second result", async (category) => {
    const attempt = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockRejectedValueOnce(new AIProviderError("transient", category))
      .mockResolvedValueOnce("recovered");

    await expect(callWithResilience(attempt, { sleep: noSleep, retryDelayMs: 7 })).resolves.toBe("recovered");
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(noSleep).toHaveBeenCalledWith(7);
  });

  it("gives up after the single retry and rethrows the last error unchanged", async () => {
    const first = new AIProviderError("first", "RATE_LIMIT");
    const second = new AIProviderError("second", "RATE_LIMIT");
    const attempt = vi.fn<(signal: AbortSignal) => Promise<string>>().mockRejectedValueOnce(first).mockRejectedValueOnce(second);

    await expect(callWithResilience(attempt, { sleep: noSleep })).rejects.toBe(second);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it.each(["AUTH", "REFUSAL", "INVALID_OUTPUT", "CONFIG", "API", "UNKNOWN"] as const)(
    "does NOT retry a %s failure",
    async (category) => {
      const err = new AIProviderError("permanent", category);
      const attempt = vi.fn(async () => {
        throw err;
      });
      await expect(callWithResilience(attempt, { sleep: noSleep })).rejects.toBe(err);
      expect(attempt).toHaveBeenCalledTimes(1);
      expect(noSleep).not.toHaveBeenCalled();
    },
  );

  it("does not retry an uncategorised plain Error", async () => {
    const attempt = vi.fn(async () => {
      throw new Error("bug");
    });
    await expect(callWithResilience(attempt, { sleep: noSleep })).rejects.toThrow("bug");
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("maxRetries: 0 disables retrying even for transient errors", async () => {
    const attempt = vi.fn(async () => {
      throw new AIProviderError("busy", "RATE_LIMIT");
    });
    await expect(callWithResilience(attempt, { maxRetries: 0, sleep: noSleep })).rejects.toBeInstanceOf(AIProviderError);
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});

describe("callWithResilience — timeout", () => {
  it("aborts the signal and fails with a CONNECTION AIProviderError when the provider never answers", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const attempt = (signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<string>(() => {}); // never settles, ignores the signal
    };

    const p = callWithResilience(attempt, { timeoutMs: 1000, maxRetries: 0, sleep: noSleep });
    const assertion = expect(p).rejects.toMatchObject({ name: "AIProviderError", category: "CONNECTION" });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;

    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(true);
  });

  it("a timeout is transient: it is retried once with a fresh, un-aborted signal, and a good second attempt wins", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    let n = 0;
    const attempt = (signal: AbortSignal) => {
      signals.push(signal);
      n += 1;
      return n === 1 ? new Promise<string>(() => {}) : Promise.resolve("second try");
    };

    const p = callWithResilience(attempt, { timeoutMs: 500, sleep: noSleep });
    await vi.advanceTimersByTimeAsync(500);
    await expect(p).resolves.toBe("second try");

    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it("when the SDK reacts to the abort with its own error, the timeout error still wins", async () => {
    vi.useFakeTimers();
    const attempt = (signal: AbortSignal) =>
      new Promise<string>((_, reject) => {
        signal.addEventListener("abort", () => reject(new Error("APIUserAbortError: Request was aborted.")));
      });

    const p = callWithResilience(attempt, { timeoutMs: 100, maxRetries: 0, sleep: noSleep });
    const assertion = expect(p).rejects.toMatchObject({ category: "CONNECTION" });
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it("does not abort a call that finishes in time, and clears its timer", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const p = callWithResilience(async (s) => {
      signal = s;
      return "fast";
    }, { timeoutMs: 1000, sleep: noSleep });
    await expect(p).resolves.toBe("fast");
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(signal?.aborted).toBe(false);
  });
});
