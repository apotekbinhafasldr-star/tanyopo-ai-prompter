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

export const metadata: Metadata = { title: "Connections — Tanyopo AI Promoter" };

const ERROR_LABEL: Record<string, string> = {
  owner_required: "Hanya Owner yang dapat menghubungkan atau memutuskan akun.",
  not_available: "Connector ini belum dibangun.",
  not_configured: "Connector belum dikonfigurasi di server (kredensial belum diisi).",
  denied: "Anda membatalkan proses koneksi di Meta.",
  invalid_state: "Sesi koneksi kedaluwarsa atau tidak valid. Silakan coba lagi.",
  no_ad_account: "Tidak ditemukan akun iklan pada akun Meta Anda.",
  save_failed: "Berhasil terhubung ke Meta tapi gagal menyimpan data. Silakan coba lagi.",
  server_not_configured: "Server belum dikonfigurasi untuk menyimpan koneksi (SUPABASE_SECRET_KEY kosong).",
  connect_failed: "Gagal menghubungkan akun Meta. Silakan coba lagi.",
};

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
  const metaConnector = getConnector("META");
  const metaConfigured = metaConnector?.isConfigured() ?? false;
  const metaAccount = accountByPlatform.get("META");

  let metaStatus: ConnectionStatus;
  if (!metaConnector) {
    metaStatus = "NOT_AVAILABLE";
  } else if (!metaConfigured) {
    metaStatus = "NOT_CONFIGURED";
  } else if (!metaAccount) {
    metaStatus = "NOT_CONNECTED";
  } else if (metaAccount.expires_at && new Date(metaAccount.expires_at) < new Date()) {
    metaStatus = "EXPIRED";
  } else {
    metaStatus = metaAccount.status as ConnectionStatus;
  }

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
          Berhasil terhubung ke {connected === "META" ? "Facebook & Instagram" : connected}.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="flex flex-col gap-4 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-[var(--radius-md)] bg-surface-muted">
                  <Share2 className="size-5 text-foreground" aria-hidden />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Facebook &amp; Instagram</p>
                  <p className="text-xs text-muted-foreground">Meta Marketing API</p>
                </div>
              </div>
              <StatusPill status={metaStatus} />
            </div>

            {metaAccount?.external_account_name ? (
              <p className="text-xs text-muted-foreground">
                {metaAccount.external_account_name}
                {metaAccount.last_refreshed_at ? ` · Terhubung ${formatDate(metaAccount.last_refreshed_at)}` : ""}
              </p>
            ) : null}

            {session.role !== "owner" ? (
              <p className="text-xs text-muted-foreground">Hanya Owner yang dapat mengelola koneksi ini.</p>
            ) : metaStatus === "NOT_CONFIGURED" ? (
              <p className="text-xs text-muted-foreground">
                Tambahkan META_APP_ID, META_APP_SECRET, dan META_REDIRECT_URI di server untuk mengaktifkan.
              </p>
            ) : metaStatus === "CONNECTED" || metaStatus === "EXPIRED" || metaStatus === "ACTION_REQUIRED" ? (
              <div className="flex gap-2">
                <Button asChild size="sm" variant="secondary">
                  <a href="/api/connections/meta/authorize">Sambungkan Ulang</a>
                </Button>
                <DisconnectButton platform="META" />
              </div>
            ) : (
              <Button asChild size="sm">
                <a href="/api/connections/meta/authorize">Hubungkan</a>
              </Button>
            )}
          </CardContent>
        </Card>

        <PlaceholderCard
          icon={Music2}
          title="TikTok"
          subtitle="TikTok for Business"
          status="NOT_AVAILABLE"
          note="Connector belum dibangun — direncanakan Phase 6."
        />

        <PlaceholderCard
          icon={XIcon}
          title="X"
          subtitle="X Ads API"
          status="NOT_AVAILABLE"
          note="Connector belum dibangun — direncanakan Phase 6."
        />

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
          note="Direncanakan Phase 4 (integrasi produk)."
        />
      </div>
    </div>
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
