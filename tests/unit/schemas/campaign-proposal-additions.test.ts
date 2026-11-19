import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CampaignProposalGenerationSchema,
  CampaignProposalSchema,
  ProposalAudienceSchema,
  ProposalTestPlanSchema,
} from "@/schemas/ai/campaign-proposal";
import { PROPOSAL_OBJECTIVE_VALUES } from "@/schemas/ai/proposal-objectives";
import { META_OBJECTIVE_CONTRACTS, META_UNSUPPORTED_OBJECTIVES } from "@/lib/campaigns/meta-objective-contracts";
import { KOPI_ROBUSTA_IMPROVED } from "@/tests/fixtures/ai/kopi-robusta-aceh-simulasi";

/**
 * PR-5 additions to the campaign proposal: objective_recommendation, audience, missing_facts, test_plan.
 * They are optional in the STORED schema (older proposals stay valid) and required-nullable in the schema the AI
 * is asked to fill (the providers' structured outputs reject .optional()).
 */

const NEW_FIELDS = ["objective_recommendation", "audience", "missing_facts", "test_plan"] as const;

// A proposal exactly as stored before PR-5: none of the new keys.
const legacy = () => JSON.parse(JSON.stringify(KOPI_ROBUSTA_IMPROVED)) as Record<string, unknown>;

const audience = {
  countries: ["ID"],
  age_min: 22,
  age_max: 45,
  advantage_plus: true,
  interest_suggestions_text: ["kopi", "seduh manual"],
};
const testPlan = { recommended_variants: [1, 2], min_duration_days: 7, rationale: "Bandingkan dua sudut pandang selama seminggu." };
const full = () => ({
  ...legacy(),
  objective_recommendation: "WEBSITE_TRAFFIC",
  audience,
  missing_facts: ["Harga produk belum diisi"],
  test_plan: testPlan,
});

describe("backward compatibility (proposals saved before PR-5)", () => {
  it("a proposal without any of the new fields is still valid", () => {
    for (const key of NEW_FIELDS) expect(legacy()).not.toHaveProperty(key);
    expect(CampaignProposalSchema.safeParse(legacy()).success).toBe(true);
  });

  it("parsing a legacy proposal does not invent the new keys", () => {
    const parsed = CampaignProposalSchema.parse(legacy());
    for (const key of NEW_FIELDS) expect(parsed).not.toHaveProperty(key);
  });

  it("null is accepted for every new field (a model with nothing to say)", () => {
    const r = CampaignProposalSchema.safeParse({
      ...legacy(),
      objective_recommendation: null,
      audience: null,
      missing_facts: null,
      test_plan: null,
    });
    expect(r.success).toBe(true);
  });
});

describe("new fields: valid input", () => {
  it("accepts a complete, well-formed set", () => {
    const r = CampaignProposalSchema.safeParse(full());
    expect(r.success).toBe(true);
  });

  it("accepts an empty interest list and empty missing_facts", () => {
    expect(CampaignProposalSchema.safeParse({ ...legacy(), audience: { ...audience, interest_suggestions_text: [] }, missing_facts: [] }).success).toBe(true);
  });
});

describe("objective_recommendation", () => {
  it.each([...PROPOSAL_OBJECTIVE_VALUES])("accepts %s", (value) => {
    expect(CampaignProposalSchema.safeParse({ ...legacy(), objective_recommendation: value }).success).toBe(true);
  });

  it.each(["MAKE_MONEY", "sales", "OUTCOME_TRAFFIC", "", 3])("rejects %j", (value) => {
    expect(CampaignProposalSchema.safeParse({ ...legacy(), objective_recommendation: value }).success).toBe(false);
  });

  it("the hard-coded enum equals the keys of META_OBJECTIVE_CONTRACTS plus META_UNSUPPORTED_OBJECTIVES (stays in sync)", () => {
    const fromMeta = [...Object.keys(META_OBJECTIVE_CONTRACTS), ...Object.keys(META_UNSUPPORTED_OBJECTIVES)].sort();
    expect([...PROPOSAL_OBJECTIVE_VALUES].sort()).toEqual(fromMeta);
  });
});

