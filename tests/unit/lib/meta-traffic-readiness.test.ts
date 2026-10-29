import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  META_TRAFFIC_READINESS,
  describeTrafficContractState,
  isMetaTrafficReady,
} from "@/lib/campaigns/meta-traffic-readiness";
import { META_OBJECTIVE_CONTRACTS } from "@/lib/campaigns/meta-objective-contracts";
import { META_VERIFIED_BILLING_EVENTS } from "@/lib/connectors/meta-connector-contract";

describe("Website Traffic readiness (Phase 1C-A) — checklist only, nothing is enabled", () => {
  it("Traffic stays verified:false and the connector has no LINK_CLICKS pairing", () => {
    expect(META_OBJECTIVE_CONTRACTS.WEBSITE_TRAFFIC.verified).toBe(false);
    expect(META_OBJECTIVE_CONTRACTS.WEBSITE_TRAFFIC.optimizationGoal).toBe("LINK_CLICKS");
    expect(Object.keys(META_VERIFIED_BILLING_EVENTS)).toEqual(["REACH"]);
    expect(describeTrafficContractState()).toEqual({ verified: false, optimizationGoal: "LINK_CLICKS", connectorSupportsGoal: false });
  });

  it("is NOT ready: open items remain, so verified:true would be unjustified", () => {
    expect(isMetaTrafficReady()).toBe(false);
    const open = META_TRAFFIC_READINESS.filter((item) => item.status === "OPEN").map((item) => item.id);
    expect(open).toEqual(
      expect.arrayContaining(["CONNECTOR_LINK_CLICKS_PAIRING", "OBJECTIVE_GOAL_PAIRING", "BUDGET_UNIT", "CONTROLLED_TEST_ON_TEST_ACCOUNT"]),
    );
  });

  it("the checklist cannot claim readiness while the connector lacks the pairing", () => {
    const pairing = META_TRAFFIC_READINESS.find((item) => item.id === "CONNECTOR_LINK_CLICKS_PAIRING");
    expect(pairing?.status).toBe(describeTrafficContractState().connectorSupportsGoal ? "IMPLEMENTED" : "OPEN");
  });

  it("is frozen and every item has an id, status and note", () => {
    expect(Object.isFrozen(META_TRAFFIC_READINESS)).toBe(true);
    for (const item of META_TRAFFIC_READINESS) {
      expect(item.id).toMatch(/^[A-Z_]+$/);
      expect(["PROVEN_BY_DOCS", "IMPLEMENTED", "OPEN"]).toContain(item.status);
      expect(item.note.length).toBeGreaterThan(10);
    }
  });

  it("does not touch the contract, the connector or any API (static scan)", () => {
    const src = readFileSync("lib/campaigns/meta-traffic-readiness.ts", "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/fetch\(|process\.env|supabase|server-only|graph\.facebook/i);
    expect(code).not.toMatch(/verified:\s*true/);
  });

  it("the old objectives keep their contracts unchanged (no regression)", () => {
    expect(META_OBJECTIVE_CONTRACTS.BRAND_AWARENESS).toEqual({ campaignObjective: "OUTCOME_AWARENESS", optimizationGoal: "REACH", verified: false });
    expect(META_OBJECTIVE_CONTRACTS.WEBSITE_TRAFFIC).toEqual({ campaignObjective: "OUTCOME_TRAFFIC", optimizationGoal: "LINK_CLICKS", verified: false });
  });
});
