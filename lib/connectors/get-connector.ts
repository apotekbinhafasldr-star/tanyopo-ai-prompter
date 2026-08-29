import "server-only";

import { MetaConnector } from "@/lib/connectors/meta-connector";
import { TikTokConnector } from "@/lib/connectors/tiktok-connector";
import { XConnector } from "@/lib/connectors/x-connector";
import type { PlatformConnector } from "@/lib/connectors/types";
import type { ConnectorPlatform } from "@/types/database";

const metaConnector = new MetaConnector();
const tiktokConnector = new TikTokConnector();
const xConnector = new XConnector();

/**
 * Returns `null` only for a platform with no connector implementation at
 * all — as of Phase 6, every `ConnectorPlatform` has one. `null` stays
 * possible in the return type for a future platform added to the enum
 * before its connector exists, distinct from a connector that exists but
 * isn't configured (`connector.isConfigured() === false`). Callers should
 * map these to different UI states: NOT_AVAILABLE vs NOT_CONFIGURED.
 */
export function getConnector(platform: ConnectorPlatform): PlatformConnector | null {
  switch (platform) {
    case "META":
      return metaConnector;
    case "TIKTOK":
      return tiktokConnector;
    case "X":
      return xConnector;
    default:
      return null;
  }
}
