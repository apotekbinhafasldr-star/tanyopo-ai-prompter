import { describe, expect, it } from "vitest";
import { policyTypeForAction } from "@/lib/autopilot-policy";

describe("policyTypeForAction", () => {
  it("maps PAUSE_CHANNEL to AUTO_PAUSE_UNDERPERFORMING", () => {
    expect(policyTypeForAction("PAUSE_CHANNEL")).toBe("AUTO_PAUSE_UNDERPERFORMING");
  });

  it("maps INCREASE_BUDGET to AUTO_PROPOSE_BUDGET_REALLOCATION", () => {
    expect(policyTypeForAction("INCREASE_BUDGET")).toBe("AUTO_PROPOSE_BUDGET_REALLOCATION");
  });

  it("maps DECREASE_BUDGET to AUTO_PROPOSE_BUDGET_REALLOCATION", () => {
    expect(policyTypeForAction("DECREASE_BUDGET")).toBe("AUTO_PROPOSE_BUDGET_REALLOCATION");
  });

  it("maps NO_ACTION to null — never auto-submittable", () => {
    expect(policyTypeForAction("NO_ACTION")).toBeNull();
  });
});
