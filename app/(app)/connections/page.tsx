import type { Metadata } from "next";
import { Share2, Music2, X as XIcon, Globe, Store } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill, type ConnectionStatus } from "@/components/ui/status-pill";
import { requireSessionContext } from "@/services/session";
import { createClient } from "@/lib/supabase/server";
import { getConnector } from "@/lib/connectors/get-connector";
import { getCapabilities, type CapabilityRow } from "@/lib/connectors/capability-registry";
import { PLATFORM_HELP, resolveConnectionView, type ConnectionView } from "@/lib/connectors/connection-readiness";
import { formatDate } from "@/lib/utils/format";
import { DisconnectButton } from "@/features/connections/disconnect-button";
import { MetaPagePicker } from "@/features/connections/meta-page-picker";
import { MetaAdAccountSection } from "@/features/connections/meta-ad-account-section";
import { isFeatureEnabled } from "@/lib/feature-flags";
import type { ConnectorCapability, ConnectorPlatform } from "@/types/database";

export const metadata: Metadata = { title: "Connections — LINOE" };

const ERROR_LABEL: Record<string, string> = {
  owner_required: "Hanya Owner yang dapat menghubungkan atau memutuskan akun.",
  not_available: "Koneksi ini belum tersedia.",
  not_configured: "Koneksi ini belum siap dipakai. Hubungi admin LINOE.",
  denied: "Anda membatalkan proses koneksi.",
  invalid_state: "Sesi koneksi kedaluwarsa atau tidak valid. Silakan coba lagi.",
  no_ad_account: "Tidak ditemukan akun iklan pada akun Anda.",
  save_failed: "Gagal menyimpan koneksi dengan aman. Koneksi belum aktif; silakan coba lagi.",
  encryption_not_configured: "Penyimpanan koneksi yang aman belum siap. Koneksi belum aktif; hubungi admin LINOE.",
  server_not_configured: "Layanan penyimpanan koneksi belum siap. Koneksi belum aktif; hubungi admin LINOE.",
  connect_failed: "Gagal menghubungkan akun. Silakan coba lagi.",
  provider_pending: "Koneksi ini belum dibuka: aplikasi LINOE masih menunggu persetujuan dari penyedia.",
};

const CAPABILITY_LABEL: Record<ConnectorCapability, string> = {
  CONNECT_ACCOUNT: "Hubungkan akun",
  READ_ANALYTICS: "Baca analitik",
  PUBLISH_CONTENT: "Publikasi konten",
  CREATE_CAMPAIGN: "Buat campaign",
  CREATE_AD: "Buat iklan",
  UPDATE_BUDGET: "Ubah budget",
  PAUSE_CAMPAIGN: "Jeda campaign",
};

const CONNECTED_LABEL: Record<ConnectorPlatform, string> = {
  META: "Facebook & Instagram",
  TIKTOK: "TikTok",
  X: "X",
};

const NOT_READY_HINT = "Koneksi ini belum diaktifkan oleh LINOE, jadi tombol Hubungkan belum tersedia. Hubungi admin bila perlu.";

const PLATFORM_INFO: Record<
  ConnectorPlatform,
  { icon: typeof Share2; title: string; subtitle: string; authorizePath: string; notConfiguredHint: string }
> = {
  META: {
    icon: Share2,
    title: "Facebook & Instagram",
    subtitle: "Meta Marketing API",
    authorizePath: "/api/connections/meta/authorize",
    notConfiguredHint: NOT_READY_HINT,
  },
  TIKTOK: {
    icon: Music2,
    title: "TikTok",
    subtitle: "TikTok for Business",
    authorizePath: "/api/connections/tiktok/authorize",
    notConfiguredHint: NOT_READY_HINT,
  },
  X: {
    icon: XIcon,
    title: "X",
    subtitle: "X Ads API",
    authorizePath: "/api/connections/x/authorize",
    notConfiguredHint: "Koneksi X belum aktif dan belum dapat dipakai. Kami akan memberi tahu saat tersedia.",
  },
};

interface ConnectedAccountRow {
  platform: ConnectorPlatform;
  external_account_name: string | null;
  status: string;
  expires_at: string | null;
  last_refreshed_at: string | null;
}

/**
 * Track B Page selection state for the Meta card. It is read in its own
 * query so the base connection status never depends on a column that may not
 * exist in the database yet. `readable: false` means "could not be read" and
 * is NOT the same as "no Page chosen" (`readable: true, name: null`).
 */
type MetaPageSelection = { readable: true; name: string | null } | { readable: false };

