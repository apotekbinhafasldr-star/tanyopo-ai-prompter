import { describe, expect, it } from "vitest";
import { MarketingBlueprintSchema } from "@/schemas/ai/marketing-blueprint";
import {
  CampaignProposalSchema,
  withPrimaryCandidate,
  selectCandidate,
  withRecommendedChannels,
} from "@/schemas/ai/campaign-proposal";
import { ContentGenerationSchema } from "@/schemas/ai/content-generation";

describe("MarketingBlueprintSchema", () => {
  const valid = {
    summary: "Kopi lokal premium untuk pecinta kopi urban.",
    usp: "Biji kopi single origin dari petani lokal.",
    benefits: ["Rasa khas", "Harga terjangkau"],
    pain_points: ["Sulit menemukan kopi lokal berkualitas"],
    target_personas: [{ name: "Pekerja kantoran 25-35", description: "Suka ngopi pagi" }],
    positioning: "Kopi lokal premium harga terjangkau",
    marketing_angles: ["Dari petani lokal ke cangkir Anda"],
    recommended_channels: ["INSTAGRAM", "TIKTOK"],
    content_ideas: ["Behind the scene proses roasting"],
    risks: [],
    disclaimers: "",
    localization_strategy: "",
  };

  it("accepts a well-formed blueprint", () => {
    expect(MarketingBlueprintSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an invalid recommended channel", () => {
    const result = MarketingBlueprintSchema.safeParse({ ...valid, recommended_channels: ["YOUTUBE"] });
    expect(result.success).toBe(false);
  });

  it("rejects an empty benefits list", () => {
    const result = MarketingBlueprintSchema.safeParse({ ...valid, benefits: [] });
    expect(result.success).toBe(false);
  });
});

describe("CampaignProposalSchema", () => {
  const candidate = (n: number) => ({
    hook: `Hook kandidat ${n} untuk kopi lokal`,
    headline: `Headline kandidat ${n}`,
    cta: "Belanja Sekarang",
    primary_text: `Body copy kandidat ${n} yang konsisten dengan angle kandidat ini.`,
    rationale: "Cocok untuk audiens pekerja urban yang mencari kopi berkualitas.",
  });

  const valid = {
    customer_pain: "Sulit menemukan kopi lokal berkualitas dengan harga wajar",
    desired_outcome: "Menikmati kopi enak setiap hari tanpa mahal",
    value_proposition: "Kopi single origin langsung dari petani lokal dengan harga terjangkau",
    positioning: "Kopi lokal premium",
    audience_summary: "Pekerja urban 25-35 tahun",
    marketing_angle: "Dari petani ke cangkir Anda",
    candidates: [candidate(1), candidate(2), candidate(3)],
    hook: "Hook kandidat 1 untuk kopi lokal",
    headline: "Kopi Lokal, Rasa Dunia",
    primary_text: "Nikmati kopi single origin langsung dari petani lokal.",
    cta: "Belanja Sekarang",
    creative_concept: "Video proses roasting dengan nuansa hangat",
    budget_allocation: [
      { channel: "INSTAGRAM", percentage: 100, reason: "Cocok untuk konten visual kopi dan menjangkau audiens urban." },
    ],
    excluded_channels: [{ channel: "X", reason: "Kurang relevan untuk audiens pekerja urban yang dituju campaign ini." }],
    recommended_channels: ["INSTAGRAM"],
  };

  it("accepts a well-formed proposal", () => {
    expect(CampaignProposalSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a headline over 120 characters", () => {
    const result = CampaignProposalSchema.safeParse({ ...valid, headline: "A".repeat(121) });
    expect(result.success).toBe(false);
  });

  it("rejects a budget_allocation percentage over 100", () => {
    const result = CampaignProposalSchema.safeParse({
      ...valid,
      budget_allocation: [{ channel: "INSTAGRAM", percentage: 150 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects fewer than 3 candidates", () => {
    const result = CampaignProposalSchema.safeParse({ ...valid, candidates: [candidate(1), candidate(2)] });
    expect(result.success).toBe(false);
  });

  it("rejects more than 3 candidates", () => {
    const result = CampaignProposalSchema.safeParse({
      ...valid,
      candidates: [candidate(1), candidate(2), candidate(3), candidate(4)],
    });
    expect(result.success).toBe(false);
  });

  it("withPrimaryCandidate syncs top-level hook/headline/cta to candidates[0], even if the model's own top-level fields disagreed", () => {
    const parsed = CampaignProposalSchema.parse({
      ...valid,
      // Deliberately mismatched top-level fields — the model failing to
      // keep them in sync with candidates[0], which is exactly the case
      // withPrimaryCandidate() must correct for deterministically.
      hook: "Hook yang tidak sinkron",
      headline: "Headline yang tidak sinkron",
      cta: "CTA yang tidak sinkron",
    });
    const synced = withPrimaryCandidate(parsed);
    expect(synced.hook).toBe(parsed.candidates[0].hook);
    expect(synced.headline).toBe(parsed.candidates[0].headline);
    expect(synced.cta).toBe(parsed.candidates[0].cta);
  });

  describe("selectCandidate", () => {
    const parsed = CampaignProposalSchema.parse(valid);

    it("swaps the chosen candidate into the primary position and syncs hook/headline/cta/primary_text together", () => {
      const originalAlternative = parsed.candidates[2];

      const result = selectCandidate(parsed, 2);

      expect(result.hook).toBe(originalAlternative.hook);
      expect(result.headline).toBe(originalAlternative.headline);
      expect(result.cta).toBe(originalAlternative.cta);
      expect(result.primary_text).toBe(originalAlternative.primary_text);
      expect(result.candidates[0]).toEqual(originalAlternative);
    });

    it("moves the previous primary into the vacated slot instead of dropping it", () => {
      const originalPrimary = parsed.candidates[0];
      const result = selectCandidate(parsed, 2);
      expect(result.candidates[2]).toEqual(originalPrimary);
      expect(result.candidates).toHaveLength(3);
    });

    it("is a no-op for index 0 (already primary) or an out-of-range index", () => {
      expect(selectCandidate(parsed, 0)).toEqual(parsed);
      expect(selectCandidate(parsed, 3)).toEqual(parsed);
      expect(selectCandidate(parsed, -1)).toEqual(parsed);
    });
  });

  describe("Smart Channel Selection (Batch B2)", () => {
    it("rejects a budget_allocation entry missing its reason", () => {
      const result = CampaignProposalSchema.safeParse({
        ...valid,
        budget_allocation: [{ channel: "INSTAGRAM", percentage: 100 }],
      });
      expect(result.success).toBe(false);
    });

    it("withRecommendedChannels drops non-positive-percentage entries and derives recommended_channels from what's left", () => {
      const parsed = CampaignProposalSchema.parse({
        ...valid,
        // The model left a 0% entry in budget_allocation instead of moving
        // it to excluded_channels, and recommended_channels disagrees with
        // budget_allocation — exactly the drift withRecommendedChannels()
        // must correct for deterministically.
        budget_allocation: [
          { channel: "INSTAGRAM", percentage: 70, reason: "Cocok untuk audiens visual." },
          { channel: "TIKTOK", percentage: 30, reason: "Cocok untuk video pendek." },
          { channel: "X", percentage: 0, reason: "Seharusnya masuk excluded_channels, bukan di sini." },
        ],
        recommended_channels: ["FACEBOOK"],
      });

      const result = withRecommendedChannels(parsed);

      expect(result.budget_allocation).toHaveLength(2);
      expect(result.budget_allocation.map((b) => b.channel)).toEqual(["INSTAGRAM", "TIKTOK"]);
      expect(result.recommended_channels).toEqual(["INSTAGRAM", "TIKTOK"]);
    });

    it("withRecommendedChannels falls back to the proposal unchanged if every entry is non-positive (never leaves zero channels)", () => {
      const parsed = CampaignProposalSchema.parse({
        ...valid,
        budget_allocation: [{ channel: "INSTAGRAM", percentage: 0, reason: "Edge case." }],
      });
      expect(withRecommendedChannels(parsed)).toEqual(parsed);
    });

    it("accepts an empty excluded_channels array (every available channel was worth recommending)", () => {
      const result = CampaignProposalSchema.safeParse({ ...valid, excluded_channels: [] });
      expect(result.success).toBe(true);
    });
  });
});

describe("ContentGenerationSchema", () => {
  const valid = {
    hook: "Ngopi pagi tanpa ribet?",
    caption: "Kopi siap seduh dalam 30 detik.",
    body: "Cocok untuk pagi yang sibuk.",
    cta: "Coba Sekarang",
    hashtags: ["#kopi", "#lokal"],
    creative_brief: "Foto cangkir kopi dengan latar meja kerja",
    video_script: null,
  };

  it("accepts well-formed content with null video_script", () => {
    expect(ContentGenerationSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts a non-null video_script", () => {
    const result = ContentGenerationSchema.safeParse({ ...valid, video_script: "Scene 1: ..." });
    expect(result.success).toBe(true);
  });

  it("rejects a missing video_script field", () => {
    const withoutVideoScript: Partial<typeof valid> = { ...valid };
    delete withoutVideoScript.video_script;
    const result = ContentGenerationSchema.safeParse(withoutVideoScript);
    expect(result.success).toBe(false);
  });
});
