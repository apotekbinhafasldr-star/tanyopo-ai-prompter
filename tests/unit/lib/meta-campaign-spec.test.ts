import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  META_SPEC_CTAS,
  META_SPEC_MAX_DAILY_BUDGET_IDR,
  META_SPEC_OBJECTIVES,
  MetaCampaignSpecSchema,
  checkMetaSpecLaunchable,
  parseMetaCampaignSpec,
} from "@/lib/campaigns/meta-campaign-spec";
import { META_OBJECTIVE_CONTRACTS, META_UNSUPPORTED_OBJECTIVES } from "@/lib/campaigns/meta-objective-contracts";
import { resolveMetaObjectivePlan } from "@/lib/campaigns/meta-launch-preflight";
import { BUDGET_WRITE_ENABLED_PLATFORMS } from "@/lib/campaigns/external-budget-guard";

/** The Founder's manual draft: Website Traffic, Indonesia, age 23–50. */
const valid = () => ({
  objective: "WEBSITE_TRAFFIC",
  targeting: { countries: ["ID"], ageMin: 23, ageMax: 50 },
  cta: "LEARN_MORE",
  budget: { currency: "IDR", dailyBudget: 50_000 },
});

function withTargeting(patch: Record<string, unknown>) {
  const v = valid();
  return { ...v, targeting: { ...v.targeting, ...patch } };
}
function withBudget(patch: Record<string, unknown>) {
  const v = valid();
  return { ...v, budget: { ...v.budget, ...patch } };
}

describe("MetaCampaignSpec — valid specifications", () => {
  it("accepts the Founder's Website Traffic draft", () => {
    const r = parseMetaCampaignSpec(valid());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.spec).toEqual(valid());
  });

  it("accepts Brand Awareness, several countries, a duration, equal and boundary ages", () => {
    expect(parseMetaCampaignSpec({ ...valid(), objective: "BRAND_AWARENESS" }).ok).toBe(true);
    expect(parseMetaCampaignSpec(withTargeting({ countries: ["ID", "MY", "SG"] })).ok).toBe(true);
    expect(parseMetaCampaignSpec(withBudget({ durationDays: 30 })).ok).toBe(true);
    expect(parseMetaCampaignSpec(withTargeting({ ageMin: 18, ageMax: 65 })).ok).toBe(true);
    expect(parseMetaCampaignSpec(withTargeting({ ageMin: 30, ageMax: 30 })).ok).toBe(true);
    expect(parseMetaCampaignSpec(withBudget({ dailyBudget: 1 })).ok).toBe(true);
    expect(parseMetaCampaignSpec(withBudget({ dailyBudget: META_SPEC_MAX_DAILY_BUDGET_IDR })).ok).toBe(true);
  });

  it("accepts every allowlisted CTA", () => {
    for (const cta of META_SPEC_CTAS) expect(parseMetaCampaignSpec({ ...valid(), cta }).ok, cta).toBe(true);
  });

  it("the schema and the parser agree", () => {
    expect(MetaCampaignSpecSchema.safeParse(valid()).success).toBe(true);
  });
});

describe("MetaCampaignSpec — invalid targeting", () => {
  it.each([
    ["no countries", { countries: [] }],
    ["too many countries", { countries: ["ID", "MY", "SG", "TH", "VN", "PH"] }],
    ["duplicate countries", { countries: ["ID", "ID"] }],
    ["lowercase code", { countries: ["id"] }],
    ["country name", { countries: ["Indonesia"] }],
    ["unassigned code", { countries: ["ZZ"] }],
    ["non-string code", { countries: [62] }],
    ["countries not an array", { countries: "ID" }],
    ["age below 18", { ageMin: 17 }],
    ["age above 65", { ageMax: 66 }],
    ["min greater than max", { ageMin: 51, ageMax: 50 }],
    ["fractional age", { ageMin: 23.5 }],
    ["string age", { ageMin: "23" }],
    ["NaN age", { ageMin: Number.NaN }],
    ["Infinity age", { ageMax: Number.POSITIVE_INFINITY }],
    ["unknown targeting key (interests)", { interests: ["coffee"] }],
    ["unknown targeting key (gender)", { genders: [1] }],
  ])("rejects %s", (_name, patch) => {
    const r = parseMetaCampaignSpec(withTargeting(patch));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("TARGETING_INVALID");
  });

  it("rejects a missing targeting block", () => {
    const rest = Object.fromEntries(Object.entries(valid()).filter(([key]) => key !== "targeting"));
    expect(parseMetaCampaignSpec(rest)).toMatchObject({ ok: false, code: "TARGETING_INVALID" });
  });
});

