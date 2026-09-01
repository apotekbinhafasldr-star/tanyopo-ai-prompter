import type { AutopilotPolicyType, OptimizationActionType } from "@/types/database";

/**
 * Maps an AI-suggested action to the autopilot policy that must be
 * enabled for it to be auto-submitted to the Approval Center without a
 * manual click. Pure mapping, no Supabase/secrets — directly unit tested.
 * `null` means "no autopilot policy governs this action type," which
 * `NO_ACTION` always is, and is treated the same as "not auto-submittable"
 * by callers.
 */
export function policyTypeForAction(actionType: OptimizationActionType): AutopilotPolicyType | null {
  if (actionType === "PAUSE_CHANNEL") return "AUTO_PAUSE_UNDERPERFORMING";
  if (actionType === "INCREASE_BUDGET" || actionType === "DECREASE_BUDGET") return "AUTO_PROPOSE_BUDGET_REALLOCATION";
  return null;
}
