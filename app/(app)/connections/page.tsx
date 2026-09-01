import type { Metadata } from "next";
import { Share2, Music2, X as XIcon, Globe, Store } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill, type ConnectionStatus } from "@/components/ui/status-pill";
import { requireSessionContext } from "@/services/session";
import { createClient } from "@/lib/supabase/server";
import { getConnector } from "@/lib/connectors/get-connector";
import { formatDate } from "@/lib/utils/format";
import { DisconnectButton } from "@/features/connections/disconnect-button";
import type { ConnectorPlatform } from "@/types/database";

export const metadata: Metadata = { title: "Connections — Tanyopo AI Promoter" };

const ERROR_LABEL: Record<string, string> = {
  owner_required: "Hanya Owner yang dapat menghubungkan atau memutuskan akun.",
  not_available: "Connector ini belum dibangun.",
  not_configured: "Connector belum dikonfigurasi di server (kredensial belum diisi).",
  denied: "Anda membatalkan proses koneksi.",
  invalid_state: "Sesi koneksi kedaluwarsa atau tidak valid. Silakan coba lagi.",
  no_ad_account: "Tidak ditemukan akun iklan pada akun Anda.",
  save_failed: "Berhasil terhubung tapi gagal menyimpan data. Silakan coba lagi.",
  server_not_configured: "Server belum dikonfigurasi untuk menyimpan koneksi (SUPABASE_SECRET_KEY kosong).",
  connect_failed: "Gagal menghubungkan akun. Silakan coba lagi.",
};

const CONNECTED_LABEL: Record<ConnectorPlatform, string> = {
  META: "Facebook & Instagram",
  TIKTOK: "TikTok",
  X: "X",
};

const PLATFORM_INFO: Record<
  ConnectorPlatform,
  { icon: typeof Share2; title: string; subtitle: string; authorizePath: string; notConfiguredHint: string }
> = {
  META: {
    icon: Share2,
    title: "Facebook & Instagram",
    subtitle: "Meta Marketing API",
    authorizePath: "/api/connections/meta/authorize",
    notConfiguredHint: "Tambahkan META_APP_ID, META_APP_SECRET, dan META_REDIRECT_URI di server untuk mengaktifkan.",
  },
  TIKTOK: {
    icon: Music2,
    title: "TikTok",
    subtitle: "TikTok for Business",
    authorizePath: "/api/connections/tiktok/authorize",
    notConfiguredHint:
      "Tambahkan TIKTOK_APP_ID, TIKTOK_APP_SECRET, dan TIKTOK_REDIRECT_URI di server untuk mengaktifkan.",
  },
  X: {
    icon: XIcon,
    title: "X",
    subtitle: "X Ads API",
    authorizePath: "/api/connections/x/authorize",
    notConfiguredHint: "Tambahkan X_CLIENT_ID, X_CLIENT_SECRET, dan X_REDIRECT_URI di server untuk mengaktifkan.",
  },
};

interface ConnectedAccountRow {
  platform: ConnectorPlatform;
  external_account_name: string | null;
  status: string;
  expires_at: string | null;
  last_refreshed_at: string | null;
}

function computeStatus(platform: ConnectorPlatform, account: ConnectedAccountRow | undefined): ConnectionStatus {
  const connector = getConnector(platform);
  if (!connector) return "NOT_AVAILABLE";
  if (!connector.isConfigured()) return "NOT_CONFIGURED";
  if (!account) return "NOT_CONNECTED";
  if (account.expires_at && new Date(account.expires_at) < new Date()) return "EXPIRED";
  return account.status as ConnectionStatus;
}

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const { error, connected } = await searchParams;
  const session = await requireSessionContext();
  const supabase = await createClient();

  const { data: connectedAccounts } = await supabase
    .from("prompter_connected_accounts")
    .select("platform, external_account_name, status, expires_at, last_refreshed_at")
    .eq("tenant_id", session.tenantId);

  const accountByPlatform = new Map((connectedAccounts ?? []).map((a) => [a.platform, a]));

  return (
    <div className="flex flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Connections</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Status di sini selalu jujur — CONNECTED hanya jika API benar-benar terhubung.
        </p>
      </div>

      {error ? (
        <div className="rounded-[var(--radius-md)] bg-danger-muted p-4 text-sm text-danger">
          {ERROR_LABEL[error] ?? "Terjadi kesalahan."}
        </div>
      ) : null}
      {connected ? (
        <div className="rounded-[var(--radius-md)] bg-success-muted p-4 text-sm text-success">
          Berhasil terhubung ke {CONNECTED_LABEL[connected as ConnectorPlatform] ?? connected}.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {(["META", "TIKTOK", "X"] as const).map((platform) => (
          <ConnectorCard
            key={platform}
            platform={platform}
            account={accountByPlatform.get(platform)}
            isOwner={session.role === "owner"}
          />
        ))}

        <PlaceholderCard
          icon={Globe}
          title="Website"
          subtitle="SEO & tracking"
          status="NOT_AVAILABLE"
          note="Direncanakan Phase 5 (SEO)."
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
}: {
  platform: ConnectorPlatform;
  account: ConnectedAccountRow | undefined;
  isOwner: boolean;
}) {
  const info = PLATFORM_INFO[platform];
  const Icon = info.icon;
  const status = computeStatus(platform, account);

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-[var(--radius-md)] bg-surface-muted">
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
          <p className="text-xs text-muted-foreground">
            {account.external_account_name}
            {account.last_refreshed_at ? ` · Terhubung ${formatDate(account.last_refreshed_at)}` : ""}
          </p>
        ) : null}

        {!isOwner ? (
          <p className="text-xs text-muted-foreground">Hanya Owner yang dapat mengelola koneksi ini.</p>
        ) : status === "NOT_CONFIGURED" ? (
          <p className="text-xs text-muted-foreground">{info.notConfiguredHint}</p>
        ) : status === "CONNECTED" || status === "EXPIRED" || status === "ACTION_REQUIRED" ? (
          <div className="flex gap-2">
            <Button asChild size="sm" variant="secondary">
              <a href={info.authorizePath}>Sambungkan Ulang</a>
            </Button>
            <DisconnectButton platform={platform} />
          </div>
        ) : (
          <Button asChild size="sm">
            <a href={info.authorizePath}>Hubungkan</a>
          </Button>
        )}
      </CardContent>
    </Card>
  );
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
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-[var(--radius-md)] bg-surface-muted">
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
