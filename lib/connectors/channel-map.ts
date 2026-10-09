import type { Channel, ConnectorPlatform } from "@/types/database";

/**
 * Maps a content/campaign channel to the ad-platform connector that
 * actually runs it. Distinct from `ConnectorPlatform` itself: one
 * connector (META) covers two channels (FACEBOOK, INSTAGRAM). `SEO` has
 * no connector — it is not an ad platform.
 *
 * Pure data, no `server-only` — both server actions
 * (features/campaigns/launch-actions.ts) and Server Components that need
 * to decide "is this channel launchable" (app/(app)/campaigns/[id]/page.tsx)
 * import this same map rather than each defining their own copy.
 */
export const CHANNEL_TO_CONNECTOR: Partial<Record<Channel, ConnectorPlatform>> = {
  FACEBOOK: "META",
  INSTAGRAM: "META",
  TIKTOK: "TIKTOK",
  X: "X",
};

/**
 * Channels that are NOT ad platforms and therefore never receive any share
 * of a launch's daily ad budget (SEO is organic). Together with the keys of
 * `CHANNEL_TO_CONNECTOR` this is the complete, explicit classification of
 * every `Channel`: a channel in neither list is UNCLASSIFIED and the budget
 * allocation (lib/campaigns/budget-allocation.ts) fails closed on it rather
 * than guessing paid vs non-paid. tests/unit/lib/channel-map.test.ts asserts
 * that every `Channel` value is classified exactly once.
 */
export const NON_PAID_CHANNELS: readonly Channel[] = ["SEO"];

export type ChannelBudgetClass = "PAID" | "NON_PAID" | "UNCLASSIFIED";

export function classifyChannelBudget(channel: Channel): ChannelBudgetClass {
  const isPaid = CHANNEL_TO_CONNECTOR[channel] !== undefined;
  const isNonPaid = NON_PAID_CHANNELS.includes(channel);
  if (isPaid && !isNonPaid) return "PAID";
  if (isNonPaid && !isPaid) return "NON_PAID";
  return "UNCLASSIFIED";
}
