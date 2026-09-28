"use server";

import { getDemoSession } from "@/lib/demo/is-demo-request";
import { DEMO_CAMPAIGN } from "@/lib/demo/dataset";

/**
 * Simulated campaign launch for the demo (Founder hard requirement #4 —
 * advertising safety). Unlike the real
 * features/campaigns/launch-actions.ts#launchChannelCampaignAction, this
 * action:
 *  - never looks up prompter_connected_accounts or any OAuth credential;
 *  - never calls getConnector()/decryptToken() or any connector's
 *    createCampaign/createAdSet/createCreative/createAd;
 *  - never sets a real prompter_channel_campaigns row to ACTIVE;
 *  - makes no outbound network call of any kind.
 *
 * It cannot "accidentally" reach the real path, because a demo session
 * has no tenant_id and no Supabase auth session — the real action's own
 * `requireSessionContext()`/role check would simply fail for it. This
 * action exists only to give the demo UI a realistic-feeling async step
 * with a clearly simulated result.
 */

export interface DemoCampaignLaunchResult {
  campaignId: string;
  status: "ACTIVE_SIMULATED";
  externalCampaignId: string;
  launchedAt: string;
  simulated: true;
}

export async function launchDemoCampaignAction(): Promise<DemoCampaignLaunchResult> {
  // No-op if the demo session already expired -- still returns a
  // simulated result (there is nothing unsafe about it either way, since
  // no real system is ever touched), but keeps the session check present
  // for consistency with every other demo action and for the isolation
  // test suite to assert against.
  await getDemoSession();

  await new Promise((resolve) => setTimeout(resolve, 400));

  return {
    campaignId: DEMO_CAMPAIGN.id,
    status: "ACTIVE_SIMULATED",
    externalCampaignId: `SIMULATED-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    launchedAt: new Date().toISOString(),
    simulated: true,
  };
}
