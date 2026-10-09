import type { ConnectorPlatform } from "@/types/database";

/**
 * External Budget Safety Gate (S1) — DEFAULT DENY.
 *
 * Every code path that writes a budget to an external ad platform
 * (`createCampaign` / `createAdSet` on launch, `updateBudget` from an
 * approved autopilot action) must pass `evaluateExternalBudgetWrite` first.
 * The gate is a pure function of server-derived evidence: it reads no
 * environment, no session, no database, and accepts nothing from the client.
 * Nobody, including an account owner, can open it at runtime.
 *
 * Two independent locks, both closed today:
 *  1. `BUDGET_WRITE_ENABLED_PLATFORMS` is empty — a platform must be added
 *     here in code (a reviewed change) before it can write a budget.
 *  2. Even then, the evidence (ad-account currency, the current external
 *     budget) must be verified, and no code produces that evidence yet.
 *     Unverified (`null`) evidence is always a denial.
 *
 * Which checks run, in order (first failure wins, so results are
 * deterministic):
 *  platform → emergency stop → budget value → account currency →
 *  current external budget → direction → master total → Budget Guard.
 *
 * tests/unit/lib/budget-write-callsites.test.ts asserts that only the two
 * known call sites reach the connector budget methods and that each calls
 * this gate first.
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

/**
 * Platforms allowed to write a budget externally. EMPTY BY DEFAULT: every
 * platform is denied. Changing this is a code change that needs review, and
 * the evidence checks below still apply.
 */
export const BUDGET_WRITE_ENABLED_PLATFORMS: readonly ConnectorPlatform[] = [];

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

export function isBudgetWritePlatformEnabled(
  platform: ConnectorPlatform,
  enabledPlatforms: readonly ConnectorPlatform[] = BUDGET_WRITE_ENABLED_PLATFORMS,
): boolean {
  return enabledPlatforms.includes(platform);
}

/**
 * `enabledPlatforms` exists only so the pure function can be unit tested
 * with a platform enabled. Production call sites never pass it (asserted by
 * the call-site architecture test).
 */
export function evaluateExternalBudgetWrite(
  request: ExternalBudgetWriteRequest,
  enabledPlatforms: readonly ConnectorPlatform[] = BUDGET_WRITE_ENABLED_PLATFORMS,
): BudgetGateResult {
  if (!isBudgetWritePlatformEnabled(request.platform, enabledPlatforms)) return deny("PLATFORM_DISABLED");

  if (request.emergencyStopActive === null) return deny("EMERGENCY_STOP_UNKNOWN");
  if (request.emergencyStopActive) return deny("EMERGENCY_STOP_ACTIVE");

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
