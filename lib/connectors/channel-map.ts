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
