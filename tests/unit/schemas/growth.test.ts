import { describe, expect, it } from "vitest";
import { growthGoalSchema, followerSnapshotSchema } from "@/schemas/growth";

describe("growthGoalSchema", () => {
  it("accepts a valid goal", () => {
    const result = growthGoalSchema.safeParse({
      platform: "INSTAGRAM",
      targetFollowers: "5000",
      targetDate: "2026-12-31",
      notes: "",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown platform", () => {
    const result = growthGoalSchema.safeParse({ platform: "SEO", targetFollowers: "100" });
    expect(result.success).toBe(false);
  });

  it("rejects a negative target", () => {
    const result = growthGoalSchema.safeParse({ platform: "TIKTOK", targetFollowers: "-5" });
    expect(result.success).toBe(false);
  });

  it("accepts a target of zero", () => {
    const result = growthGoalSchema.safeParse({ platform: "X", targetFollowers: "0" });
    expect(result.success).toBe(true);
  });
});

describe("followerSnapshotSchema", () => {
  it("accepts a valid snapshot", () => {
    const result = followerSnapshotSchema.safeParse({
      platform: "FACEBOOK",
      followerCount: "1200",
      recordedAt: "2026-08-29",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a negative follower count", () => {
    const result = followerSnapshotSchema.safeParse({ platform: "FACEBOOK", followerCount: "-1" });
    expect(result.success).toBe(false);
  });
});
