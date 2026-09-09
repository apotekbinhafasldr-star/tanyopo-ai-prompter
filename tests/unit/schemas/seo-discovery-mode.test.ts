import { describe, expect, it } from "vitest";
import { seoProjectSchema } from "@/schemas/seo";

/**
 * Batch B5 — SEO & Discovery without a website. schemas/seo.test.ts
 * already covers the pre-existing WEBSITE-mode behavior (unchanged);
 * this file covers the new discoveryMode branching specifically.
 */
describe("seoProjectSchema — discoveryMode (Batch B5)", () => {
  it("defaults to WEBSITE mode and requires a real URL when discoveryMode is omitted", () => {
    const result = seoProjectSchema.safeParse({ websiteUrl: "", targetKeywords: "" });
    expect(result.success).toBe(false);
  });

  it("accepts NO_WEBSITE mode with no websiteUrl at all — never forced, never fabricated", () => {
    const result = seoProjectSchema.safeParse({
      discoveryMode: "NO_WEBSITE",
      websiteUrl: "",
      targetKeywords: "kopi kekinian jakarta",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.websiteUrl).toBe("");
      expect(result.data.targetKeywords).toEqual(["kopi kekinian jakarta"]);
    }
  });

  it("rejects WEBSITE mode with an empty websiteUrl", () => {
    const result = seoProjectSchema.safeParse({
      discoveryMode: "WEBSITE",
      websiteUrl: "",
      targetKeywords: "",
    });
    expect(result.success).toBe(false);
  });

  it("accepts an optional WhatsApp number and productId for NO_WEBSITE mode", () => {
    const result = seoProjectSchema.safeParse({
      discoveryMode: "NO_WEBSITE",
      whatsappNumber: "0812xxxxxxx",
      productId: "550e8400-e29b-41d4-a716-446655440000",
      targetKeywords: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.whatsappNumber).toBe("0812xxxxxxx");
      expect(result.data.productId).toBe("550e8400-e29b-41d4-a716-446655440000");
    }
  });

  it("accepts NO_WEBSITE mode when websiteUrl/productId/whatsappNumber are entirely absent (null, not undefined) — matches a real FormData.get() on a field the form never rendered", () => {
    // A real <form> submission's FormData.get("x") returns null (not
    // undefined) for a field with no matching input in the DOM — exactly
    // what happens when the NO_WEBSITE branch of the form doesn't render
    // websiteUrl/productId/whatsappNumber at all. Optional() alone
    // rejects null; this is the exact shape a real submission produces.
    const result = seoProjectSchema.safeParse({
      discoveryMode: "NO_WEBSITE",
      websiteUrl: null,
      targetKeywords: null,
      productId: null,
      whatsappNumber: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid discoveryMode value", () => {
    const result = seoProjectSchema.safeParse({ discoveryMode: "SOMETHING_ELSE", targetKeywords: "" });
    expect(result.success).toBe(false);
  });
});
