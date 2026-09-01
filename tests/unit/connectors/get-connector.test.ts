import { describe, expect, it } from "vitest";
import { getConnector, isValidConnectorPlatform } from "@/lib/connectors/get-connector";
import { MetaConnector } from "@/lib/connectors/meta-connector";
import { TikTokConnector } from "@/lib/connectors/tiktok-connector";
import { XConnector } from "@/lib/connectors/x-connector";

describe("connector registry", () => {
  it("returns the correct connector instance per platform", () => {
    expect(getConnector("META")).toBeInstanceOf(MetaConnector);
    expect(getConnector("TIKTOK")).toBeInstanceOf(TikTokConnector);
    expect(getConnector("X")).toBeInstanceOf(XConnector);
  });

  it("returns the same instance across calls (singleton, not re-constructed per request)", () => {
    expect(getConnector("META")).toBe(getConnector("META"));
  });

  it("validates platform strings", () => {
    expect(isValidConnectorPlatform("META")).toBe(true);
    expect(isValidConnectorPlatform("TIKTOK")).toBe(true);
    expect(isValidConnectorPlatform("X")).toBe(true);
    expect(isValidConnectorPlatform("SNAPCHAT")).toBe(false);
    expect(isValidConnectorPlatform("")).toBe(false);
  });
});
