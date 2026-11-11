import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  checkApprovalThreshold,
  evaluateApprovalThreshold,
  type ApprovalRecordForThreshold,
} from "@/lib/campaigns/approval-threshold";

const explicit = (context: unknown): ApprovalRecordForThreshold => ({
  status: "APPROVED",
  decided_by: "owner-1",
  decided_at: "2026-10-01T01:00:00Z",
  context,
});

describe("evaluateApprovalThreshold", () => {
  it("is not required when no threshold is set (null/undefined)", () => {
    expect(evaluateApprovalThreshold({ threshold: null, dailyBudget: 1e9, totalBudget: 1e12 })).toEqual({ required: false, above: [] });
    expect(evaluateApprovalThreshold({ threshold: undefined, dailyBudget: 1e9, totalBudget: null })).toEqual({ required: false, above: [] });
  });

  it("is required when the daily budget is above the threshold", () => {
    expect(evaluateApprovalThreshold({ threshold: 50_000, dailyBudget: 50_001, totalBudget: null })).toEqual({ required: true, above: ["DAILY"] });
  });

  it("is required when the total budget is above the threshold", () => {
    expect(evaluateApprovalThreshold({ threshold: 500_000, dailyBudget: 10_000, totalBudget: 600_000 })).toEqual({ required: true, above: ["TOTAL"] });
  });

  it("reports both when both are above", () => {
    expect(evaluateApprovalThreshold({ threshold: 1, dailyBudget: 2, totalBudget: 3 }).above).toEqual(["DAILY", "TOTAL"]);
  });

  it("a budget exactly AT the threshold is not above it", () => {
    expect(evaluateApprovalThreshold({ threshold: 50_000, dailyBudget: 50_000, totalBudget: 50_000 }).required).toBe(false);
  });

  it("threshold 0 makes any positive budget require explicit approval", () => {
    expect(evaluateApprovalThreshold({ threshold: 0, dailyBudget: 1, totalBudget: null }).required).toBe(true);
    expect(evaluateApprovalThreshold({ threshold: 0, dailyBudget: null, totalBudget: null }).required).toBe(false);
  });

  it("budgets that are not set are not compared", () => {
    expect(evaluateApprovalThreshold({ threshold: 10, dailyBudget: null, totalBudget: undefined }).required).toBe(false);
  });

  it.each([
    ["negative", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a string", "50000"],
    ["an object", {}],
  ])("an unreadable threshold (%s) fails closed: required", (_label, threshold) => {
    expect(evaluateApprovalThreshold({ threshold, dailyBudget: 1, totalBudget: null }).required).toBe(true);
  });

  it("a budget that is set but not a finite number counts as above (fail closed)", () => {
    expect(evaluateApprovalThreshold({ threshold: 50_000, dailyBudget: Number.NaN, totalBudget: null }).required).toBe(true);
    expect(evaluateApprovalThreshold({ threshold: 50_000, dailyBudget: "10", totalBudget: null }).required).toBe(true);
  });
});

describe("checkApprovalThreshold", () => {
  const base = { threshold: 50_000, dailyBudget: 100_000, totalBudget: null };

  it("not required: always ok, whatever the approval looks like (previous behaviour)", () => {
    expect(checkApprovalThreshold({ ...base, threshold: null, approval: null })).toEqual({ ok: true, required: false });
    expect(checkApprovalThreshold({ ...base, threshold: 100_000, approval: null })).toEqual({ ok: true, required: false });
  });

  it("required + explicit Owner decision covering the budget: ok", () => {
    expect(checkApprovalThreshold({ ...base, approval: explicit({ daily_budget: 100_000, total_budget: null }) })).toEqual({
      ok: true,
      required: true,
    });
  });

  it("required + no approval row: refused", () => {
    const result = checkApprovalThreshold({ ...base, approval: null });
    expect(result).toMatchObject({ ok: false, code: "APPROVAL_NOT_APPROVED" });
  });

  it.each(["PENDING", "REJECTED", "CANCELLED", "EXPIRED", "approved", ""])("required + status %s: refused", (status) => {
    const result = checkApprovalThreshold({ ...base, approval: { ...explicit({ daily_budget: 100_000 }), status } });
    expect(result).toMatchObject({ ok: false, code: "APPROVAL_NOT_APPROVED" });
  });

  it.each([
    ["decided_by null", { decided_by: null }],
    ["decided_by empty", { decided_by: "" }],
    ["decided_at null", { decided_at: null }],
    ["decided_at garbage", { decided_at: "not a date" }],
  ])("required + %s: refused (no recorded Owner decision)", (_label, patch) => {
    const result = checkApprovalThreshold({ ...base, approval: { ...explicit({ daily_budget: 100_000 }), ...patch } });
    expect(result).toMatchObject({ ok: false, code: "APPROVAL_DECISION_MISSING" });
  });

  it("required + approved daily budget below the current daily budget: refused", () => {
    const result = checkApprovalThreshold({ ...base, approval: explicit({ daily_budget: 99_999 }) });
    expect(result).toMatchObject({ ok: false, code: "BUDGET_EXCEEDS_APPROVAL" });
  });

  it("required + approved total budget below the current total budget: refused", () => {
    const result = checkApprovalThreshold({
      ...base,
      totalBudget: 900_000,
      approval: explicit({ daily_budget: 100_000, total_budget: 800_000 }),
    });
    expect(result).toMatchObject({ ok: false, code: "BUDGET_EXCEEDS_APPROVAL" });
  });

  it("required + the approval does not record a budget that the campaign now has: unreadable, refused", () => {
    const missingDaily = checkApprovalThreshold({ ...base, approval: explicit({}) });
    expect(missingDaily).toMatchObject({ ok: false, code: "APPROVAL_BUDGET_UNREADABLE" });
    const missingTotal = checkApprovalThreshold({ ...base, totalBudget: 1, approval: explicit({ daily_budget: 100_000 }) });
    expect(missingTotal).toMatchObject({ ok: false, code: "APPROVAL_BUDGET_UNREADABLE" });
  });

  it.each([null, undefined, "x", 5, [1, 2]])("required + unreadable context %j: refused", (context) => {
    const result = checkApprovalThreshold({ ...base, approval: explicit(context) });
    expect(result).toMatchObject({ ok: false, code: "APPROVAL_BUDGET_UNREADABLE" });
  });

  it("required + a lowered current budget (below what was approved) is fine", () => {
    expect(
      checkApprovalThreshold({ ...base, dailyBudget: 60_000, approval: explicit({ daily_budget: 100_000 }) }),
    ).toEqual({ ok: true, required: true });
  });

  it("required only by the total budget: a daily budget that is not set needs no approved daily value", () => {
    const result = checkApprovalThreshold({
      threshold: 500_000,
      dailyBudget: null,
      totalBudget: 600_000,
      approval: explicit({ daily_budget: null, total_budget: 600_000 }),
    });
    expect(result).toEqual({ ok: true, required: true });
  });

  it("an unreadable threshold requires an explicit decision too", () => {
    const refused = checkApprovalThreshold({ threshold: "oops", dailyBudget: 1, totalBudget: null, approval: { ...explicit({ daily_budget: 1 }), decided_by: null } });
    expect(refused).toMatchObject({ ok: false, code: "APPROVAL_DECISION_MISSING" });
  });

  it("messages are our own Indonesian text and never echo input values", () => {
    const result = checkApprovalThreshold({ ...base, dailyBudget: 123_456_789, approval: explicit({ daily_budget: 1 }) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toContain("123456789");
      expect(result.message).not.toContain("123.456.789");
      expect(result.message).toMatch(/batas persetujuan/);
    }
  });
});

describe("approval-threshold module is pure and cannot launch anything", () => {
  it("has no imports, network, database, environment or gate access", () => {
    const src = readFileSync("lib/campaigns/approval-threshold.ts", "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code.match(/^import .*$/gm)).toBeNull();
    expect(code).not.toMatch(/supabase|process\.env|fetch\(|server-only|graph\.facebook|BUDGET_WRITE_ENABLED_PLATFORMS|connector/i);
  });
});
