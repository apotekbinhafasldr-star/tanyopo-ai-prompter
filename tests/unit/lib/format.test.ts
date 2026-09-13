import { describe, expect, it } from "vitest";
import { formatCurrency, formatDate, campaignStatusLabel, campaignStatusVariant } from "@/lib/utils/format";

describe("formatCurrency", () => {
  it("defaults to id-ID/IDR, unchanged from pre-Global-Edition behavior", () => {
    expect(formatCurrency(1000000)).toMatch(/Rp/);
  });

  it("formats other currencies while defaulting to id-ID number formatting", () => {
    const result = formatCurrency(1000, "USD");
    expect(result).toContain("US$" === result.slice(0, 3) ? "US$" : "$");
  });

  it("uses en-US formatting when locale is 'en'", () => {
    const result = formatCurrency(1234, "USD", "en");
    expect(result).toMatch(/\$/);
  });

  it("returns an em dash for null/undefined regardless of locale", () => {
    expect(formatCurrency(null)).toBe("—");
    expect(formatCurrency(undefined, "USD", "en")).toBe("—");
  });
});

describe("formatDate", () => {
  it("defaults to id-ID formatting when called with no options (unchanged call sites)", () => {
    const result = formatDate("2026-06-15T00:00:00Z");
    expect(result).toMatch(/2026/);
  });

  it("accepts an explicit locale", () => {
    const idResult = formatDate("2026-06-15T00:00:00Z", { locale: "id" });
    const enResult = formatDate("2026-06-15T00:00:00Z", { locale: "en" });
    expect(idResult).toMatch(/2026/);
    expect(enResult).toMatch(/2026/);
  });

  it("renders in the given IANA timeZone rather than the runtime default", () => {
    // A timestamp that's June 15 in UTC but June 14 evening in US Eastern.
    const result = formatDate("2026-06-15T02:00:00Z", { locale: "en", timeZone: "America/New_York" });
    expect(result).toMatch(/Jun 14, 2026/);
  });

  it("returns an em dash for a null/empty value", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate("")).toBe("—");
  });
});

describe("campaignStatusLabel/campaignStatusVariant — Track A campaign scheduling/publishing gap fix", () => {
  it("SCHEDULED no longer reads as 'Terjadwal' (implied automatic execution) — no job/queue/timer exists behind this status", () => {
    expect(campaignStatusLabel("SCHEDULED")).not.toBe("Terjadwal");
    expect(campaignStatusLabel("SCHEDULED")).toMatch(/Perlu Diluncurkan|Manual/i);
  });

  it("SCHEDULED no longer uses the 'brand' (success-adjacent) badge color", () => {
    expect(campaignStatusVariant("SCHEDULED")).not.toBe("brand");
    expect(campaignStatusVariant("SCHEDULED")).toBe("warning");
  });

  it("ACTIVE — a genuinely launched channel — still reads as a real success state (regression guard)", () => {
    expect(campaignStatusLabel("ACTIVE")).toBe("Aktif");
    expect(campaignStatusVariant("ACTIVE")).toBe("success");
  });

  it("other statuses are unaffected by the SCHEDULED wording/color fix", () => {
    expect(campaignStatusLabel("DRAFT")).toBe("Draft");
    expect(campaignStatusVariant("DRAFT")).toBe("neutral");
    expect(campaignStatusLabel("AWAITING_APPROVAL")).toBe("Menunggu Persetujuan");
    expect(campaignStatusVariant("AWAITING_APPROVAL")).toBe("warning");
    expect(campaignStatusLabel("FAILED")).toBe("Gagal");
    expect(campaignStatusVariant("FAILED")).toBe("danger");
  });
});
