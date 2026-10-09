import { describe, expect, it } from "vitest";
import { CHANNEL_TO_CONNECTOR, NON_PAID_CHANNELS, classifyChannelBudget } from "@/lib/connectors/channel-map";
import type { Channel } from "@/types/database";

const ALL_CHANNELS: Channel[] = ["FACEBOOK", "INSTAGRAM", "TIKTOK", "X", "SEO"];

describe("channel budget classification", () => {
  it("classifies every channel exactly once (paid XOR non-paid)", () => {
    for (const channel of ALL_CHANNELS) {
      const paid = CHANNEL_TO_CONNECTOR[channel] !== undefined;
      const nonPaid = NON_PAID_CHANNELS.includes(channel);
      expect(paid !== nonPaid, `${channel} must be classified exactly once`).toBe(true);
      expect(classifyChannelBudget(channel)).not.toBe("UNCLASSIFIED");
    }
  });

  it("classifies ad channels as PAID and SEO as NON_PAID", () => {
    expect(classifyChannelBudget("FACEBOOK")).toBe("PAID");
    expect(classifyChannelBudget("INSTAGRAM")).toBe("PAID");
    expect(classifyChannelBudget("TIKTOK")).toBe("PAID");
    expect(classifyChannelBudget("X")).toBe("PAID");
    expect(classifyChannelBudget("SEO")).toBe("NON_PAID");
  });

  it("fails closed (UNCLASSIFIED) for a channel that is in neither list", () => {
    expect(classifyChannelBudget("LINKEDIN" as Channel)).toBe("UNCLASSIFIED");
  });
});
