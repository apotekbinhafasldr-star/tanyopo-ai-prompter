import "server-only";

import { serverEnv } from "@/lib/env";
import { AnthropicProvider } from "@/lib/ai/anthropic-provider";
import type { AIProvider } from "@/lib/ai/provider";

/**
 * Returns the configured AI provider, or `null` when none is configured.
 * Callers must treat `null` as a NOT_CONFIGURED state — show it plainly in
 * the UI, never fall back to fabricated output. See docs/AI_SYSTEM.md and
 * the "never fake" rule in the product spec (§98).
 */
export function getAIProvider(): AIProvider | null {
  if (!serverEnv.aiProviderApiKey) {
    return null;
  }

  // "anthropic" is the default provider when a key is set but the vendor
  // name is left blank — the switch stays here so a second provider can be
  // added later without changing any call site.
  const providerName =
    serverEnv.aiProviderName === "not_configured" ? "anthropic" : serverEnv.aiProviderName;

  switch (providerName) {
    case "anthropic":
      return new AnthropicProvider(serverEnv.aiProviderApiKey);
    default:
      return null;
  }
}
