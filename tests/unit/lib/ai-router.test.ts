import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

// All providers are fakes: no SDK client is ever constructed and no network is touched.
const h = vi.hoisted(() => {
  type Req = { model?: string; signal?: AbortSignal; prompt: string; system: string };
  type Behavior = (req: Req) => Promise<unknown>;
  return {
    env: {
      openaiApiKey: undefined as string | undefined,
      anthropicApiKey: undefined as string | undefined,
      defaultProvider: undefined as string | undefined,
      fallbackProvider: undefined as string | undefined,
      openaiDefaultModel: undefined as string | undefined,
      fast: {},
      standard: {} as { provider?: string; model?: string },
      strategy: {},
      critical: {},
    },
    behaviors: {} as { anthropic?: Behavior; openai?: Behavior },
    calls: [] as Array<{ provider: string; req: Req }>,
  };
});

vi.mock("@/lib/env", () => ({ serverEnv: { ai: h.env } }));

vi.mock("@/lib/ai/anthropic-provider", () => ({
  AnthropicProvider: class {
    readonly name = "anthropic";
    async generateStructured(_schema: unknown, req: (typeof h.calls)[number]["req"]) {
      h.calls.push({ provider: "anthropic", req });
      return h.behaviors.anthropic!(req);
    }
  },
}));

vi.mock("@/lib/ai/openai-provider", () => ({
  OpenAIProvider: class {
    readonly name = "openai";
    async generateStructured(_schema: unknown, req: (typeof h.calls)[number]["req"]) {
      h.calls.push({ provider: "openai", req });
      return h.behaviors.openai!(req);
    }
  },
}));

import { routeStructuredGeneration, isAiRoutingConfigured, AIRoutingNotConfiguredError } from "@/lib/ai/router";
import { AIProviderError } from "@/lib/ai/provider";
import { AI_REQUEST_TIMEOUT_MS } from "@/lib/ai/resilience";

const schema = z.object({ ok: z.boolean() });
const request = { system: "s", prompt: "p" };

function result(provider: string, model: string) {
  return { data: { ok: true }, provider, model, tokensInput: 11, tokensOutput: 7 };
}

/** Runs the router to completion under fake timers so the retry delay costs no real time. */
async function run() {
  const p = routeStructuredGeneration("STANDARD", schema, request);
  const settled = p.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.runAllTimersAsync();
  return settled;
}

