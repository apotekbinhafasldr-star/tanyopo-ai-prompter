import { describe, expect, it } from "vitest";
import { resolveRoute, AIRoutingNotConfiguredError, type AIRoutingEnvConfig } from "@/lib/ai/routing-config";

function baseConfig(overrides: Partial<AIRoutingEnvConfig> = {}): AIRoutingEnvConfig {
  return {
    defaultProvider: undefined,
    fallbackProvider: undefined,
    openaiConfigured: false,
    anthropicConfigured: false,
    openaiDefaultModel: undefined,
    classOverrides: {},
    ...overrides,
  };
}

describe("resolveRoute", () => {
  it("throws AIRoutingNotConfiguredError when nothing is configured", () => {
    expect(() => resolveRoute("STRATEGY", baseConfig())).toThrow(AIRoutingNotConfiguredError);
  });

  it("routes to the only configured provider (anthropic) with no explicit default", () => {
    const route = resolveRoute("STRATEGY", baseConfig({ anthropicConfigured: true }));
    expect(route.provider).toBe("anthropic");
    expect(route.model).toBeUndefined();
  });

  it("routes to the only configured provider (openai) using its default model", () => {
    const route = resolveRoute(
      "STANDARD",
      baseConfig({ openaiConfigured: true, openaiDefaultModel: "gpt-5-mini" }),
    );
    expect(route.provider).toBe("openai");
    expect(route.model).toBe("gpt-5-mini");
  });

  it("treats OpenAI as unusable with no model configured, even with a key present", () => {
    // Only OpenAI has a key, but no model anywhere — nothing else can serve
    // this task class, so routing must fail loudly rather than guess a model id.
    expect(() => resolveRoute("STANDARD", baseConfig({ openaiConfigured: true }))).toThrow(
      AIRoutingNotConfiguredError,
    );
  });

  it("honors a per-class provider override over AI_DEFAULT_PROVIDER", () => {
    const route = resolveRoute(
      "STRATEGY",
      baseConfig({
        defaultProvider: "openai",
        openaiConfigured: true,
        openaiDefaultModel: "gpt-5",
        anthropicConfigured: true,
        classOverrides: { STRATEGY: { provider: "anthropic" } },
      }),
    );
    expect(route.provider).toBe("anthropic");
  });

  it("honors a per-class model override", () => {
    const route = resolveRoute(
      "CRITICAL",
      baseConfig({
        anthropicConfigured: true,
        classOverrides: { CRITICAL: { model: "claude-opus-5-thinking" } },
      }),
    );
    expect(route.provider).toBe("anthropic");
    expect(route.model).toBe("claude-opus-5-thinking");
  });

  it("promotes a configured fallback to primary when the requested primary has no key", () => {
    const route = resolveRoute(
      "STRATEGY",
      baseConfig({
        defaultProvider: "openai", // requested but not configured
        fallbackProvider: "anthropic",
        anthropicConfigured: true,
      }),
    );
    expect(route.provider).toBe("anthropic");
    expect(route.fallbackProvider).toBeUndefined(); // no fallback behind a promoted route
  });

  it("returns a distinct fallbackProvider when both primary and fallback are configured", () => {
    const route = resolveRoute(
      "STANDARD",
      baseConfig({
        defaultProvider: "openai",
        openaiConfigured: true,
        openaiDefaultModel: "gpt-5-mini",
        fallbackProvider: "anthropic",
        anthropicConfigured: true,
      }),
    );
    expect(route.provider).toBe("openai");
    expect(route.fallbackProvider).toBe("anthropic");
  });

  it("never sets a fallback identical to the primary provider", () => {
    const route = resolveRoute(
      "STANDARD",
      baseConfig({
        defaultProvider: "anthropic",
        anthropicConfigured: true,
        fallbackProvider: "anthropic",
      }),
    );
    expect(route.provider).toBe("anthropic");
    expect(route.fallbackProvider).toBeUndefined();
  });

  it("ignores an unknown provider name and throws when nothing else is configured", () => {
    expect(() =>
      resolveRoute("FAST", baseConfig({ defaultProvider: "gemini", anthropicConfigured: false })),
    ).toThrow(AIRoutingNotConfiguredError);
  });
});
