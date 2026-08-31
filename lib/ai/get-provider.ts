import "server-only";

import { serverEnv } from "@/lib/env";
import { AnthropicProvider } from "@/lib/ai/anthropic-provider";
import { OpenAIProvider } from "@/lib/ai/openai-provider";
import type { AIProvider } from "@/lib/ai/provider";

/**
 * Returns the configured AI provider, or `null` when none is configured.
 * Callers must treat `null` as a NOT_CONFIGURED state — show it plainly in
 * the UI, never fall back to fabricated output. See docs/AI_SYSTEM.md and
 * the "never fake" rule in the product spec (§98).
 */
export function getAIProvider(): AIProvider | null {
  // AI_PROVIDER_NAME picks the vendor explicitly. Left blank, it falls back
  // to whichever vendor-specific key is present — AI_PROVIDER_API_KEY selects
  // Anthropic (checked first for backward compatibility), OPENAI_API_KEY
  // selects OpenAI.
  const providerName =
    serverEnv.aiProviderName !== "not_configured"
      ? serverEnv.aiProviderName
      : serverEnv.aiProviderApiKey
        ? "anthropic"
        : serverEnv.openaiApiKey
          ? "openai"
          : "not_configured";

  switch (providerName) {
    case "anthropic":
      return serverEnv.aiProviderApiKey ? new AnthropicProvider(serverEnv.aiProviderApiKey) : null;
    case "openai":
      return serverEnv.openaiApiKey ? new OpenAIProvider(serverEnv.openaiApiKey) : null;
    default:
      return null;
  }
}