function computeView(platform: ConnectorPlatform, account: ConnectedAccountRow | undefined): ConnectionView {
  const connector = getConnector(platform);
  return resolveConnectionView(platform, {
    connectorExists: Boolean(connector),
    configured: connector ? connector.isConfigured() : false,
    account,
  });
}

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const { error, connected } = await searchParams;
  const session = await requireSessionContext();
  const supabase = await createClient();

  // The base read deliberately names no Track B column, so connection status
  // renders correctly against the current production schema.
  const [{ data: connectedAccounts, error: accountsError }, { data: brandProfile }, showRegionalCapabilities] =
    await Promise.all([
      supabase
        .from("prompter_connected_accounts")
        .select("platform, external_account_name, status, expires_at, last_refreshed_at")
        .eq("tenant_id", session.tenantId),
      supabase.from("prompter_brand_profiles").select("country_code").eq("tenant_id", session.tenantId).maybeSingle(),
      isFeatureEnabled(supabase, session.tenantId, "regional_capabilities"),
    ]);

  // A failed read must never be shown as "Belum Terhubung": that would claim
  // the accounts are not connected when the truth is that we could not tell.
  const accountsReadFailed = Boolean(accountsError) || !connectedAccounts;
  if (accountsError) {
    // Code only: never log row data or the full error object.
    console.error("[connections] could not read prompter_connected_accounts", { code: accountsError.code });
  }

  const accountByPlatform = new Map((connectedAccounts ?? []).map((a) => [a.platform, a]));

  let metaPageSelection: MetaPageSelection = { readable: false };
  if (!accountsReadFailed && session.role === "owner" && accountByPlatform.has("META")) {
    const { data: pageRow, error: pageError } = await supabase
      .from("prompter_connected_accounts")
      .select("selected_page_name")
      .eq("tenant_id", session.tenantId)
      .eq("platform", "META")
      .maybeSingle();
    if (!pageError && pageRow) {
      metaPageSelection = { readable: true, name: pageRow.selected_page_name ?? null };
    }
  }

  const capabilitiesByPlatform = showRegionalCapabilities
    ? new Map(
        await Promise.all(
          (["META", "TIKTOK", "X"] as const).map(
            async (platform) => [platform, await getCapabilities(supabase, platform, brandProfile?.country_code ?? undefined)] as const,
          ),
        ),
      )
    : new Map<ConnectorPlatform, CapabilityRow[]>();

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Connections</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Status di sini selalu jujur — CONNECTED hanya jika API benar-benar terhubung.
        </p>
      </div>

      {error ? (
        <div role="alert" className="rounded-[var(--radius-md)] bg-danger-muted p-4 text-sm text-danger">
          {ERROR_LABEL[error] ?? "Terjadi kesalahan. Silakan coba lagi."}
        </div>
      ) : null}
      {connected ? (
        <div role="status" className="rounded-[var(--radius-md)] bg-success-muted p-4 text-sm text-success">
          {CONNECTED_LABEL[connected as ConnectorPlatform]
            ? `Berhasil terhubung ke ${CONNECTED_LABEL[connected as ConnectorPlatform]}.`
            : "Berhasil terhubung."}
        </div>
      ) : null}

      {accountsReadFailed ? (
        <div role="alert" className="rounded-[var(--radius-md)] bg-danger-muted p-4 text-sm text-danger">
          Status koneksi tidak dapat dibaca saat ini, jadi tidak ditampilkan. Ini bukan berarti akun Anda belum
          terhubung. Muat ulang halaman; jika masalah berlanjut, hubungi admin.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {accountsReadFailed
          ? null
          : (["META", "TIKTOK", "X"] as const).map((platform) => (
              <ConnectorCard
                key={platform}
                platform={platform}
                account={accountByPlatform.get(platform)}
                isOwner={session.role === "owner"}
                capabilities={capabilitiesByPlatform.get(platform)}
                metaPageSelection={metaPageSelection}
              />
            ))}

        <PlaceholderCard
          icon={Globe}
          title="Website"
          subtitle="SEO & tracking"
          status="NOT_AVAILABLE"
          note="Website bukan koneksi OAuth — kelola rekomendasi SEO untuk situs Anda di halaman SEO."
        />

        <PlaceholderCard
          icon={Store}
          title="UMKMpro AI"
          subtitle="Product handoff"
          status="NOT_AVAILABLE"
          note="Bukan koneksi per-tenant — produk disinkronkan otomatis lewat API bertanda tangan saat UMKMpro AI mengirim data, tidak ada tombol Hubungkan di sini."
        />
      </div>
    </div>
  );
}

