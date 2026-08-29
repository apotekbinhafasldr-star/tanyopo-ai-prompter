import "server-only";

import { MetaConnector } from "@/lib/connectors/meta-connector";
import type { PlatformConnector } from "@/lib/connectors/types";
import type { ConnectorPlatform } from "@/types/database";

const metaConnector = new MetaConnector();

/**
 * Returns `null` for a platform with no connector implementation yet
 * (TikTok/X — Phase 6), distinct from a connector that exists but isn't
 * configured (`connector.isConfigured() === false`). Callers should map
 * these to different UI states: NOT_AVAILABLE vs NOT_CONFIGURED.
 */
export function getConnector(platform: ConnectorPlatform): PlatformConnector | null {
  switch (platform) {
    case "META":
      return metaConnector;
    default:
      return null;
  }
}
