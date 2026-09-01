import type { StoredConnectionStatus } from "@/types/database";
import type { ConnectionStatus } from "@/components/ui/status-pill";

/**
 * Maps a connector's credential-configured flag + the stored
 * prompter_connected_accounts.status onto the UI's ConnectionStatus
 * vocabulary. Never returns CONNECTED unless both the app has
 * credentials AND a real connected-account row says so — see
 * docs/INTEGRATIONS.md.
 */
export function toDisplayStatus(
  configured: boolean,
  stored: StoredConnectionStatus | null,
): ConnectionStatus {
  if (!configured) return "NOT_CONFIGURED";
  if (!stored) return "NOT_CONNECTED";
  if (stored === "DISCONNECTED") return "NOT_CONNECTED";
  return stored; // CONNECTED | EXPIRED | ACTION_REQUIRED already match ConnectionStatus
}
