import "server-only";

import type { ConnectorPlatform, PlatformConnector } from "@/lib/connectors/types";
import { MetaConnector } from "@/lib/connectors/meta-connector";
import { TikTokConnector } from "@/lib/connectors/tiktok-connector";
import { XConnector } from "@/lib/connectors/x-connector";

const connectors: Record<ConnectorPlatform, PlatformConnector> = {
  META: new MetaConnector(),
  TIKTOK: new TikTokConnector(),
  X: new XConnector(),
};

/** Central factory — call sites never `new` a connector directly. */
export function getConnector(platform: ConnectorPlatform): PlatformConnector {
  return connectors[platform];
}

export function isValidConnectorPlatform(value: string): value is ConnectorPlatform {
  return value === "META" || value === "TIKTOK" || value === "X";
}
