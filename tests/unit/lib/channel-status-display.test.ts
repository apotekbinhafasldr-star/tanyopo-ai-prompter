import { describe, expect, it } from "vitest";
import {
  META_CREATED_PAUSED_LABEL,
  LAST_KNOWN_STATUS_NOTE,
  canOfferLaunch,
  channelCampaignStatusDisplay,
  isMetaChannel,
  requiresManualCheck,
} from "@/lib/campaigns/channel-status-display";
import { campaignStatusLabel, campaignStatusVariant } from "@/lib/utils/format";

describe("honest Meta status (PR #37 / A1)", () => {
  it.each(["FACEBOOK", "INSTAGRAM"])("%s recorded ACTIVE is shown as created-but-paused, never as running", (channel) => {
    const display = channelCampaignStatusDisplay(channel, "ACTIVE");

    expect(display.label).toBe("Dibuat — dijeda, belum tayang");
    expect(display.label).toBe(META_CREATED_PAUSED_LABEL);
    expect(display.label).not.toBe("Aktif");
    expect(display.note).toBe(LAST_KNOWN_STATUS_NOTE);
    expect(display.note).toBe(
      "Status terakhir yang diketahui LINOE. Perubahan langsung di Meta Ads Manager mungkin belum tercermin.",
    );
  });

  it("never uses the green success badge for a Meta channel that is only created", () => {
    for (const channel of ["FACEBOOK", "INSTAGRAM"]) {
      const variant = channelCampaignStatusDisplay(channel, "ACTIVE").variant;
      expect(variant).not.toBe("success");
      expect(variant).toBe("warning");
    }
  });

  it("makes no claim that an ad is running", () => {
    const text = JSON.stringify(channelCampaignStatusDisplay("FACEBOOK", "ACTIVE")).toLowerCase();
    expect(text).not.toMatch(/sedang tayang|berjalan|aktif/);
    expect(text).toContain("belum tayang");
  });

  it.each(["TIKTOK", "X"])("%s ACTIVE keeps its existing label, colour and no extra note", (channel) => {
    expect(channelCampaignStatusDisplay(channel, "ACTIVE")).toEqual({
      label: "Aktif",
      variant: "success",
      note: null,
    });
  });

  it.each([
    "DRAFT",
    "AWAITING_APPROVAL",
    "SCHEDULED",
    "PAUSED",
    "COMPLETED",
    "FAILED",
  ])("Meta %s keeps its existing label and colour", (status) => {
    for (const channel of ["FACEBOOK", "INSTAGRAM", "TIKTOK", "X", "SEO"]) {
      expect(channelCampaignStatusDisplay(channel, status)).toEqual({
        label: campaignStatusLabel(status),
        variant: campaignStatusVariant(status),
        note: null,
      });
    }
  });

  it("the shared status helpers are unchanged (stored values and master labels are untouched)", () => {
    expect(campaignStatusLabel("ACTIVE")).toBe("Aktif");
    expect(campaignStatusVariant("ACTIVE")).toBe("success");
  });

  it("classifies only the Meta channels as Meta", () => {
    expect(isMetaChannel("FACEBOOK")).toBe(true);
    expect(isMetaChannel("INSTAGRAM")).toBe(true);
    for (const channel of ["TIKTOK", "X", "SEO", "UNKNOWN"]) expect(isMetaChannel(channel)).toBe(false);
  });
});

describe("no misleading retry for a Meta FAILED row (PR #37 / A2)", () => {
  it("a Meta FAILED row needs a manual check", () => {
    expect(requiresManualCheck("FACEBOOK", "FAILED")).toBe(true);
    expect(requiresManualCheck("INSTAGRAM", "FAILED")).toBe(true);
  });

  it("other channels and other statuses do not", () => {
    expect(requiresManualCheck("TIKTOK", "FAILED")).toBe(false);
    expect(requiresManualCheck("X", "FAILED")).toBe(false);
    for (const status of ["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED", "COMPLETED"]) {
      expect(requiresManualCheck("FACEBOOK", status)).toBe(false);
    }
  });

  it.each(["FACEBOOK", "INSTAGRAM"])("%s FAILED never gets a launch or retry control, whatever the master status", (channel) => {
    for (const master of ["DRAFT", "AWAITING_APPROVAL", "SCHEDULED", "ACTIVE", "FAILED"]) {
      expect(canOfferLaunch(master, channel, "FAILED")).toBe(false);
    }
  });

  it("a SCHEDULED Meta row under a SCHEDULED master still gets the normal launch control", () => {
    expect(canOfferLaunch("SCHEDULED", "FACEBOOK", "SCHEDULED")).toBe(true);
  });

  it("an ACTIVE row never gets a launch control", () => {
    expect(canOfferLaunch("SCHEDULED", "FACEBOOK", "ACTIVE")).toBe(false);
  });

  it("a Meta row recorded PAUSED after a launch never gets a launch control (Phase 1B)", () => {
    for (const channel of ["FACEBOOK", "INSTAGRAM"]) expect(canOfferLaunch("SCHEDULED", channel, "PAUSED")).toBe(false);
  });

  it("other channels keep their existing launch behaviour", () => {
    expect(canOfferLaunch("SCHEDULED", "TIKTOK", "SCHEDULED")).toBe(true);
    expect(canOfferLaunch("SCHEDULED", "TIKTOK", "FAILED")).toBe(true);
    expect(canOfferLaunch("SCHEDULED", "X", "FAILED")).toBe(true);
    expect(canOfferLaunch("DRAFT", "TIKTOK", "SCHEDULED")).toBe(false);
  });
});
