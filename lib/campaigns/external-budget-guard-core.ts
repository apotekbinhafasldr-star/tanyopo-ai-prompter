import type { ConnectorPlatform } from "@/types/database";

/**
 * INTERNAL core of the External Budget Safety Gate. Do not import this
 * module from production code: it takes the platform allowlist as an
 * argument, which is exactly the injection seam the public gate
 * (`external-budget-guard.ts`) must not expose. Only that module and unit
 * tests may import it (enforced by tests/unit/lib/budget-write-callsites.test.ts).
 */

export type BudgetWriteOperation = "LAUNCH" | "INCREASE_BUDGET" | "DECREASE_BUDGET";

export type BudgetGateCode =
  | "PLATFORM_DISABLED"
  | "EMERGENCY_STOP_ACTIVE"
  | "EMERGENCY_STOP_UNKNOWN"
  | "BUDGET_INVALID"
  | "CURRENCY_UNVERIFIED"
  | "CURRENCY_NOT_IDR"
  | "CURRENCY_MISMATCH"
  | "CURRENT_BUDGET_UNVERIFIED"
  | "DIRECTION_INVALID"
  | "MASTER_TOTAL_UNVERIFIED"
  | "MASTER_TOTAL_EXCEEDED"
  | "BUDGET_GUARD_UNAVAILABLE"
  | "BUDGET_GUARD_REJECTED";

export interface ExternalBudgetWriteRequest {
  operation: BudgetWriteOperation;
  platform: ConnectorPlatform;
  /** `null` = the Emergency Stop flag could not be read. */
  emergencyStopActive: boolean | null;
  /** Currency of the master campaign; `null` when not known to the caller. */
  masterCurrency: string | null;
  /** Currency of the connected ad account; `null` = NOT VERIFIED. */
  accountCurrency: string | null;
  /** Daily budget about to be written (this channel's share), whole units. */
  proposedDailyBudget: number | null;
  /** Budget currently set on the platform for this campaign; `null` = NOT VERIFIED. */
  currentExternalDailyBudget: number | null;
  /** Verified sum of the master's OTHER paid channel budgets; `null` = NOT VERIFIED. */
  otherPaidChannelsDailyTotal: number | null;
  /** The master campaign's total daily budget; `null` when unknown. */
  masterDailyBudget: number | null;
  /** Budget Guard recomputed for this write, or unavailable. */
  budgetGuard: { allowed: boolean } | { unavailable: true };
}

export type BudgetGateResult =
  | { allowed: true }
  | { allowed: false; code: BudgetGateCode; message: string };

export const BUDGET_WRITE_DISABLED_MESSAGE =
  "Perubahan budget ke platform iklan dinonaktifkan sementara demi keamanan (menunggu verifikasi mata uang akun dan satuan budget). Campaign tidak dikirim ke platform.";

const MESSAGES: Record<BudgetGateCode, string> = {
  PLATFORM_DISABLED: BUDGET_WRITE_DISABLED_MESSAGE,
  EMERGENCY_STOP_ACTIVE: "Emergency Stop aktif untuk tenant ini — penulisan budget ke platform iklan diblokir.",
  EMERGENCY_STOP_UNKNOWN: "Status Emergency Stop tidak dapat diverifikasi — penulisan budget ke platform iklan diblokir.",
  BUDGET_INVALID: "Nilai budget tidak valid (harus bilangan bulat minimal 1) — penulisan budget diblokir.",
  CURRENCY_UNVERIFIED: "Mata uang akun iklan belum terverifikasi — penulisan budget diblokir.",
  CURRENCY_NOT_IDR: "Mata uang akun iklan bukan IDR — penulisan budget diblokir.",
  CURRENCY_MISMATCH: "Mata uang akun iklan berbeda dari mata uang campaign — penulisan budget diblokir.",
  CURRENT_BUDGET_UNVERIFIED: "Budget saat ini di platform belum terverifikasi — perubahan budget diblokir.",
  DIRECTION_INVALID: "Arah perubahan budget tidak sesuai dengan tindakan (naik/turun) — perubahan budget diblokir.",
  MASTER_TOTAL_UNVERIFIED: "Total budget campaign induk belum dapat diverifikasi — perubahan budget diblokir.",
  MASTER_TOTAL_EXCEEDED: "Perubahan ini melampaui total budget harian campaign induk — diblokir.",
  BUDGET_GUARD_UNAVAILABLE: "Budget Guard belum dapat dihitung ulang — penulisan budget diblokir.",
  BUDGET_GUARD_REJECTED: "Budget Guard menolak perubahan budget ini.",
};

function deny(code: BudgetGateCode): BudgetGateResult {
  return { allowed: false, code, message: MESSAGES[code] };
}

function isPositiveSafeInteger(value: number | null): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isEmergencyStopSafe(value: unknown): value is false {
  // Fail closed: ONLY the boolean `false` proves Emergency Stop is off.
  return value === false;
}

export function evaluateWithPlatforms(
  request: ExternalBudgetWriteRequest,
  enabledPlatforms: readonly ConnectorPlatform[],
): BudgetGateResult {
  if (!enabledPlatforms.includes(request.platform)) return deny("PLATFORM_DISABLED");

  if ((request.emergencyStopActive as unknown) === true) return deny("EMERGENCY_STOP_ACTIVE");
  if (!isEmergencyStopSafe(request.emergencyStopActive)) return deny("EMERGENCY_STOP_UNKNOWN");

  if (!isPositiveSafeInteger(request.proposedDailyBudget)) return deny("BUDGET_INVALID");

  if (request.accountCurrency === null) return deny("CURRENCY_UNVERIFIED");
  if (request.accountCurrency !== "IDR") return deny("CURRENCY_NOT_IDR");
  if (request.masterCurrency !== request.accountCurrency) return deny("CURRENCY_MISMATCH");

  const isBudgetChange = request.operation === "INCREASE_BUDGET" || request.operation === "DECREASE_BUDGET";

  if (isBudgetChange) {
    if (!isPositiveSafeInteger(request.currentExternalDailyBudget)) return deny("CURRENT_BUDGET_UNVERIFIED");

    const proposed = request.proposedDailyBudget;
    const current = request.currentExternalDailyBudget;
    const directionOk = request.operation === "INCREASE_BUDGET" ? proposed > current : proposed < current;
    if (!directionOk) return deny("DIRECTION_INVALID");

    const other = request.otherPaidChannelsDailyTotal;
    const master = request.masterDailyBudget;
    if (
      typeof other !== "number" ||
      !Number.isFinite(other) ||
      other < 0 ||
      !isPositiveSafeInteger(master)
    ) {
      return deny("MASTER_TOTAL_UNVERIFIED");
    }
    if (other + proposed > master) return deny("MASTER_TOTAL_EXCEEDED");
  }

  if ("unavailable" in request.budgetGuard) return deny("BUDGET_GUARD_UNAVAILABLE");
  if (!request.budgetGuard.allowed) return deny("BUDGET_GUARD_REJECTED");

  return { allowed: true };
}
