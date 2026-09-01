import "server-only";

import type { z } from "zod";
import { serverEnv } from "@/lib/env";
import { AnthropicProvider } from "@/lib/ai/anthropic-provider";
import { OpenAIProvider } from "@/lib/ai/openai-provider";
import { resolveRoute, type AIRoutingEnvConfig } from "@/lib/ai/routing-config";
import { AIRoutingNotConfiguredError } from "@/lib/ai/routing-config";
import type { AIProviderName, AITaskClass } from "@/lib/ai/task-classes";
import type { AIProvider, StructuredGenerationRequest, StructuredGenerationResult } from "@/lib/ai/provider";

export { AIRoutingNotConfiguredError };

export interface RoutedGenerationResult<T> extends StructuredGenerationResult<T> {
  fallbackUsed: boolean;
  /** The provider that was tried first and failed, when fallbackUsed is true. */
  fallbackFrom?: string;
}

function buildRoutingConfig(): AIRoutingEnvConfig {
  const { ai } = serverEnv;

  return {
    // resolveRoute() itself falls back to whichever single provider has a
    // key when this is left undefined — see routing-config.ts
    // impliedDefaultProvider(). A garbage value here (typo'd env var) is
    // passed through as-is rather than silently ignored.
    defaultProvider: ai.defaultProvider,
    fallbackProvider: ai.fallbackProvider,
    openaiConfigured: !!ai.openaiApiKey,
    anthropicConfigured: !!ai.anthropicApiKey,
    openaiDefaultModel: ai.openaiDefaultModel,
    classOverrides: {
      FAST: ai.fast,
      STANDARD: ai.standard,
      STRATEGY: ai.strategy,
      CRITICAL: ai.critical,
    },
  };
}

function instantiateProvider(name: AIProviderName): AIProvider | null {
  if (name === "openai") return serverEnv.ai.openaiApiKey ? new OpenAIProvider(serverEnv.ai.openaiApiKey) : null;
  if (name === "anthropic")
    return serverEnv.ai.anthropicApiKey ? new AnthropicProvider(serverEnv.ai.anthropicApiKey) : null;
  return null;
}

/** True when at least one provider key is present — cheap check for UI gating before a real call. */
export function isAiRoutingConfigured(): boolean {
  return !!(serverEnv.ai.openaiApiKey || serverEnv.ai.anthropicApiKey);
}

/**
 * Tanyopo AI Router: the single place business logic asks for a
 * structured AI generation. Callers declare a task class
 * (lib/ai/task-classes.ts) — never a provider — and the router resolves
 * which configured provider/model actually serves it (lib/ai/routing-config.ts),
 * calling the real provider adapter and falling back once, only on a
 * live failure, only when a distinct fallback provider is configured.
 *
 * Throws AIRoutingNotConfiguredError when nothing is configured at all —
 * callers (services/ai-jobs.ts#runAiJob) turn that into a plain
 * "AI belum dikonfigurasi" state, never a fabricated result. Any other
 * thrown error is a real, executed provider call that failed.
 */
export async function routeStructuredGeneration<T>(
  taskClass: AITaskClass,
  schema: z.ZodType<T>,
  request: Omit<StructuredGenerationRequest, "model">,
): Promise<RoutedGenerationResult<T>> {
  const route = resolveRoute(taskClass, buildRoutingConfig());

  const primary = instantiateProvider(route.provider);
  if (!primary) {
    // resolveRoute only ever names a provider it considers configured —
    // reaching this means routing-config and instantiateProvider disagree
    // about what "configured" means, which is a bug, not a user-facing
    // NOT_CONFIGURED state.
    throw new Error(`AI Router: provider ${route.provider} resolved as usable but has no instance.`);
  }

  try {
    const result = await primary.generateStructured(schema, { ...request, model: route.model });
    return { ...result, fallbackUsed: false };
  } catch (primaryError) {
    if (!route.fallbackProvider) throw primaryError;

    const fallback = instantiateProvider(route.fallbackProvider);
    if (!fallback) throw primaryError;

    const result = await fallback.generateStructured(schema, { ...request, model: route.fallbackModel });
    return { ...result, fallbackUsed: true, fallbackFrom: route.provider };
  }
}