function ConnectorCard({
  platform,
  account,
  isOwner,
  capabilities,
  metaPageSelection,
}: {
  platform: ConnectorPlatform;
  account: ConnectedAccountRow | undefined;
  isOwner: boolean;
  capabilities?: CapabilityRow[];
  metaPageSelection: MetaPageSelection;
}) {
  const info = PLATFORM_INFO[platform];
  const Icon = info.icon;
  const { status, canStartOauth } = computeView(platform, account);
  const help = PLATFORM_HELP[platform];
  const hasStoredConnection = status === "CONNECTED" || status === "RECONNECT_REQUIRED";

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-surface-muted">
              <Icon className="size-5 text-foreground" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">{info.title}</p>
              <p className="text-xs text-muted-foreground">{info.subtitle}</p>
            </div>
          </div>
          <StatusPill status={status} />
        </div>

        {account?.external_account_name ? (
          <p className="break-words text-xs text-muted-foreground">
            {account.external_account_name}
            {account.last_refreshed_at ? ` · Terhubung ${formatDate(account.last_refreshed_at)}` : ""}
          </p>
        ) : null}

        {help ? (
          <dl className="flex flex-col gap-2 text-xs text-muted-foreground">
            <div>
              <dt className="font-medium text-foreground">Posting organik</dt>
              <dd>{help.organic}</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">Iklan</dt>
              <dd>{help.ads}</dd>
            </div>
          </dl>
        ) : null}

        {!isOwner ? (
          <p className="text-xs text-muted-foreground">Hanya Owner yang dapat mengelola koneksi ini.</p>
        ) : status === "NOT_CONFIGURED" ? (
          <p className="text-xs text-muted-foreground">{info.notConfiguredHint}</p>
        ) : hasStoredConnection ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              {canStartOauth ? (
                <Button asChild size="sm" variant="secondary">
                  <a href={info.authorizePath}>Sambungkan Ulang</a>
                </Button>
              ) : (
                <Button size="sm" variant="secondary" disabled aria-disabled="true">
                  Sambungkan Ulang
                </Button>
              )}
              <DisconnectButton platform={platform} />
            </div>
            {!canStartOauth ? (
              <p className="text-xs text-muted-foreground">
                Menyambungkan ulang belum tersedia untuk {info.title}. Anda tetap dapat memutuskan koneksi.
              </p>
            ) : null}
          </div>
        ) : canStartOauth ? (
          <Button asChild size="sm">
            <a href={info.authorizePath}>Hubungkan</a>
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            <div>
              <Button size="sm" disabled aria-disabled="true">
                Hubungkan
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {status === "PROVIDER_PENDING"
                ? `Menunggu persetujuan dari penyedia. Tombol Hubungkan aktif setelah ${info.title} menyetujui aplikasi LINOE dan alur otorisasi tersedia.`
                : `Alur koneksi ${info.title} belum tersedia di LINOE.`}
            </p>
          </div>
        )}

        {platform === "META" && isOwner && hasStoredConnection ? (
          metaPageSelection.readable ? (
            <MetaPagePicker selectedPageName={metaPageSelection.name} />
          ) : (
            <p className="border-t border-border pt-3 text-xs text-muted-foreground">
              Pemilihan Facebook Page belum tersedia saat ini. Status koneksi di atas tidak terpengaruh.
            </p>
          )
        ) : null}

        {platform === "META" && isOwner && status === "CONNECTED" ? (
          <MetaAdAccountSection currentAccountName={account?.external_account_name ?? null} />
        ) : null}

        {capabilities && capabilities.length > 0 ? (
          <div className="border-t border-border pt-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Kapabilitas {capabilities[0]?.countryCode ? `(${capabilities[0].countryCode})` : "(global)"}
            </p>
            <ul className="flex flex-col gap-1">
              {capabilities.map((cap) => (
                <li key={cap.capability} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 text-muted-foreground">{CAPABILITY_LABEL[cap.capability] ?? cap.capability}</span>
                  <StatusPill status={capabilityStatusToPill(cap.status)} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function capabilityStatusToPill(status: CapabilityRow["status"]): ConnectionStatus {
  switch (status) {
    case "SUPPORTED":
      return "CONNECTED";
    case "REQUIRES_APPROVAL":
      return "ACTION_REQUIRED";
    case "BLOCKED_EXTERNAL":
      return "BLOCKED_EXTERNAL";
    case "UNSUPPORTED":
      return "NOT_AVAILABLE";
    case "NOT_CONFIGURED":
    default:
      return "NOT_CONFIGURED";
  }
}

function PlaceholderCard({
  icon: Icon,
  title,
  subtitle,
  status,
  note,
}: {
  icon: typeof Share2;
  title: string;
  subtitle: string;
  status: ConnectionStatus;
  note: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-surface-muted">
              <Icon className="size-5 text-foreground" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">{title}</p>
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            </div>
          </div>
          <StatusPill status={status} />
        </div>
        <p className="text-xs text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );
}
