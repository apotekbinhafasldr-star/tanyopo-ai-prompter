import { describe, expect, it } from "vitest";
import { isQuickReview } from "@/lib/campaigns/review-mode";

describe("isQuickReview — PR-A phase-1 gate", () => {
  it("is true only for DRAFT arriving from Quick Promote with a proposal", () => {
    expect(isQuickReview("quick-promote", "DRAFT", true)).toBe(true);
  });

  it("is false for a DRAFT without ?from=quick-promote (e.g. opened from the list / Advanced mode)", () => {
    expect(isQuickReview(undefined, "DRAFT", true)).toBe(false);
    expect(isQuickReview("advanced", "DRAFT", true)).toBe(false);
  });

  it.each(["AWAITING_APPROVAL", "SCHEDULED", "ACTIVE", "PAUSED", "COMPLETED", "FAILED"])(
    "is false for non-DRAFT status %s even with ?from=quick-promote",
    (status) => {
      expect(isQuickReview("quick-promote", status, true)).toBe(false);
    },
  );

  it("falls back to the full page when there is no AI proposal to summarise", () => {
    expect(isQuickReview("quick-promote", "DRAFT", false)).toBe(false);
  });
});
