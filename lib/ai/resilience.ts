import { AIProviderError } from "@/lib/ai/provider";

/** Hard ceiling for ONE provider attempt (the SDKs' own default is 10 minutes). */
export const AI_REQUEST_TIMEOUT_MS = 45_000;
/** Extra attempts after the first, only for transient failures. */
export const AI_MAX_RETRIES = 1;
/** Pause before the retry. */
export const AI_RETRY_DELAY_MS = 1_000;

/**
 * Transient failures worth one retry: rate limit, connection problems and
 * our own timeout (reported as CONNECTION). AUTH, REFUSAL, INVALID_OUTPUT,
 * CONFIG, API and uncategorised errors are never retried: repeating them
 * cannot succeed and would only burn money or time.
 */
export function isRetryableAiError(err: unknown): boolean {
  return err instanceof AIProviderError && (err.category === "RATE_LIMIT" || err.category === "CONNECTION");
}

export interface ResilienceOptions {
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function runOnce<T>(attempt: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Reject BEFORE aborting: aborting makes the SDK reject synchronously with
      // its own abort error, and ours must be the one that wins the race.
      reject(
        new AIProviderError(
          `Penyedia AI tidak merespons dalam ${Math.round(timeoutMs / 1000)} detik. Coba lagi sebentar lagi.`,
          "CONNECTION",
        ),
      );
      controller.abort();
    }, timeoutMs);
  });
  try {
    // The race enforces the deadline even if the provider ignores the signal.
    return await Promise.race([attempt(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs one provider call with an explicit per-attempt timeout (AbortSignal +
 * a race) and at most `maxRetries` retries for transient failures only.
 * Errors are rethrown unchanged, so error categories stay as the provider
 * adapters assigned them.
 */
export async function callWithResilience<T>(
  attempt: (signal: AbortSignal) => Promise<T>,
  options: ResilienceOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? AI_REQUEST_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? AI_MAX_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? AI_RETRY_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;

  for (let n = 0; ; n++) {
    try {
      return await runOnce(attempt, timeoutMs);
    } catch (err) {
      if (n >= maxRetries || !isRetryableAiError(err)) throw err;
      await sleep(retryDelayMs);
    }
  }
}
