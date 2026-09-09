import type { Metadata } from "next";
import Link from "next/link";
import { TrendingUp, Target, Link2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireSessionContext } from "@/services/session";
import { createClient } from "@/lib/supabase/server";
import { channelLabel, formatDate } from "@/lib/utils/format";
import { computeGrowthProgress } from "@/lib/growth-progress";
import { growthPlatforms } from "@/schemas/growth";
import { CHANNEL_TO_CONNECTOR } from "@/lib/connectors/channel-map";
import { GrowthGoalForm } from "@/features/growth/goal-form";
import { FollowerSnapshotForm } from "@/features/growth/snapshot-form";
import { GrowthRecommendationPanel } from "@/features/growth/recommendation-panel";
import type { GrowthPlatform } from "@/types/database";

export const metadata: Metadata = { title: "Growth — LINOE" };

export default async function GrowthPage() {
  const session = await requireSessionContext();
  const supabase = await createClient();

  const [{ data: goals }, { data: snapshots }, { data: connectedAccounts }] = await Promise.all([
    supabase
      .from("prompter_growth_goals")
      .select("platform, target_followers, target_date, notes")
      .eq("tenant_id", session.tenantId),
    supabase
      .from("prompter_follower_snapshots")
      .select("platform, follower_count, recorded_at")
      .eq("tenant_id", session.tenantId)
      .order("recorded_at", { ascending: false })
      .limit(200),
    supabase.from("prompter_connected_accounts").select("platform, status").eq("tenant_id", session.tenantId),
  ]);

  const goalByPlatform = new Map((goals ?? []).map((g) => [g.platform, g]));
  const snapshotsByPlatform = new Map<GrowthPlatform, typeof snapshots>();
  for (const s of snapshots ?? []) {
    const list = snapshotsByPlatform.get(s.platform) ?? [];
    list.push(s);
    snapshotsByPlatform.set(s.platform, list);
  }

  // Honest connector status (Batch B6.2) — same lookup already used on the
  // campaign detail page for channel launchability, never a new/fake
  // connector claim. FACEBOOK and INSTAGRAM both route through the same
  // META connector, so their "connected" status is shared.
  const connectedConnectorPlatforms = new Set(
    (connectedAccounts ?? []).filter((a) => a.status === "CONNECTED").map((a) => a.platform),
  );
  const canWrite = session.role === "owner" || session.role === "marketing";

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 sm:p-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Growth</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pantau pertumbuhan channel bisnis Anda dan dapatkan rekomendasi langkah berikutnya dari LINOE.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <Link2 className="size-4 text-muted-foreground" aria-hidden />
          <CardTitle>Status Channel</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-2">
          <div className="flex flex-col divide-y divide-border rounded-[var(--radius-lg)] border border-border">
            {growthPlatforms.map((p) => {
              const connector = CHANNEL_TO_CONNECTOR[p.value];
              const isConnected = connector ? connectedConnectorPlatforms.has(connector) : false;

              return (
                <div key={p.value} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span className="text-sm font-medium text-foreground">{p.label}</span>
                  <Badge variant={isConnected ? "success" : "neutral"}>
                    {isConnected ? "Terhubung" : "Belum terhubung"}
                  </Badge>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Hubungkan akun untuk sinkronisasi data otomatis. Anda tetap dapat mencatat data secara manual.
            Sinkronisasi otomatis belum tersedia untuk sebagian channel.
          </p>
          <Button asChild size="sm" variant="outline" className="min-h-11 w-full sm:w-auto self-start">
            <Link href="/connections">Hubungkan Channel</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rekomendasi LINOE</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          <GrowthRecommendationPanel />
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Ringkasan Pertumbuhan</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {growthPlatforms.map((p) => {
            const goal = goalByPlatform.get(p.value);
            const history = snapshotsByPlatform.get(p.value as GrowthPlatform) ?? [];
            const latest = history[0] ?? null;
            const progress = goal
              ? computeGrowthProgress({ current: latest?.follower_count ?? null, target: goal.target_followers })
              : null;

            return (
              <Card key={p.value}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                  <CardTitle>{p.label}</CardTitle>
                  {progress?.reached ? <Badge variant="success">Target Tercapai</Badge> : null}
                </CardHeader>
                <CardContent className="flex flex-col gap-3 pt-2">
                  {latest ? (
                    <div>
                      <p className="text-2xl font-semibold text-foreground">
                        {latest.follower_count.toLocaleString("id-ID")}
                      </p>
                      <p className="text-xs text-muted-foreground">Terakhir dicatat {formatDate(latest.recorded_at)}</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm font-medium text-foreground">Belum ada data pertumbuhan.</p>
                      <p className="text-xs text-muted-foreground">
                        Hubungkan channel atau masukkan data awal secara manual.
                      </p>
                    </div>
                  )}

                  {goal ? (
                    <div className="flex flex-col gap-1.5">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted">
                        <div
                          className="h-full rounded-full bg-brand transition-all"
                          style={{ width: `${progress?.percent ?? 0}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Target {goal.target_followers.toLocaleString("id-ID")} follower
                        {goal.target_date ? ` · ${formatDate(goal.target_date)}` : ""}
                        {progress?.percent !== null && progress?.percent !== undefined ? ` · ${progress.percent}%` : ""}
                      </p>
                    </div>
                  ) : (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Target className="size-3.5" aria-hidden />
                      Belum ada target diatur.
                    </p>
                  )}

                  {history.length > 1 ? (
                    <div className="flex flex-col gap-1 border-t border-border pt-2">
                      {history.slice(1, 4).map((s, i) => (
                        <p key={i} className="text-xs text-muted-foreground">
                          {formatDate(s.recorded_at)} — {s.follower_count.toLocaleString("id-ID")} follower
                        </p>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* AUTOMATIC FIRST, MANUAL FALLBACK (Batch B6.3) — existing
          Atur Target Follower / Catat Jumlah Follower functionality is
          fully preserved, just presented as a secondary, collapsed-by-
          default fallback rather than the page's main focus. */}
      <details className="rounded-[var(--radius-lg)] border border-border bg-surface">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 p-4 text-sm font-medium text-foreground">
          <TrendingUp className="size-4 text-muted-foreground" aria-hidden />
          Pencatatan Manual
        </summary>
        <div className="flex flex-col gap-6 border-t border-border p-4">
          <p className="text-xs text-muted-foreground">
            Data otomatis dari channel yang terhubung akan dipakai begitu tersedia. Sampai saat itu, Anda
            tetap bisa mencatat target dan jumlah follower secara manual di sini.
          </p>

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Target className="size-4 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium text-foreground">Atur Target Follower</p>
            </div>
            {canWrite ? (
              <GrowthGoalForm />
            ) : (
              <p className="text-sm text-muted-foreground">Hanya Owner/Marketing yang dapat mengatur target.</p>
            )}
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="size-4 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium text-foreground">Catat Jumlah Follower</p>
            </div>
            {canWrite ? (
              <FollowerSnapshotForm />
            ) : (
              <p className="text-sm text-muted-foreground">Hanya Owner/Marketing yang dapat mencatat data.</p>
            )}
            <p className="text-xs text-muted-foreground">
              Buka halaman profil Anda di {channelLabel("FACEBOOK")}/{channelLabel("INSTAGRAM")}/
              {channelLabel("TIKTOK")}/{channelLabel("X")} untuk melihat jumlah follower saat ini, lalu catat
              di sini. LINOE tidak (dan tidak akan pernah) membeli follower atau memalsukan interaksi.
            </p>
          </div>
        </div>
      </details>
    </div>
  );
}
