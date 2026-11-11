import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { canSyncInsights, statusAfterSuccessfulLaunch } from "@/lib/campaigns/launched-status";
import { channelCampaignStatusDisplay } from "@/lib/campaigns/channel-status-display";
import { CHANNEL_TO_CONNECTOR } from "@/lib/connectors/channel-map";

describe("status recorded after a successful launch (Phase 1B)", () => {
  it("META records PAUSED: its objects are created PAUSED and nothing activates them", () => {
    expect(statusAfterSuccessfulLaunch("META")).toBe("PAUSED");
  });

  it("TikTok and X keep ACTIVE (unchanged behaviour)", () => {
    expect(statusAfterSuccessfulLaunch("TIKTOK")).toBe("ACTIVE");
    expect(statusAfterSuccessfulLaunch("X")).toBe("ACTIVE");
  });

  it("every Meta channel maps to the META connector (so the rule covers Facebook and Instagram)", () => {
    expect(CHANNEL_TO_CONNECTOR.FACEBOOK).toBe("META");
    expect(CHANNEL_TO_CONNECTOR.INSTAGRAM).toBe("META");
  });

  it("the launch action writes the status through the helper, never a literal ACTIVE", () => {
    const launch = readFileSync("features/campaigns/launch-actions.ts", "utf8");
    expect(launch).toContain("statusAfterSuccessfulLaunch(connectorPlatform)");
    expect(launch).not.toContain('{ status: "ACTIVE", error: null }');
  });

  it("a Meta row recorded PAUSED is shown as paused, never as running", () => {
    for (const channel of ["FACEBOOK", "INSTAGRAM"]) {
      const display = channelCampaignStatusDisplay(channel, "PAUSED");
      expect(display.label).toBe("Dijeda");
      expect(display.variant).not.toBe("success");
    }
  });

  it("insight sync is allowed for ACTIVE and PAUSED with an external id, nothing else", () => {
    expect(canSyncInsights("ACTIVE", "ext_1")).toBe(true);
    expect(canSyncInsights("PAUSED", "ext_1")).toBe(true);
    expect(canSyncInsights("ACTIVE", null)).toBe(false);
    expect(canSyncInsights("PAUSED", "")).toBe(false);
    for (const status of ["DRAFT", "AWAITING_APPROVAL", "SCHEDULED", "COMPLETED", "FAILED"]) {
      expect(canSyncInsights(status, "ext_1")).toBe(false);
    }
  });

  it("PAUSED needs no migration: it is already allowed by the status check constraint", () => {
    const migration = readFileSync("supabase/migrations/20260829095447_prompter_phase2_schema.sql", "utf8");
    expect(migration).toContain("status in ('DRAFT', 'AWAITING_APPROVAL', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'FAILED')");
  });
});
