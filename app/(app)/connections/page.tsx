import type { Metadata } from "next";
import { Megaphone, Music2, AtSign, Globe, Store } from "lucide-react";
import { getConnectionCenterOverview } from "@/features/connections/actions";
import { ProviderCard } from "@/components/connections/provider-card";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Connection Center — Tanyopo AI Promoter" };

const PROVIDER_META = {
  META: { icon: Megaphone, title: "Facebook & Instagram", description: "Kelola akun dan campaign Meta Ads." },
  TIKTOK: { icon: Music2, title: "TikTok", description: "Kelola akun dan campaign TikTok Ads." },
  X: { icon: AtSign, title: "X", description: "Kelola akun dan campaign X Ads." },
} as const;

const BANNER_MESSAGE: Record<string, string> = {
  NOT_CONFIGURED: "Platform ini belum dikonfigurasi oleh pengelola aplikasi.",
  UNSUPPORTED: "Aksi ini belum didukung untuk platform ini.",
  ERROR: "Gagal menghubungkan akun. Silakan coba lagi.",
  missing_params: "Proses hubungkan akun tidak lengkap. Silakan coba lagi.",
  provider_denied: "Anda membatalkan proses hubungkan akun.",
  FORBIDDEN: "Hanya pemilik akun yang dapat mengelola koneksi platform.",
};

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string; platform?: string }>;
}) {
  const { connected, error } = await searchParams;
  const overview = await getConnectionCenterOverview();

  return (
    <div className="flex flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Connection Center</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Status koneksi selalu jujur — Terhubung hanya ditampilkan jika API benar-benar terverifikasi.
        </p>
      </div>

      {connected ? (
        <p role="status" className="rounded-[var(--radius-md)] bg-success-muted p-3 text-sm text-success">
          Berhasil terhubung ke {connected}.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-[var(--radius-md)] bg-danger-muted p-3 text-sm text-danger">
          {BANNER_MESSAGE[error] ?? "Terjadi kesalahan."}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {overview.providers.map((provider) => {
          const meta = PROVIDER_META[provider.platform];
          return (
            <ProviderCard
              key={provider.platform}
              icon={meta.icon}
              title={meta.title}
              description={meta.description}
              status={provider.status}
              accountName={provider.externalAccountName}
              lastRefreshedAt={provider.lastRefreshedAt}
              capabilities={provider.capabilities}
              connectHref={
                provider.status === "NOT_CONFIGURED" ? null : `/api/connections/${provider.platform.toLowerCase()}/start`
              }
              platformParam={provider.platform}
            />
          );
        })}

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <Globe className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
              <div>
                <CardTitle>Website</CardTitle>
                <CardDescription>URL situs bisnis Anda, untuk pelacakan SEO dan konversi.</CardDescription>
              </div>
            </div>
            <StatusPill status={overview.website.status === "CONFIGURED" ? "CONNECTED" : "NOT_CONFIGURED"} />
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {overview.website.websiteUrl ? (
              <p className="text-sm text-foreground">{overview.website.websiteUrl}</p>
            ) : (
              <p className="text-sm text-muted-foreground">Belum diisi di profil brand Anda.</p>
            )}
            <p className="text-xs text-muted-foreground">
              Pelacakan SEO dan konversi otomatis belum tersedia — direncanakan Phase 5.
            </p>
            <Button asChild variant="outline" size="sm" className="self-start">
              <a href="/onboarding">{overview.website.websiteUrl ? "Ubah di Profil Brand" : "Isi di Profil Brand"}</a>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <Store className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
              <div>
                <CardTitle>UMKMpro AI</CardTitle>
                <CardDescription>Sinkronisasi produk dari UMKMpro AI — arah masuk, tanpa akses langsung ke data POS Anda.</CardDescription>
              </div>
            </div>
            <StatusPill status={overview.umkmproConfigured ? "CONNECTED" : "NOT_CONFIGURED"} />
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {overview.umkmproConfigured
                ? "Token layanan sudah diatur — UMKMpro AI dapat mengirim produk dan konversi secara aman."
                : "UMKMPRO_SERVICE_TOKEN belum diatur oleh pengelola aplikasi."}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
