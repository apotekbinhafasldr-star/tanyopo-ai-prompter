import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  serverEnv: {
    meta: { appId: "a", appSecret: "b", redirectUri: "https://app.example.com/api/connections/meta/callback" },
    tiktok: { appId: "a", appSecret: "b", redirectUri: "https://app.example.com/api/connections/tiktok/callback" },
    x: { clientId: "a", clientSecret: "b", redirectUri: "https://app.example.com/api/connections/x/callback" },
  },
  isConnectorConfigured: (credentials: Record<string, string | undefined>) =>
    Object.values(credentials).every((v) => !!v && v.length > 0),
}));

import { getConnector } from "@/lib/connectors/get-connector";
import { MetaConnector } from "@/lib/connectors/meta-connector";
import { XConnector } from "@/lib/connectors/x-connector";
import { TikTokConnector } from "@/lib/connectors/tiktok-connector";
import { TikTokLoginKitConnector } from "@/lib/connectors/tiktok-login-kit-connector";

describe("getConnector registry", () => {
  it("returns the Login Kit connector (not the Marketing API one) for TIKTOK", () => {
    const connector = getConnector("TIKTOK");
    expect(connector).toBeInstanceOf(TikTokLoginKitConnector);
    expect(connector).not.toBeInstanceOf(TikTokConnector);
  });

  it("leaves META and X unchanged", () => {
    expect(getConnector("META")).toBeInstanceOf(MetaConnector);
    expect(getConnector("X")).toBeInstanceOf(XConnector);
  });
});
