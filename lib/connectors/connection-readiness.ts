import type { ConnectorPlatform } from "@/types/database";

/**
 * Pure (no server-only / no I/O) model of what the Connections page and the
 * authorize routes may offer for each platform. One place decides, so the page
 * and the route can never disagree, and the default for anything unknown is
 * "do not offer".
 *
 * Status vocabulary shown to the customer (never "ready" without evidence):
 *  - CONNECTED           a stored connection exists, is CONNECTED and not expired
 *  - NOT_CONNECTED       OAuth can really be started right now
 *  - NOT_CONFIGURED      the server has no usable credentials / the flow is switched off
 *  - PROVIDER_PENDING    the provider (e.g. TikTok) has not approved our app yet
 *  - RECONNECT_REQUIRED  a stored connection exists but is expired / needs action
 *  - NOT_AVAILABLE       no connector, or its OAuth flow is not built in this app
 */
export type ConnectionViewStatus =
  | "CONNECTED"
  | "NOT_CONNECTED"
  | "NOT_CONFIGURED"
  | "PROVIDER_PENDING"
  | "RECONNECT_REQUIRED"
  | "NOT_AVAILABLE";

/**
 * Whether the provider's own approval gates the connection.
 *  - NOT_TRACKED: no provider approval is modelled for this platform (Meta today, X organic).
 *  - PENDING:     provider approval is required and has NOT been granted (EXTERNAL BLOCKED).
 *  - GRANTED:     provider approval was granted. Only set with written evidence.
 */
export type ProviderApproval = "NOT_TRACKED" | "PENDING" | "GRANTED";

export interface ProviderGate {
  approval: ProviderApproval;
  /**
   * True only when a working OAuth start + callback exists in THIS app for
   * the platform. For X this stays true and the real switch is
   * `XConnector.isConfigured()` (which includes the fail-closed PKCE flag),
   * so there is a single switch to flip, not two.
   */
  oauthFlowAvailable: boolean;
}

/**
 * Fail-closed defaults. Changing a value here is a product decision that needs
 * the Founder's approval phrase and evidence (see docs/TIKTOK_INTEGRATION.md).
 *
 * TIKTOK: the Open API v2 client (Login Kit / Content Posting) is not wired to
 * any route, and the Marketing API OAuth was never verified against the
 * provider (official docs unreachable, app approval not granted) -> no flow,
 * approval PENDING.
 */
export const PROVIDER_GATES: Readonly<Record<ConnectorPlatform, ProviderGate>> = {
  META: { approval: "NOT_TRACKED", oauthFlowAvailable: true },
  TIKTOK: { approval: "PENDING", oauthFlowAvailable: false },
  X: { approval: "NOT_TRACKED", oauthFlowAvailable: true },
};

export interface ConnectionAccountInput {
  status: string;
  expires_at: string | null;
}

export interface ConnectionView {
  status: ConnectionViewStatus;
  /** True only when starting OAuth (Hubungkan / Sambungkan Ulang) is really possible. */
  canStartOauth: boolean;
}

/** The single rule for "may an OAuth flow be started for this platform now". */
export function canStartOauth(
  platform: ConnectorPlatform,
  input: { connectorExists: boolean; configured: boolean },
  gates: Readonly<Record<ConnectorPlatform, ProviderGate>> = PROVIDER_GATES,
): boolean {
  const gate = gates[platform];
  if (!gate) return false;
  return input.connectorExists && input.configured && gate.oauthFlowAvailable && gate.approval !== "PENDING";
}

function isExpired(expiresAt: string | null, now: Date): boolean {
  if (!expiresAt) return false;
  const t = new Date(expiresAt).getTime();
  // An unparseable date is never treated as "still valid".
  return Number.isNaN(t) || t < now.getTime();
}

export function resolveConnectionView(
  platform: ConnectorPlatform,
  input: {
    connectorExists: boolean;
    configured: boolean;
    account: ConnectionAccountInput | undefined;
    now?: Date;
  },
  gates: Readonly<Record<ConnectorPlatform, ProviderGate>> = PROVIDER_GATES,
): ConnectionView {
  const gate = gates[platform];
  const startable = canStartOauth(platform, input, gates);

  if (!input.connectorExists || !gate) return { status: "NOT_AVAILABLE", canStartOauth: false };
  if (!input.configured) return { status: "NOT_CONFIGURED", canStartOauth: false };

  const account = input.account;
  if (account && account.status !== "DISCONNECTED") {
    const live = account.status === "CONNECTED" && !isExpired(account.expires_at, input.now ?? new Date());
    return { status: live ? "CONNECTED" : "RECONNECT_REQUIRED", canStartOauth: startable };
  }

  if (gate.approval === "PENDING") return { status: "PROVIDER_PENDING", canStartOauth: false };
  if (!gate.oauthFlowAvailable) return { status: "NOT_AVAILABLE", canStartOauth: false };
  return { status: "NOT_CONNECTED", canStartOauth: startable };
}

export interface PlatformHelp {
  /** What organic posting can/cannot do today. */
  organic: string;
  /** What paid ads can/cannot do today. */
  ads: string;
}

/**
 * Customer-facing explanation per platform. Rules (enforced by tests): no
 * claim of readiness, organic posting and ads are described separately, and
 * every blocker is named. Meta has no entry: its card is unchanged.
 */
export const PLATFORM_HELP: Readonly<Partial<Record<ConnectorPlatform, PlatformHelp>>> = {
  TIKTOK: {
    organic:
      "Belum tersedia. Posting video organik lewat TikTok (Login Kit + Content Posting API) butuh persetujuan aplikasi dan izin dari TikTok. Sebelum TikTok mengaudit aplikasi, posting hanya bisa privat (hanya Anda yang melihat).",
    ads:
      "Belum tersedia. Akses iklan butuh persetujuan TikTok for Business, dan pembuatan ad group serta creative TikTok belum didukung di LINOE.",
  },
  X: {
    organic:
      "Belum tersedia. Kode untuk posting teks, gambar, dan video ke akun X sudah ada tetapi belum diaktifkan, dan belum ada tombol posting di LINOE. Pemakaian API X dikenai biaya dari X.",
    ads: "Tidak didukung. X Ads API butuh persetujuan akses Ads dari X dan otorisasi yang berbeda dari koneksi ini.",
  },
};
