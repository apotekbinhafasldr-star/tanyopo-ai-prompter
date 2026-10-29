import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  META_CTA_ALLOWLIST,
  META_DEFAULT_CTA,
  META_TARGETING_MAX_AGE,
  META_TARGETING_MIN_AGE,
  META_VERIFIED_BILLING_EVENTS,
  findVerifiedContractsWithoutConnectorSupport,
  resolveMetaAgeTargeting,
  resolveMetaCtaType,
} from "@/lib/connectors/meta-connector-contract";
import { META_OBJECTIVE_CONTRACTS } from "@/lib/campaigns/meta-objective-contracts";
import {
  META_SPEC_CTAS,
  META_SPEC_MAX_AGE,
  META_SPEC_MIN_AGE,
  META_SPEC_OBJECTIVES,
} from "@/lib/campaigns/meta-campaign-spec";
import { BUDGET_WRITE_ENABLED_PLATFORMS } from "@/lib/campaigns/external-budget-guard";

describe("contract: every VERIFIED objective is supported by the connector", () => {
  it("holds for the shipped contracts (none is verified, so nothing can be orphaned)", () => {
    expect(findVerifiedContractsWithoutConnectorSupport(META_OBJECTIVE_CONTRACTS)).toEqual([]);
  });

  it("negative control: flipping WEBSITE_TRAFFIC to verified WOULD be caught (LINK_CLICKS has no billing event)", () => {
    const flipped = { ...META_OBJECTIVE_CONTRACTS, WEBSITE_TRAFFIC: { ...META_OBJECTIVE_CONTRACTS.WEBSITE_TRAFFIC, verified: true } };
    expect(findVerifiedContractsWithoutConnectorSupport(flipped)).toEqual(["WEBSITE_TRAFFIC"]);
  });

  it("flipping BRAND_AWARENESS is consistent: REACH is supported by the connector", () => {
    const flipped = { ...META_OBJECTIVE_CONTRACTS, BRAND_AWARENESS: { ...META_OBJECTIVE_CONTRACTS.BRAND_AWARENESS, verified: true } };
    expect(findVerifiedContractsWithoutConnectorSupport(flipped)).toEqual([]);
  });

  it("an unknown or prototype-named goal is never treated as supported", () => {
    for (const goal of ["constructor", "__proto__", "toString", "reach", ""]) {
      expect(findVerifiedContractsWithoutConnectorSupport({ X: { optimizationGoal: goal, verified: true } }), goal).toEqual(["X"]);
    }
  });

  it("Traffic stays unverified and the connector still has no LINK_CLICKS pairing (the second lock)", () => {
    expect(META_OBJECTIVE_CONTRACTS.WEBSITE_TRAFFIC.verified).toBe(false);
    expect(Object.keys(META_VERIFIED_BILLING_EVENTS)).toEqual(["REACH"]);
    expect(META_VERIFIED_BILLING_EVENTS).not.toHaveProperty("LINK_CLICKS");
    expect(Object.isFrozen(META_VERIFIED_BILLING_EVENTS)).toBe(true);
  });

  it("the Budget Gate allowlist is empty (the first lock)", () => {
    expect(BUDGET_WRITE_ENABLED_PLATFORMS).toHaveLength(0);
  });
});

describe("contract: MetaCampaignSpec fits the connector", () => {
  it("every spec CTA is an allowlisted connector CTA, and the two lists are identical", () => {
    for (const cta of META_SPEC_CTAS) expect(META_CTA_ALLOWLIST as readonly string[], cta).toContain(cta);
    expect([...META_SPEC_CTAS].sort()).toEqual([...META_CTA_ALLOWLIST].sort());
  });

  it("the spec age bounds equal the connector age bounds", () => {
    expect(META_SPEC_MIN_AGE).toBe(META_TARGETING_MIN_AGE);
    expect(META_SPEC_MAX_AGE).toBe(META_TARGETING_MAX_AGE);
  });

  it("every spec objective has an objective contract", () => {
    for (const objective of META_SPEC_OBJECTIVES) expect(META_OBJECTIVE_CONTRACTS, objective).toHaveProperty(objective);
  });

  it("the connector uses this module and keeps no second copy of the pairings", () => {
    const src = readFileSync("lib/connectors/meta-connector.ts", "utf8");
    expect(src).toContain('from "@/lib/connectors/meta-connector-contract"');
    expect(src).not.toContain('Object.freeze({ REACH');
    expect(src).not.toMatch(/type: "LEARN_MORE"/);
  });

  it("OAuth scopes are unchanged", () => {
    expect(readFileSync("lib/connectors/meta-connector.ts", "utf8")).toContain(
      'const SCOPES = ["ads_management", "ads_read", "business_management", "pages_show_list"];',
    );
  });
});

describe("resolveMetaAgeTargeting", () => {
  it("returns null (adds nothing) when neither age is given", () => {
    expect(resolveMetaAgeTargeting(undefined, undefined)).toEqual({ ok: true, value: null });
  });
  it("returns the Graph field names for a valid range", () => {
    expect(resolveMetaAgeTargeting(23, 50)).toEqual({ ok: true, value: { age_min: 23, age_max: 50 } });
    expect(resolveMetaAgeTargeting(18, 65)).toMatchObject({ ok: true });
    expect(resolveMetaAgeTargeting(40, 40)).toMatchObject({ ok: true });
  });
  it.each([
    [17, 50], [23, 66], [51, 50], [23.5, 50], [Number.NaN, 50], [23, Number.POSITIVE_INFINITY],
    ["23", 50], [null, 50], [23, undefined], [undefined, 50], [{}, 50], [true, 50],
  ])("rejects %j/%j", (min, max) => {
    expect(resolveMetaAgeTargeting(min, max)).toEqual({ ok: false });
  });
});

describe("resolveMetaCtaType", () => {
  it("passes an exact allowlisted value through", () => {
    for (const cta of META_CTA_ALLOWLIST) expect(resolveMetaCtaType(cta)).toBe(cta);
  });
  it("falls back to the default for anything else, never building a type from input", () => {
    for (const value of ["Pelajari Selengkapnya", "shop_now", "BUY_NOW", "", null, undefined, 5, {}, "__proto__", "constructor"]) {
      expect(resolveMetaCtaType(value), String(value)).toBe(META_DEFAULT_CTA);
    }
  });
});

describe("scope guard — the contract module is pure", () => {
  it("imports nothing with side effects", () => {
    const src = readFileSync("lib/connectors/meta-connector-contract.ts", "utf8");
    expect(src).not.toMatch(/^import /m);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bfetch\(|process\.env|server-only|graph\.facebook/);
  });
});