beforeEach(() => {
  vi.useFakeTimers();
  h.calls.length = 0;
  h.behaviors.anthropic = undefined;
  h.behaviors.openai = undefined;
  Object.assign(h.env, {
    openaiApiKey: undefined,
    anthropicApiKey: undefined,
    defaultProvider: undefined,
    fallbackProvider: undefined,
    openaiDefaultModel: undefined,
    standard: {},
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("isAiRoutingConfigured", () => {
  it("is false with no keys and true with either key", () => {
    expect(isAiRoutingConfigured()).toBe(false);
    h.env.openaiApiKey = "k";
    expect(isAiRoutingConfigured()).toBe(true);
    h.env.openaiApiKey = undefined;
    h.env.anthropicApiKey = "k";
    expect(isAiRoutingConfigured()).toBe(true);
  });
});

describe("routeStructuredGeneration — routing", () => {
  it("throws AIRoutingNotConfiguredError and calls nothing when no provider is configured", async () => {
    const out = await run();
    expect(out).toHaveProperty("error");
    expect((out as { error: unknown }).error).toBeInstanceOf(AIRoutingNotConfiguredError);
    expect(h.calls).toHaveLength(0);
  });

  it("uses the single configured provider, passes the routed model and an AbortSignal, and reports no fallback", async () => {
    h.env.openaiApiKey = "k";
    h.env.openaiDefaultModel = "model-x";
    h.behaviors.openai = async () => result("openai", "model-x");

    const out = (await run()) as { value: Awaited<ReturnType<typeof routeStructuredGeneration>> };

    expect(out.value.fallbackUsed).toBe(false);
    expect(out.value.provider).toBe("openai");
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].req.model).toBe("model-x");
    expect(h.calls[0].req.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("routeStructuredGeneration — retry", () => {
  beforeEach(() => {
    h.env.anthropicApiKey = "k";
  });

  it("retries the same provider once on RATE_LIMIT and succeeds without using the fallback", async () => {
    let n = 0;
    h.behaviors.anthropic = async () => {
      n += 1;
      if (n === 1) throw new AIProviderError("busy", "RATE_LIMIT");
      return result("anthropic", "m");
    };

    const out = (await run()) as { value: { fallbackUsed: boolean } };
    expect(out.value.fallbackUsed).toBe(false);
    expect(h.calls.map((c) => c.provider)).toEqual(["anthropic", "anthropic"]);
  });

  it.each(["AUTH", "REFUSAL", "INVALID_OUTPUT"] as const)("does not retry %s", async (category) => {
    h.behaviors.anthropic = async () => {
      throw new AIProviderError("nope", category);
    };
    const out = (await run()) as { error: AIProviderError };
    expect(out.error.category).toBe(category);
    expect(h.calls).toHaveLength(1);
  });

  it("surfaces the last transient error (original category kept) after the one retry is used up", async () => {
    h.behaviors.anthropic = async () => {
      throw new AIProviderError("no network", "CONNECTION");
    };
    const out = (await run()) as { error: AIProviderError };
    expect(out.error).toBeInstanceOf(AIProviderError);
    expect(out.error.category).toBe("CONNECTION");
    expect(h.calls).toHaveLength(2);
  });
});

describe("routeStructuredGeneration — timeout", () => {
  it("a provider that hangs is cut off at AI_REQUEST_TIMEOUT_MS per attempt and reported as CONNECTION", async () => {
    h.env.anthropicApiKey = "k";
    h.behaviors.anthropic = () => new Promise(() => {});

    const out = (await run()) as { error: AIProviderError };
    expect(out.error.category).toBe("CONNECTION");
    // first attempt + the single retry, each with its own aborted signal
    expect(h.calls).toHaveLength(2);
    expect(h.calls[0].req.signal).not.toBe(h.calls[1].req.signal);
    expect(h.calls.every((c) => c.req.signal?.aborted)).toBe(true);
    expect(AI_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

describe("routeStructuredGeneration — fallback", () => {
  beforeEach(() => {
    h.env.anthropicApiKey = "k";
    h.env.openaiApiKey = "k";
    h.env.defaultProvider = "anthropic";
    h.env.fallbackProvider = "openai";
    h.env.standard = { provider: "anthropic", model: "claude-model" };
    h.env.openaiDefaultModel = "gpt-model";
  });

  it("falls back to the other provider (with its own model) when the primary fails permanently, and records who failed", async () => {
    h.behaviors.anthropic = async () => {
      throw new AIProviderError("denied", "AUTH");
    };
    h.behaviors.openai = async () => result("openai", "gpt-model");

    const out = (await run()) as { value: Awaited<ReturnType<typeof routeStructuredGeneration>> };

    expect(out.value.fallbackUsed).toBe(true);
    expect(out.value.fallbackFrom).toBe("anthropic");
    expect(out.value.provider).toBe("openai");
    expect(h.calls.map((c) => [c.provider, c.req.model])).toEqual([
      ["anthropic", "claude-model"],
      ["openai", "gpt-model"],
    ]);
  });

  it("a transient primary failure is retried first; the fallback is only used if the retry also fails", async () => {
    h.behaviors.anthropic = async () => {
      throw new AIProviderError("busy", "RATE_LIMIT");
    };
    h.behaviors.openai = async () => result("openai", "gpt-model");

    const out = (await run()) as { value: { fallbackUsed: boolean } };
    expect(out.value.fallbackUsed).toBe(true);
    expect(h.calls.map((c) => c.provider)).toEqual(["anthropic", "anthropic", "openai"]);
  });

  it("the fallback gets the same retry policy, and its failure is what the caller sees", async () => {
    h.behaviors.anthropic = async () => {
      throw new AIProviderError("denied", "AUTH");
    };
    h.behaviors.openai = async () => {
      throw new AIProviderError("busy", "RATE_LIMIT");
    };

    const out = (await run()) as { error: AIProviderError };
    expect(out.error.category).toBe("RATE_LIMIT");
    expect(h.calls.map((c) => c.provider)).toEqual(["anthropic", "openai", "openai"]);
  });

  it("does not fall back when the primary succeeds", async () => {
    h.behaviors.anthropic = async () => result("anthropic", "claude-model");
    const out = (await run()) as { value: { fallbackUsed: boolean } };
    expect(out.value.fallbackUsed).toBe(false);
    expect(h.calls.map((c) => c.provider)).toEqual(["anthropic"]);
  });

  it("without a configured fallback provider the primary error propagates", async () => {
    h.env.fallbackProvider = undefined;
    h.behaviors.anthropic = async () => {
      throw new AIProviderError("denied", "AUTH");
    };
    const out = (await run()) as { error: AIProviderError };
    expect(out.error.category).toBe("AUTH");
    expect(h.calls.map((c) => c.provider)).toEqual(["anthropic"]);
  });
});
