import type { AIProviderName, AITaskClass } from "@/lib/ai/task-classes";
import { isKnownProviderName } from "@/lib/ai/task-classes";

/**
 * Pure input to resolveRoute() — everything it needs to pick a route, with
 * no direct process.env access, so routing decisions are unit-testable
 * without mocking the environment (same pattern as lib/budget-guard.ts,
 * lib/autopilot-policy.ts). lib/ai/router.ts builds this from serverEnv.
 */
export interface AIRoutingEnvConfig {
  /** Provider used when a task class has no explicit override. */
  defaultProvider?: string;
  /** Tried when the resolved primary provider's call fails. */
  fallbackProvider?: string;
  openaiConfigured: boolean;
  anthropicConfigured: boolean;
  /**
   * Model used for an OpenAI route when the task class has no explicit
   * model override. OpenAI has no built-in default in this codebase (no
   * model id has ever been chosen/verified here) — unlike Anthropic, which
   * keeps its long-standing "claude-opus-5" default. Leave unset and every
   * OpenAI route needs its own AI_<CLASS>_MODEL.
   */
  openaiDefaultModel?: string;
  classOverrides: Partial<Record<AITaskClass, { provider?: string; model?: string }>>;
}

export interface ResolvedRoute {
  provider: AIProviderName;
  /** undefined = the provider adapter's own built-in default model. */
  model?: string;
  fallbackProvider?: AIProviderName;
  fallbackModel?: string;
}

/**
 * Thrown when no configured provider can serve a task class at all —
 * runAiJob() (services/ai-jobs.ts) catches this specifically and returns a
 * plain "AI belum dikonfigurasi" state without ever inserting a
 * prompter_ai_jobs row, same UX every phase before the AI Router had.
 */
export class AIRoutingNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIRoutingNotConfiguredError";
  }
}

interface UsableRoute {
  provider: AIProviderName;
  model?: string;
}

function tryProvider(
  requested: string | undefined,
  overrideModel: string | undefined,
  config: AIRoutingEnvConfig,
): UsableRoute | null {
  if (!isKnownProviderName(requested)) return null;

  const configured = requested === "openai" ? config.openaiConfigured : config.anthropicConfigured;
  if (!configured) return null;

  if (requested === "openai") {
    const model = overrideModel ?? config.openaiDefaultModel;
    // OpenAI never had a hardcoded default in this codebase — no model
    // configured for this route means it isn't actually usable, not a
    // guess at a possibly-wrong model id.
    if (!model) return null;
    return { provider: "openai", model };
  }

  return { provider: "anthropic", model: overrideModel };
}

/**
 * Resolves which provider (and model) should serve one task class, and
 * which provider (if any) is the configured fallback. Never guesses a
 * model id, never silently ignores an env override that names an unknown
 * provider (falls through as unconfigured instead), and throws
 * AIRoutingNotConfiguredError only when truly nothing usable exists.
 */
/**
 * When no provider is named at all (no per-class override, no
 * AI_DEFAULT_PROVIDER), fall back to whichever single provider actually
 * has a key — a one-key setup should work with zero routing config. Both
 * or neither configured stays ambiguous on purpose: with two real
 * choices, an explicit default is required rather than silently picking
 * one.
 */
function impliedDefaultProvider(config: AIRoutingEnvConfig): AIProviderName | undefined {
  if (config.openaiConfigured && !config.anthropicConfigured) return "openai";
  if (config.anthropicConfigured && !config.openaiConfigured) return "anthropic";
  return undefined;
}

export function resolveRoute(taskClass: AITaskClass, config: AIRoutingEnvConfig): ResolvedRoute {
  const override = config.classOverrides[taskClass];
  const requestedPrimary = override?.provider ?? config.defaultProvider ?? impliedDefaultProvider(config);

  const primary = tryProvider(requestedPrimary, override?.model, config);

  const fallbackRequested =
    config.fallbackProvider && config.fallbackProvider !== requestedPrimary
      ? config.fallbackProvider
      : undefined;
  const fallback = tryProvider(fallbackRequested, undefined, config);

  if (primary) {
    return {
      provider: primary.provider,
      model: primary.model,
      fallbackProvider: fallback?.provider,
      fallbackModel: fallback?.model,
    };
  }

  if (fallback) {
    // Primary wasn't usable at all (no key, or OpenAI with no model
    // configured) — the fallback becomes the effective route. There's no
    // second fallback behind it.
    return { provider: fallback.provider, model: fallback.model };
  }

  throw new AIRoutingNotConfiguredError(
    `Tidak ada AI provider yang terkonfigurasi untuk task class ${taskClass}.`,
  );
}
