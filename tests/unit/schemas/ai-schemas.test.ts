import { describe, expect, it } from "vitest";
import { MarketingBlueprintSchema } from "@/schemas/ai/marketing-blueprint";
import { CampaignProposalSchema, withPrimaryCandidate } from "@/schemas/ai/campaign-proposal";
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
    recommended_channels: ["INSTAGRAM"],
    budget_allocation: [{ channel: "INSTAGRAM", percentage: 100 }],
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
