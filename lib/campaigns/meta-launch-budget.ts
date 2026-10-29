import { resolveMetaBudgetMinorUnits, type MetaCurrencyBudgetUnit } from "@/lib/campaigns/meta-budget-units";

/**
 * Meta launch budget (Phase 1C-A). The ONE place that turns the Owner-approved
 * budget into the number sent to Meta. Pure and fail-closed: no network,
 * database or environment access, and no floating-point money.
 *
 * It refuses the launch (nothing is claimed, nothing is created on Meta) unless:
 *  1. the daily budget the Owner approved is readable from the approval record,
 *  2. the campaign's current daily budget does not exceed that approved value,
 *  3. this channel's share does not exceed the campaign's daily budget,
 *  4. the ad account's currency is VERIFIED and equals the campaign currency,
 *  5. the budget unit for that currency is VERIFIED (never guessed), and
 *  6. the converted amount is a safe positive integer (no overflow, no rounding).
 *
 * The unit table lives in meta-budget-units.ts; IDR is still unverified there,
 * so every launch is refused today (the Budget Gate is closed as well).
 */

export type MetaLaunchBudgetFailureCode =
  | "APPROVAL_BUDGET_UNREADABLE"
  | "BUDGET_EXCEEDS_APPROVAL"
  | "ALLOCATION_INVALID"
  | "AMOUNT_INVALID"
  | "CURRENCY_UNVERIFIED"
  | "CURRENCY_MISMATCH"
  | "CURRENCY_UNSUPPORTED"
  | "UNIT_UNVERIFIED"
  | "AMOUNT_TOO_LARGE";

export type MetaLaunchBudgetResult =
  | { ok: true; value: { minorUnits: number; wholeAmount: number } }
  | { ok: false; code: MetaLaunchBudgetFailureCode; message: string };

const OWN_MESSAGES = {
  APPROVAL_BUDGET_UNREADABLE:
    "Batas budget yang disetujui Owner tidak terbaca pada persetujuan campaign. Peluncuran dibatalkan; ajukan persetujuan ulang.",
  BUDGET_EXCEEDS_APPROVAL:
    "Budget campaign melebihi nilai yang disetujui Owner. Peluncuran dibatalkan; ajukan persetujuan ulang.",
  ALLOCATION_INVALID: "Alokasi budget channel tidak valid atau melebihi budget campaign. Peluncuran dibatalkan.",
} as const;

const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1;

/** Reads `daily_budget` from the approval's stored context; anything but a positive safe integer is unreadable. */
function readApprovedDailyBudget(approvalContext: unknown): number | null {
  if (approvalContext === null || typeof approvalContext !== "object" || Array.isArray(approvalContext)) return null;
  const value = (approvalContext as Record<string, unknown>).daily_budget;
  return isPositiveSafeInteger(value) ? value : null;
}

export function resolveMetaLaunchBudget(
  input: {
    approvalContext: unknown;
    masterDailyBudget: unknown;
    allocatedDailyBudget: unknown;
    masterCurrency: unknown;
    /** Verified currency of the ad account, or null when it could not be verified. */
    accountCurrency: unknown;
  },
  table?: Readonly<Record<string, MetaCurrencyBudgetUnit>>,
): MetaLaunchBudgetResult {
  const approved = readApprovedDailyBudget(input.approvalContext);
  if (approved === null) return { ok: false, code: "APPROVAL_BUDGET_UNREADABLE", message: OWN_MESSAGES.APPROVAL_BUDGET_UNREADABLE };

  const { masterDailyBudget, allocatedDailyBudget } = input;
  if (!isPositiveSafeInteger(masterDailyBudget) || masterDailyBudget > approved) {
    return { ok: false, code: "BUDGET_EXCEEDS_APPROVAL", message: OWN_MESSAGES.BUDGET_EXCEEDS_APPROVAL };
  }
  if (!isPositiveSafeInteger(allocatedDailyBudget) || allocatedDailyBudget > masterDailyBudget) {
    return { ok: false, code: "ALLOCATION_INVALID", message: OWN_MESSAGES.ALLOCATION_INVALID };
  }

  const units = resolveMetaBudgetMinorUnits(
    { wholeAmount: allocatedDailyBudget, campaignCurrency: input.masterCurrency, accountCurrency: input.accountCurrency },
    table,
  );
  if (!units.ok) return units;
  return { ok: true, value: { minorUnits: units.minorUnits, wholeAmount: allocatedDailyBudget } };
}
