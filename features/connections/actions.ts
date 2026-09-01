"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSessionContext } from "@/services/session";
import { getConnector, isValidConnectorPlatform } from "@/lib/connectors/get-connector";
import { getCapabilities, type CapabilityRow } from "@/lib/connectors/capability-registry";
import { getWebsiteConnectionOverview } from "@/lib/connectors/website-connector";
import { toDisplayStatus } from "@/lib/connectors/status-mapping";
import {
  isAllowedToManageConnections,
  CONNECTION_MANAGEMENT_FORBIDDEN_MESSAGE,
} from "@/lib/connectors/authorize";
import { serverEnv } from "@/lib/env";
import type { ConnectorPlatform } from "@/types/database";
import type { ConnectionStatus } from "@/components/ui/status-pill";

export interface ProviderOverview {
  platform: ConnectorPlatform;
  status: ConnectionStatus;
  externalAccountId: string | null;
  externalAccountName: string | null;
  lastRefreshedAt: string | null;
  capabilities: CapabilityRow[];
}

export interface ConnectionCenterOverview {
  providers: ProviderOverview[];
  website: Awaited<ReturnType<typeof getWebsiteConnectionOverview>>;
  umkmproConfigured: boolean;
}

const PLATFORMS: ConnectorPlatform[] = ["META", "TIKTOK", "X"];

/**
 * Everything the Connection Center page needs, in one read. Never
 * returns CONNECTED for a platform whose credentials aren't configured
 * — see toDisplayStatus above — and never touches the client-inaccessible
 * prompter_oauth_credentials table.
 */
export async function getConnectionCenterOverview(): Promise<ConnectionCenterOverview> {
  const session = await requireSessionContext({ allowIncompleteOnboarding: true });
  const supabase = await createClient();

  const { data: accounts } = await supabase
    .from("prompter_connected_accounts")
    .select("platform, external_account_id, external_account_name, status, last_refreshed_at")
    .eq("tenant_id", session.tenantId);

  const providers: ProviderOverview[] = await Promise.all(
    PLATFORMS.map(async (platform) => {
      const connector = getConnector(platform);
      const account = accounts?.find((a) => a.platform === platform) ?? null;
      const capabilities = await getCapabilities(supabase, platform);

      return {
        platform,
        status: toDisplayStatus(connector.isConfigured(), account?.status ?? null),
        externalAccountId: account?.external_account_id ?? null,
        externalAccountName: account?.external_account_name ?? null,
        lastRefreshedAt: account?.last_refreshed_at ?? null,
        capabilities,
      };
    }),
  );

  const website = await getWebsiteConnectionOverview(supabase, session.tenantId);

  return {
    providers,
    website,
    umkmproConfigured: !!serverEnv.umkmpro.serviceToken,
  };
}

export interface ConnectionActionState {
  error: string | null;
}

export async function disconnectProviderAction(
  _prevState: ConnectionActionState,
  formData: FormData,
): Promise<ConnectionActionState> {
  const platformParam = formData.get("platform");
  if (typeof platformParam !== "string" || !isValidConnectorPlatform(platformParam)) {
    return { error: "Platform tidak dikenal." };
  }

  const session = await requireSessionContext({ allowIncompleteOnboarding: true });
  if (!isAllowedToManageConnections(session.role)) {
    return { error: CONNECTION_MANAGEMENT_FORBIDDEN_MESSAGE };
  }

  const connector = getConnector(platformParam);
  const result = await connector.disconnect(session.tenantId);

  if (!result.ok) {
    return { error: result.message };
  }

  revalidatePath("/connections");
  return { error: null };
}

export async function verifyProviderConnectionAction(
  _prevState: ConnectionActionState,
  formData: FormData,
): Promise<ConnectionActionState> {
  const platformParam = formData.get("platform");
  if (typeof platformParam !== "string" || !isValidConnectorPlatform(platformParam)) {
    return { error: "Platform tidak dikenal." };
  }

  const session = await requireSessionContext({ allowIncompleteOnboarding: true });
  if (!isAllowedToManageConnections(session.role)) {
    return { error: CONNECTION_MANAGEMENT_FORBIDDEN_MESSAGE };
  }

  const connector = getConnector(platformParam);
  const result = await connector.verifyConnection(session.tenantId);

  revalidatePath("/connections");
  return { error: result.ok ? null : result.message };
}
