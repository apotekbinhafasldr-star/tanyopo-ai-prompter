// @vitest-environment node
// The vendor SDKs refuse to construct under jsdom ("browser-like environment"), so this file runs in node.
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AnthropicProvider } from "@/lib/ai/anthropic-provider";
import { OpenAIProvider } from "@/lib/ai/openai-provider";
import { AIProviderError } from "@/lib/ai/provider";
import { callWithResilience, isRetryableAiError } from "@/lib/ai/resilience";

// No network: every request goes to a fake fetch that answers with a canned HTTP error.
const schema = z.object({ ok: z.boolean() });
const request = { system: "s", prompt: "p", model: "some-model" };

function fakeFetch(status: number, body: unknown = { error: { type: "error", message: "boom" } }) {
  const fn = vi.fn(
    async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const adapters: Array<[string, () => { generateStructured: typeof AnthropicProvider.prototype.generateStructured }]> = [
  ["anthropic", () => new AnthropicProvider("sk-test")],
  ["openai", () => new OpenAIProvider("sk-test") as unknown as AnthropicProvider],
];

describe.each(adapters)("%s adapter — HTTP error mapping (fake fetch)", (_name, make) => {
  async function failure(status: number): Promise<AIProviderError> {
    const fetchMock = fakeFetch(status);
    const err = await make()
      .generateStructured(schema, request)
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(fetchMock).toHaveBeenCalledTimes(1); // the SDK's own retry loop is disabled
    expect(err).toBeInstanceOf(AIProviderError);
    return err as AIProviderError;
  }

  it("429 -> RATE_LIMIT, retryable", async () => {
    const err = await failure(429);
    expect(err.category).toBe("RATE_LIMIT");
    expect(isRetryableAiError(err)).toBe(true);
  });

  it("401 -> AUTH, not retryable", async () => {
    const err = await failure(401);
    expect(err.category).toBe("AUTH");
    expect(isRetryableAiError(err)).toBe(false);
  });

  it.each([500, 503, 529])("%i -> API with its status, retryable (transient vendor failure)", async (status) => {
    const err = await failure(status);
    expect(err.category).toBe("API");
    expect(err.status).toBe(status);
    expect(isRetryableAiError(err)).toBe(true);
  });

  it("400 -> API with its status, NOT retryable (a bad request cannot succeed on repeat)", async () => {
    const err = await failure(400);
    expect(err.category).toBe("API");
    expect(err.status).toBe(400);
    expect(isRetryableAiError(err)).toBe(false);
  });

  it("through callWithResilience a 503 is retried exactly once, then the error is surfaced (bounded: 2 calls, no loop)", async () => {
    const fetchMock = fakeFetch(503);
    const sleep = vi.fn(async () => {});
    const provider = make();

    await expect(
      callWithResilience((signal) => provider.generateStructured(schema, { ...request, signal }), { sleep }),
    ).rejects.toMatchObject({ category: "API", status: 503 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("through callWithResilience a 400 is never retried (1 call)", async () => {
    const fetchMock = fakeFetch(400);
    const provider = make();

    await expect(
      callWithResilience((signal) => provider.generateStructured(schema, { ...request, signal }), {
        sleep: async () => {},
      }),
    ).rejects.toMatchObject({ category: "API", status: 400 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