describe("MetaCampaignSpec — invalid budget", () => {
  it.each([
    ["zero", { dailyBudget: 0 }],
    ["negative", { dailyBudget: -1 }],
    ["fractional", { dailyBudget: 1.5 }],
    ["numeric string", { dailyBudget: "50000" }],
    ["NaN", { dailyBudget: Number.NaN }],
    ["Infinity", { dailyBudget: Number.POSITIVE_INFINITY }],
    ["above the sanity ceiling", { dailyBudget: META_SPEC_MAX_DAILY_BUDGET_IDR + 1 }],
    ["missing", { dailyBudget: undefined }],
    ["USD currency", { currency: "USD" }],
    ["lowercase currency", { currency: "idr" }],
    ["missing currency", { currency: undefined }],
    ["zero duration", { durationDays: 0 }],
    ["duration too long", { durationDays: 366 }],
    ["fractional duration", { durationDays: 2.5 }],
    ["unknown budget key (lifetime)", { lifetimeBudget: 1_000_000 }],
  ])("rejects %s", (_name, patch) => {
    const r = parseMetaCampaignSpec(withBudget(patch));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("BUDGET_INVALID");
  });

  it("rejects a missing budget block", () => {
    const rest = Object.fromEntries(Object.entries(valid()).filter(([key]) => key !== "budget"));
    expect(parseMetaCampaignSpec(rest)).toMatchObject({ ok: false, code: "BUDGET_INVALID" });
  });
});

