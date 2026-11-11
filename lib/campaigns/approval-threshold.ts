/**
 * Approval threshold (`prompter_budget_policies.require_approval_above`).
 *
 * The Owner can set a rupiah threshold in Settings ("Minta persetujuan jika
 * biaya melebihi"). Before this module the value was stored and shown but
 * never read. Meaning enforced here:
 *
 *  - A campaign whose daily budget OR total budget is above the threshold is
 *    "above threshold". A threshold that is set but unreadable (negative,
 *    NaN, not a number) is treated as exceeded: fail closed.
 *  - For an above-threshold campaign the launch only proceeds when the latest
 *    CAMPAIGN_LAUNCH approval is an EXPLICIT Owner decision: status APPROVED,
 *    with `decided_by` and `decided_at` recorded, and with the approved budget
 *    (daily AND total, as stored in the approval context) covering the
 *    campaign's current budget. A legacy approval without those facts is
 *    refused and the campaign needs a fresh approval.
 *  - Threshold not set (null) -> no extra requirement (previous behaviour).
 *
 * This NEVER lowers an existing check: the approval itself, Budget Guard, the
 * External Budget Safety Gate (S1) and the budget validator all still run.
 *
 * Pure: no network, database, environment or connector access.
 */

export type ApprovalThresholdFailureCode =
  | "APPROVAL_NOT_APPROVED"
  | "APPROVAL_DECISION_MISSING"
  | "APPROVAL_BUDGET_UNREADABLE"
  | "BUDGET_EXCEEDS_APPROVAL";

export type ApprovalThresholdResult =
  | { ok: true; required: boolean }
  | { ok: false; code: ApprovalThresholdFailureCode; message: string };

export interface ApprovalThresholdEvaluation {
  /** True when the campaign is above the threshold (or the threshold is unreadable). */
  required: boolean;
  /** Which budgets are above the threshold; empty when `required` is false or the threshold itself is unreadable. */
  above: ("DAILY" | "TOTAL")[];
}

export interface ApprovalRecordForThreshold {
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  context: unknown;
}

const MESSAGES: Record<ApprovalThresholdFailureCode, string> = {
  APPROVAL_NOT_APPROVED:
    "Budget campaign di atas batas persetujuan Anda, tetapi belum ada persetujuan Owner yang berstatus Disetujui. Peluncuran dibatalkan.",
  APPROVAL_DECISION_MISSING:
    "Budget campaign di atas batas persetujuan Anda, tetapi persetujuan ini tidak mencatat siapa dan kapan Owner memutuskan. Ajukan persetujuan ulang. Peluncuran dibatalkan.",
  APPROVAL_BUDGET_UNREADABLE:
    "Budget campaign di atas batas persetujuan Anda, tetapi nilai budget pada persetujuan tidak terbaca. Ajukan persetujuan ulang. Peluncuran dibatalkan.",
  BUDGET_EXCEEDS_APPROVAL:
    "Budget campaign di atas batas persetujuan Anda dan melebihi nilai yang disetujui Owner. Ajukan persetujuan ulang. Peluncuran dibatalkan.",
};

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** `null`/`undefined` budget = not set (nothing to compare). Anything else that is not a finite number counts as above. */
function isAbove(budget: unknown, threshold: number): boolean {
  if (budget === null || budget === undefined) return false;
  if (!isFiniteNumber(budget)) return true;
  return budget > threshold;
}

export function evaluateApprovalThreshold(input: {
  threshold: unknown;
  dailyBudget: unknown;
  totalBudget: unknown;
}): ApprovalThresholdEvaluation {
  const { threshold, dailyBudget, totalBudget } = input;
  if (threshold === null || threshold === undefined) return { required: false, above: [] };
  if (!isFiniteNumber(threshold) || threshold < 0) return { required: true, above: [] };

  const above: ("DAILY" | "TOTAL")[] = [];
  if (isAbove(dailyBudget, threshold)) above.push("DAILY");
  if (isAbove(totalBudget, threshold)) above.push("TOTAL");
  return { required: above.length > 0, above };
}

function readContextNumber(context: unknown, key: "daily_budget" | "total_budget"): number | null {
  if (context === null || typeof context !== "object" || Array.isArray(context)) return null;
  const value = (context as Record<string, unknown>)[key];
  return isFiniteNumber(value) ? value : null;
}

function fail(code: ApprovalThresholdFailureCode): ApprovalThresholdResult {
  return { ok: false, code, message: MESSAGES[code] };
}

/** Never echoes an input value. First failing check wins. */
export function checkApprovalThreshold(input: {
  threshold: unknown;
  dailyBudget: unknown;
  totalBudget: unknown;
  /** The latest CAMPAIGN_LAUNCH approval of the master campaign, or null when none was read. */
  approval: ApprovalRecordForThreshold | null;
}): ApprovalThresholdResult {
  const evaluation = evaluateApprovalThreshold(input);
  if (!evaluation.required) return { ok: true, required: false };

  const { approval, dailyBudget, totalBudget } = input;
  if (!approval || approval.status !== "APPROVED") return fail("APPROVAL_NOT_APPROVED");

  const decidedAt = typeof approval.decided_at === "string" ? Date.parse(approval.decided_at) : Number.NaN;
  if (typeof approval.decided_by !== "string" || approval.decided_by.length === 0 || !Number.isFinite(decidedAt)) {
    return fail("APPROVAL_DECISION_MISSING");
  }

  const pairs: [unknown, number | null][] = [
    [dailyBudget, readContextNumber(approval.context, "daily_budget")],
    [totalBudget, readContextNumber(approval.context, "total_budget")],
  ];
  for (const [current, approved] of pairs) {
    if (current === null || current === undefined) continue;
    if (!isFiniteNumber(current) || approved === null) return fail("APPROVAL_BUDGET_UNREADABLE");
    if (current > approved) return fail("BUDGET_EXCEEDS_APPROVAL");
  }
  return { ok: true, required: true };
}
