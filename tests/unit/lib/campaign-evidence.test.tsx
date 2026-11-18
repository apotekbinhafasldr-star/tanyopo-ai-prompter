import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BUDGET_MISSING_NOTE, EVIDENCE_TEXT, isBudgetMissing } from "@/lib/campaigns/evidence";
import { EvidenceLabel } from "@/features/campaigns/evidence-label";

afterEach(cleanup);

describe("isBudgetMissing", () => {
  it("is true only when both budgets are null", () => {
    expect(isBudgetMissing({ daily_budget: null, total_budget: null })).toBe(true);
    expect(isBudgetMissing({ daily_budget: 50000, total_budget: null })).toBe(false);
    expect(isBudgetMissing({ daily_budget: null, total_budget: 500000 })).toBe(false);
  });
  it("treats a zero budget as set (not missing)", () => {
    expect(isBudgetMissing({ daily_budget: 0, total_budget: null })).toBe(false);
  });
  it("the note says proportion, not rupiah", () => {
    expect(BUDGET_MISSING_NOTE).toContain("proporsi");
    expect(BUDGET_MISSING_NOTE).toContain("bukan nominal rupiah");
  });
});

describe("EvidenceLabel", () => {
  it("renders distinct text for each kind and never calls heuristics platform data", () => {
    for (const kind of ["AI", "RULE", "HEURISTIC", "PLATFORM"] as const) {
      cleanup();
      render(<EvidenceLabel kind={kind} />);
      expect(screen.getByTestId(`evidence-${kind.toLowerCase()}`).textContent).toBe(EVIDENCE_TEXT[kind].label);
    }
    expect(EVIDENCE_TEXT.HEURISTIC.hint).toContain("bukan data dari platform");
    expect(EVIDENCE_TEXT.HEURISTIC.label).not.toMatch(/platform/i);
  });
});
