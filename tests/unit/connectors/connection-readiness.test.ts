// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  PLATFORM_HELP,
  PROVIDER_GATES,
  canStartOauth,
  resolveConnectionView,
  type ProviderGate,
} from "@/lib/connectors/connection-readiness";
import type { ConnectorPlatform } from "@/types/database";

const NOW = new Date("2026-11-11T00:00:00Z");
const FUTURE = "2027-01-01T00:00:00Z";
const PAST = "2026-01-01T00:00:00Z";

function view(
  platform: ConnectorPlatform,
  opts: { exists?: boolean; configured?: boolean; account?: { status: string; expires_at: string | null } } = {},
) {
  return resolveConnectionView(platform, {
    connectorExists: opts.exists ?? true,
    configured: opts.configured ?? true,
    account: opts.account,
    now: NOW,
  });
}

describe("PROVIDER_GATES defaults (fail-closed)", () => {
  it("TikTok has no OAuth flow and approval is pending", () => {
    expect(PROVIDER_GATES.TIKTOK).toEqual({ approval: "PENDING", oauthFlowAvailable: false });
  });

  it("no platform is marked as provider-approved without evidence", () => {
    for (const gate of Object.values(PROVIDER_GATES)) expect(gate.approval).not.toBe("GRANTED");
  });
});

describe("resolveConnectionView", () => {
  it("no connector -> NOT_AVAILABLE, cannot start OAuth", () => {
    expect(view("META", { exists: false })).toEqual({ status: "NOT_AVAILABLE", canStartOauth: false });
  });

  it("not configured -> NOT_CONFIGURED even if a stored CONNECTED row exists", () => {
    const account = { status: "CONNECTED", expires_at: null };
    expect(view("META", { configured: false, account })).toEqual({ status: "NOT_CONFIGURED", canStartOauth: false });
  });

  it("Meta: configured, no account -> NOT_CONNECTED with a working connect", () => {
    expect(view("META")).toEqual({ status: "NOT_CONNECTED", canStartOauth: true });
  });

  it("X: configured (flag on), no account -> NOT_CONNECTED; X not configured (flag off) -> NOT_CONFIGURED", () => {
    expect(view("X")).toEqual({ status: "NOT_CONNECTED", canStartOauth: true });
    expect(view("X", { configured: false })).toEqual({ status: "NOT_CONFIGURED", canStartOauth: false });
  });

  it("TikTok configured but approval pending -> PROVIDER_PENDING, no connect", () => {
    expect(view("TIKTOK")).toEqual({ status: "PROVIDER_PENDING", canStartOauth: false });
  });

  it("TikTok not configured is reported as NOT_CONFIGURED, not as pending", () => {
    expect(view("TIKTOK", { configured: false }).status).toBe("NOT_CONFIGURED");
  });

  it("a flow that is not built is NOT_AVAILABLE, never NOT_CONNECTED", () => {
    const gates: Record<ConnectorPlatform, ProviderGate> = {
      ...PROVIDER_GATES,
      TIKTOK: { approval: "GRANTED", oauthFlowAvailable: false },
    };
    const v = resolveConnectionView("TIKTOK", { connectorExists: true, configured: true, account: undefined }, gates);
    expect(v).toEqual({ status: "NOT_AVAILABLE", canStartOauth: false });
  });

  it("a stored CONNECTED row that has not expired -> CONNECTED", () => {
    expect(view("META", { account: { status: "CONNECTED", expires_at: FUTURE } }).status).toBe("CONNECTED");
    expect(view("META", { account: { status: "CONNECTED", expires_at: null } }).status).toBe("CONNECTED");
  });

  it.each([
    ["expired", { status: "CONNECTED", expires_at: PAST }],
    ["unparseable expiry", { status: "CONNECTED", expires_at: "garbage" }],
    ["ACTION_REQUIRED", { status: "ACTION_REQUIRED", expires_at: null }],
    ["EXPIRED", { status: "EXPIRED", expires_at: null }],
    ["unknown stored status", { status: "SOMETHING_NEW", expires_at: null }],
  ])("%s -> RECONNECT_REQUIRED", (_label, account) => {
    expect(view("META", { account }).status).toBe("RECONNECT_REQUIRED");
  });

  it("DISCONNECTED row is treated like no account", () => {
    expect(view("META", { account: { status: "DISCONNECTED", expires_at: null } }).status).toBe("NOT_CONNECTED");
  });

  it("a TikTok CONNECTED row is shown truthfully but offers no reconnect", () => {
    const v = view("TIKTOK", { account: { status: "CONNECTED", expires_at: null } });
    expect(v).toEqual({ status: "CONNECTED", canStartOauth: false });
  });

  it("unknown platform in the gate table never allows OAuth", () => {
    const empty = {} as Record<ConnectorPlatform, ProviderGate>;
    expect(canStartOauth("X", { connectorExists: true, configured: true }, empty)).toBe(false);
  });
});

describe("canStartOauth", () => {
  it("requires connector + configured + flow + no pending approval", () => {
    expect(canStartOauth("META", { connectorExists: true, configured: true })).toBe(true);
    expect(canStartOauth("META", { connectorExists: false, configured: true })).toBe(false);
    expect(canStartOauth("META", { connectorExists: true, configured: false })).toBe(false);
    expect(canStartOauth("TIKTOK", { connectorExists: true, configured: true })).toBe(false);
  });
});

describe("PLATFORM_HELP honesty", () => {
  const platforms = Object.keys(PLATFORM_HELP) as ConnectorPlatform[];

  it("covers TikTok and X, each with separate organic and ads text", () => {
    expect(platforms.sort()).toEqual(["TIKTOK", "X"]);
    for (const p of platforms) {
      expect(PLATFORM_HELP[p]!.organic.length).toBeGreaterThan(20);
      expect(PLATFORM_HELP[p]!.ads.length).toBeGreaterThan(20);
    }
  });

  it("never claims readiness", () => {
    for (const p of platforms) {
      const text = `${PLATFORM_HELP[p]!.organic} ${PLATFORM_HELP[p]!.ads}`;
      expect(text).not.toMatch(/\bsiap\b|\bready\b|sudah bisa|sudah aktif/i);
      expect(text).toMatch(/Belum tersedia|Tidak didukung/);
    }
  });
});
