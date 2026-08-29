import { describe, expect, it } from "vitest";
import { contentGeneratorSchema } from "@/schemas/content";

describe("contentGeneratorSchema", () => {
  const valid = {
    productId: "550e8400-e29b-41d4-a716-446655440000",
    platform: "INSTAGRAM",
    contentType: "CAPTION",
    goal: "INCREASE_SALES",
    tone: "santai",
    language: "id",
  };

  it("accepts a valid submission", () => {
    expect(contentGeneratorSchema.safeParse(valid).success).toBe(true);
  });

  it("defaults language to id when omitted", () => {
    const withoutLanguage: Partial<typeof valid> = { ...valid };
    delete withoutLanguage.language;
    const result = contentGeneratorSchema.safeParse(withoutLanguage);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.language).toBe("id");
    }
  });

  it("rejects an unknown platform", () => {
    const result = contentGeneratorSchema.safeParse({ ...valid, platform: "SNAPCHAT" });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown content type", () => {
    const result = contentGeneratorSchema.safeParse({ ...valid, contentType: "PODCAST" });
    expect(result.success).toBe(false);
  });
});