describe("MetaCampaignSpec — CTA, objective and strictness", () => {
  it.each(["BUY_NOW", "learn_more", "", null, 5])("rejects CTA %j", (cta) => {
    expect(parseMetaCampaignSpec({ ...valid(), cta })).toMatchObject({ ok: false, code: "CTA_INVALID" });
  });

  it.each(["INCREASE_SALES", "GET_LEADS", "INCREASE_FOLLOWERS", "PROMOTE_APP"])(
    "unsupported objective %s is rejected with its existing reason",
    (objective) => {
      const r = parseMetaCampaignSpec({ ...valid(), objective });
      expect(r).toMatchObject({ ok: false, code: "OBJECTIVE_UNSUPPORTED" });
      if (!r.ok) expect(r.message).toBe(META_UNSUPPORTED_OBJECTIVES[objective]);
    },
  );

  it.each(["SOMETHING_NEW", "website_traffic", "", "constructor", "__proto__", "toString", null, undefined, 3, {}])(
    "unknown objective %j is rejected",
    (objective) => {
      expect(parseMetaCampaignSpec({ ...valid(), objective })).toMatchObject({ ok: false, code: "OBJECTIVE_INVALID" });
    },
  );

  it.each([null, undefined, [], "spec", 5, true])("rejects a non-object input %j without throwing", (input) => {
    expect(parseMetaCampaignSpec(input)).toMatchObject({ ok: false });
  });

  it("rejects unknown top-level keys, so nothing can ride along", () => {
    for (const extra of [{ status: "ACTIVE" }, { accessToken: "x" }, { adAccountId: "act_1" }, { special_ad_categories: [] }]) {
      expect(parseMetaCampaignSpec({ ...valid(), ...extra }), JSON.stringify(extra)).toMatchObject({
        ok: false,
        code: "SPEC_INVALID",
      });
    }
    // An own "__proto__" key from JSON must never become the result's prototype or a smuggled field.
    const body = JSON.stringify(valid()).replace(/^\{/, '{"__proto__":{"status":"ACTIVE"},');
    const r = parseMetaCampaignSpec(JSON.parse(body));
    if (r.ok) {
      expect(Object.getPrototypeOf(r.spec)).toBe(Object.prototype);
      expect(r.spec).not.toHaveProperty("status");
    } else {
      expect(r.code).toBe("SPEC_INVALID");
    }
  });

  it("never echoes the rejected value in its message", () => {
    const secret = "SECRET-TOKEN-123";
    const r = parseMetaCampaignSpec({ ...valid(), accessToken: secret, cta: secret });
    expect(JSON.stringify(r)).not.toContain(secret);
  });

  it("the spec objectives are exactly the objectives that have a contract", () => {
    expect([...META_SPEC_OBJECTIVES].sort()).toEqual(Object.keys(META_OBJECTIVE_CONTRACTS).sort());
  });
});

describe("Traffic Website contract — launch stays blocked (fail-closed)", () => {
  it("has the expected contract and it is NOT verified", () => {
    expect(META_OBJECTIVE_CONTRACTS.WEBSITE_TRAFFIC).toEqual({
      campaignObjective: "OUTCOME_TRAFFIC",
      optimizationGoal: "LINK_CLICKS",
      verified: false,
    });
    expect(Object.isFrozen(META_OBJECTIVE_CONTRACTS.WEBSITE_TRAFFIC)).toBe(true);
    expect(Object.isFrozen(META_OBJECTIVE_CONTRACTS)).toBe(true);
  });

  it("no objective is verified anywhere", () => {
    for (const [name, contract] of Object.entries(META_OBJECTIVE_CONTRACTS)) expect(contract.verified, name).toBe(false);
  });

  it("the preflight rejects WEBSITE_TRAFFIC with OBJECTIVE_UNSUPPORTED and returns no plan", () => {
    const r = resolveMetaObjectivePlan("WEBSITE_TRAFFIC");
    expect(r).toMatchObject({ ok: false, code: "OBJECTIVE_UNSUPPORTED" });
    expect(r.ok).toBe(false);
  });

  it("a fully valid Traffic spec is still not launchable", () => {
    const parsed = parseMetaCampaignSpec(valid());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(checkMetaSpecLaunchable(parsed.spec)).toMatchObject({ ok: false, code: "OBJECTIVE_UNSUPPORTED" });
  });

  it("a valid Brand Awareness spec is not launchable either", () => {
    const parsed = parseMetaCampaignSpec({ ...valid(), objective: "BRAND_AWARENESS" });
    if (parsed.ok) expect(checkMetaSpecLaunchable(parsed.spec)).toMatchObject({ ok: false });
    expect(parsed.ok).toBe(true);
  });

  it("the other locks stay closed: Budget Gate allowlist is empty and the connector only knows REACH", () => {
    expect(BUDGET_WRITE_ENABLED_PLATFORMS).toHaveLength(0);
    const connector = readFileSync("lib/connectors/meta-connector.ts", "utf8");
    expect(connector).toContain('VERIFIED_BILLING_EVENTS: Readonly<Record<string, string>> = Object.freeze({ REACH: "IMPRESSIONS" })');
  });
});

describe("Existing objective behaviour is unchanged", () => {
  it("BRAND_AWARENESS keeps its pair and stays unverified", () => {
    expect(META_OBJECTIVE_CONTRACTS.BRAND_AWARENESS).toEqual({
      campaignObjective: "OUTCOME_AWARENESS",
      optimizationGoal: "REACH",
      verified: false,
    });
    expect(resolveMetaObjectivePlan("BRAND_AWARENESS")).toMatchObject({ ok: false, code: "OBJECTIVE_UNSUPPORTED" });
  });

  it("the other unsupported objectives keep their reasons; WEBSITE_TRAFFIC moved to the contracts", () => {
    for (const key of ["INCREASE_SALES", "GET_LEADS", "INCREASE_FOLLOWERS", "PROMOTE_APP"]) {
      const r = resolveMetaObjectivePlan(key);
      expect(r).toMatchObject({ ok: false, code: "OBJECTIVE_UNSUPPORTED" });
      if (!r.ok) expect(r.message).toBe(META_UNSUPPORTED_OBJECTIVES[key]);
    }
    expect(Object.keys(META_UNSUPPORTED_OBJECTIVES)).not.toContain("WEBSITE_TRAFFIC");
  });

  it("unknown objectives are still OBJECTIVE_UNKNOWN", () => {
    for (const value of ["", "NOPE", "constructor", "__proto__", null, undefined, 3]) {
      expect(resolveMetaObjectivePlan(value), String(value)).toMatchObject({ ok: false, code: "OBJECTIVE_UNKNOWN" });
    }
  });
});

describe("Scope guard — the spec is inert", () => {
  it("imports no connector, database, session, environment or network code", () => {
    const src = readFileSync("lib/campaigns/meta-campaign-spec.ts", "utf8");
    expect(src).not.toMatch(/@\/lib\/(connectors|supabase|env|crypto)|@\/services|"server-only"|"use server"|\bfetch\(|process\.env|graph\.facebook/);
  });

  it("no production code outside the spec module imports it yet (nothing launches through it)", () => {
    for (const f of ["features/campaigns/launch-actions.ts", "lib/connectors/meta-connector.ts", "lib/campaigns/meta-launch-preflight.ts"]) {
      expect(readFileSync(f, "utf8"), f).not.toContain("meta-campaign-spec");
    }
  });

  it("OAuth scopes are unchanged", () => {
    expect(readFileSync("lib/connectors/meta-connector.ts", "utf8")).toContain(
      'const SCOPES = ["ads_management", "ads_read", "business_management", "pages_show_list"];',
    );
  });
});
