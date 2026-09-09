import "server-only";

import type { MediaEnhancementProvider } from "@/lib/media/enhancement-provider";
import { NullMediaEnhancementProvider } from "@/lib/media/providers/null-media-enhancement-provider";

const nullMediaEnhancementProvider = new NullMediaEnhancementProvider();

/**
 * Resolves the media enhancement provider the same way
 * lib/billing/get-payment-provider.ts resolves a payment provider: one
 * place, so nothing else in the app picks a provider itself. Only
 * NullMediaEnhancementProvider exists today — a real adapter plugs in
 * here later without any caller changing.
 */
export function getMediaEnhancementProvider(): MediaEnhancementProvider {
  return nullMediaEnhancementProvider;
}
