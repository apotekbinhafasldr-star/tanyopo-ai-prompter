import { describe, expect, it } from "vitest";
import { DiscoveryRecommendationsSchema } from "@/schemas/ai/discovery-recommendations";

/**
 * B5 hotfix — production error from OpenAI's structured-output API:
 * "Schema field at properties/hashtags uses .optional() without
 * .nullable() which is not supported by the API." OpenAI's Responses API
 * structured-output mode (lib/ai/openai-provider.ts, zodTextFormat) requires
 * every top-level property to be present in the model's output — a Zod
 * `.optional()` field (which permits the key to be entirely absent) is
 * rejected outright, unlike `.nullable()` (which requires the key but
 * allows its value to be null) or a plain required field with an
 * empty-collection convention. `hashtags` used `.optional()`; fixed by
 * making it a required (possibly-empty) array, matching every other
 * field in this schema and the identically-named field in
 * schemas/ai/content-generation.ts.
 */
describe("DiscoveryRecommendationsSchema", () => {
  const valid = {
    primary_keywords: ["kopi susu jakarta"],
    supporting_keywords: [],
    profile_name_tip: "Gunakan nama yang mudah diingat dan mengandung kata kunci produk.",
    bio_recommendation: "Kopi susu kekinian, siap antar area Jakarta Selatan.",
    content_ideas: [{ title: "Proses seduh kopi", angle: "Konten behind-the-scene selalu dicari calon pelanggan." }],
    hashtags: ["kopikekinian", "kopijakarta"],
    cta_recommendation: "Hubungi kami lewat WhatsApp untuk pemesanan.",
    recommended_channels: [{ channel: "INSTAGRAM", reason: "Cocok untuk konten visual produk kopi." }],
  };

  it("accepts a well-formed recommendation", () => {
    expect(DiscoveryRecommendationsSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts an empty hashtags array — the model may legitimately have none relevant", () => {
    const result = DiscoveryRecommendationsSchema.safeParse({ ...valid, hashtags: [] });
    expect(result.success).toBe(true);
  });

  it("rejects a response missing the hashtags field entirely (regression for the .optional() production bug)", () => {
    const withoutHashtags: Partial<typeof valid> = { ...valid };
    delete withoutHashtags.hashtags;
    const result = DiscoveryRecommendationsSchema.safeParse(withoutHashtags);
    expect(result.success).toBe(false);
  });

  it("has no .optional() top-level fields — OpenAI's structured-output API rejects any field that permits an absent key", () => {
    for (const [key, field] of Object.entries(DiscoveryRecommendationsSchema.shape)) {
      const result = field.safeParse(undefined);
      expect(result.success, `field "${key}" accepts undefined — must be required (use .nullable() or a plain required type instead of .optional())`).toBe(false);
    }
  });
});
