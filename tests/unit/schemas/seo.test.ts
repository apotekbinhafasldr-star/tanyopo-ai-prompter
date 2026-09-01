import { describe, expect, it } from "vitest";
import { seoProjectSchema } from "@/schemas/seo";

describe("seoProjectSchema", () => {
  it("accepts a valid website URL with comma-separated keywords", () => {
    const result = seoProjectSchema.safeParse({
      websiteUrl: "https://usaha-anda.com",
      targetKeywords: "apotek dekat saya, obat batuk anak",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.targetKeywords).toEqual(["apotek dekat saya", "obat batuk anak"]);
    }
  });

  it("rejects an invalid URL", () => {
    const result = seoProjectSchema.safeParse({ websiteUrl: "not-a-url", targetKeywords: "" });
    expect(result.success).toBe(false);
  });

  it("defaults to an empty keyword list when none is provided", () => {
    const result = seoProjectSchema.safeParse({ websiteUrl: "https://example.com", targetKeywords: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.targetKeywords).toEqual([]);
    }
  });

  it("trims and drops empty entries from a messy keyword list", () => {
    const result = seoProjectSchema.safeParse({
      websiteUrl: "https://example.com",
      targetKeywords: "keyword satu,, keyword dua ,",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.targetKeywords).toEqual(["keyword satu", "keyword dua"]);
    }
  });
});