describe("audience: text keywords only, never Meta interest IDs", () => {
  const bad = (override: unknown) => CampaignProposalSchema.safeParse({ ...legacy(), audience: override }).success;

  it("rejects an unknown interest-ID key (strict object)", () => {
    expect(bad({ ...audience, interest_ids: ["6003139266461"] })).toBe(false);
    expect(bad({ ...audience, interests: [{ id: "6003139266461", name: "Kopi" }] })).toBe(false);
    expect(bad({ ...audience, flexible_spec: [{ interests: [{ id: "1", name: "x" }] }] })).toBe(false);
  });

  it("rejects an object (with an id) where a keyword string is expected", () => {
    expect(bad({ ...audience, interest_suggestions_text: [{ id: "6003139266461", name: "Kopi" }] })).toBe(false);
  });

  it("rejects a purely numeric string, which would be an ID in disguise", () => {
    expect(bad({ ...audience, interest_suggestions_text: ["6003139266461"] })).toBe(false);
    expect(bad({ ...audience, interest_suggestions_text: [" 6003139266461 "] })).toBe(false);
  });

  it("rejects country names (ISO alpha-2 only), out-of-range or inverted ages", () => {
    expect(bad({ ...audience, countries: ["Indonesia"] })).toBe(false);
    expect(bad({ ...audience, age_min: 5 })).toBe(false);
    expect(bad({ ...audience, age_max: 90 })).toBe(false);
    expect(bad({ ...audience, age_min: 50, age_max: 20 })).toBe(false);
  });

  it("rejects missing or non-boolean advantage_plus and more than 10 keywords", () => {
    const { advantage_plus, ...rest } = audience;
    void advantage_plus;
    expect(bad(rest)).toBe(false);
    expect(bad({ ...audience, advantage_plus: "yes" })).toBe(false);
    expect(bad({ ...audience, interest_suggestions_text: Array.from({ length: 11 }, (_, i) => `kata${i}`) })).toBe(false);
  });

  it("no schema output key names a Meta interest ID", () => {
    const text = JSON.stringify([z.toJSONSchema(CampaignProposalGenerationSchema), z.toJSONSchema(CampaignProposalSchema)]);
    expect(text).not.toMatch(/interest_id|interest_ids|interests"|flexible_spec|behavior_id|"targeting"/i);
    // The only interest-related property is the text one.
    expect(text).toContain("interest_suggestions_text");
  });
});

describe("test_plan: variants and minimum duration, no performance numbers", () => {
  const bad = (override: unknown) => CampaignProposalSchema.safeParse({ ...legacy(), test_plan: override }).success;

  it("rejects performance or result fields (strict object)", () => {
    expect(bad({ ...testPlan, expected_ctr: 3.2 })).toBe(false);
    expect(bad({ ...testPlan, expected_roas: 4 })).toBe(false);
    expect(bad({ ...testPlan, min_budget: 100000 })).toBe(false);
  });

  it("rejects an invalid variant number or duration", () => {
    expect(bad({ ...testPlan, recommended_variants: [4] })).toBe(false);
    expect(bad({ ...testPlan, recommended_variants: [] })).toBe(false);
    expect(bad({ ...testPlan, min_duration_days: 0 })).toBe(false);
    expect(bad({ ...testPlan, min_duration_days: 3.5 })).toBe(false);
  });

  it("has exactly the three advisory keys", () => {
    expect(Object.keys(ProposalTestPlanSchema.shape).sort()).toEqual(["min_duration_days", "rationale", "recommended_variants"]);
  });
});

describe("missing_facts", () => {
  it("rejects a non-string entry and more than 8 entries", () => {
    expect(CampaignProposalSchema.safeParse({ ...legacy(), missing_facts: [1] }).success).toBe(false);
    expect(CampaignProposalSchema.safeParse({ ...legacy(), missing_facts: Array.from({ length: 9 }, () => "x") }).success).toBe(false);
  });
});

describe("CampaignProposalGenerationSchema (what the AI must produce)", () => {
  it("requires the new fields: a legacy-shaped output is rejected, so the model cannot silently skip them", () => {
    expect(CampaignProposalGenerationSchema.safeParse(legacy()).success).toBe(false);
  });

  it("accepts null / [] for the new fields", () => {
    const r = CampaignProposalGenerationSchema.safeParse({
      ...legacy(),
      objective_recommendation: null,
      audience: null,
      missing_facts: [],
      test_plan: null,
    });
    expect(r.success).toBe(true);
  });

  it("accepts a complete set, and its output is also valid for the stored schema", () => {
    const parsed = CampaignProposalGenerationSchema.parse(full());
    expect(CampaignProposalSchema.safeParse(parsed).success).toBe(true);
  });

  it("has no .optional() PR-5 field (structured outputs reject it); each key is required in the JSON schema", () => {
    for (const key of NEW_FIELDS) {
      const field = CampaignProposalGenerationSchema.shape[key];
      expect(field.safeParse(undefined).success, key).toBe(false);
    }
    const json = z.toJSONSchema(CampaignProposalGenerationSchema) as { required?: string[] };
    for (const key of NEW_FIELDS) expect(json.required, key).toContain(key);
  });
});

describe("audience and test plan schemas are reusable on their own", () => {
  it("ProposalAudienceSchema parses the sample and ProposalTestPlanSchema parses its sample", () => {
    expect(ProposalAudienceSchema.safeParse(audience).success).toBe(true);
    expect(ProposalTestPlanSchema.safeParse(testPlan).success).toBe(true);
  });
});
