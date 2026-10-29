import { META_OBJECTIVE_CONTRACTS } from "@/lib/campaigns/meta-objective-contracts";
import { META_VERIFIED_BILLING_EVENTS } from "@/lib/connectors/meta-connector-contract";

/**
 * Website Traffic readiness (Phase 1C-A). A read-only, pure checklist of what
 * is still missing before the Traffic contract may become `verified: true`.
 * It changes nothing: it does not enable LINK_CLICKS, does not touch the
 * contract and calls no API. Each item records WHERE its evidence comes from.
 *
 * PROVEN_BY_DOCS  = stated in Meta's developer documentation.
 * IMPLEMENTED     = enforced by LINOE code before any Meta call.
 * OPEN            = not proven yet; blocks `verified: true`.
 */

export type TrafficReadinessStatus = "PROVEN_BY_DOCS" | "IMPLEMENTED" | "OPEN";

export interface TrafficReadinessItem {
  readonly id: string;
  readonly status: TrafficReadinessStatus;
  readonly note: string;
}

export const META_TRAFFIC_READINESS: readonly TrafficReadinessItem[] = Object.freeze([
  Object.freeze({
    id: "BILLING_EVENT_FOR_LINK_CLICKS",
    status: "PROVEN_BY_DOCS" as const,
    note: "Meta billing-events table: optimization_goal LINK_CLICKS accepts billing_event LINK_CLICKS or IMPRESSIONS. The connector still has NO LINK_CLICKS pairing.",
  }),
  Object.freeze({
    id: "CONNECTOR_LINK_CLICKS_PAIRING",
    status: "OPEN" as const,
    note: "META_VERIFIED_BILLING_EVENTS has only REACH. Adding LINK_CLICKS is deferred until the full Traffic ad set is proven.",
  }),
  Object.freeze({
    id: "OBJECTIVE_GOAL_PAIRING",
    status: "OPEN" as const,
    note: "OUTCOME_TRAFFIC with optimization_goal LINK_CLICKS is not confirmed together with the other required ad-set fields (destination_type, promoted_object) for this payload.",
  }),
  Object.freeze({
    id: "DESTINATION_URL",
    status: "IMPLEMENTED" as const,
    note: "The landing URL is validated by the Meta preflight and the purchase-destination gate before the claim; the approval snapshot must match.",
  }),
  Object.freeze({
    id: "CTA_AND_TARGETING",
    status: "IMPLEMENTED" as const,
    note: "CTA allowlist, age 18-65 and the target country are validated (Phase 1B / MetaCampaignSpec).",
  }),
  Object.freeze({
    id: "BUDGET_UNIT",
    status: "OPEN" as const,
    note: "IDR budget unit is an inference from Meta docs, not proven; the ad-account currency is not verifiable from the launch path yet.",
  }),
  Object.freeze({
    id: "CONTROLLED_TEST_ON_TEST_ACCOUNT",
    status: "OPEN" as const,
    note: "No PAUSED Traffic campaign has been created on a Meta test ad account. Needs separate Founder approval (Phase 1C-B).",
  }),
]);

/** True only if nothing is OPEN. Today it must be false. */
export function isMetaTrafficReady(items: readonly TrafficReadinessItem[] = META_TRAFFIC_READINESS): boolean {
  return items.every((item) => item.status !== "OPEN");
}

/** Consistency facts the tests pin, so the checklist cannot drift from the code. */
export function describeTrafficContractState() {
  const contract = META_OBJECTIVE_CONTRACTS.WEBSITE_TRAFFIC;
  return {
    verified: contract.verified,
    optimizationGoal: contract.optimizationGoal,
    connectorSupportsGoal: Object.prototype.hasOwnProperty.call(META_VERIFIED_BILLING_EVENTS, contract.optimizationGoal),
  };
}
