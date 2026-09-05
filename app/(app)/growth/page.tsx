import type { Metadata } from "next";
import { TrendingUp, Target } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireSessionContext } from "@/services/session";
import { createClient } from "@/lib/supabase/server";
import { channelLabel, formatDate } from "@/lib/utils/format";
import { computeGrowthProgress } from "@/lib/growth-progress";
import { growthPlatforms } from "@/schemas/growth";
import { GrowthGoalForm } from "@/features/growth/goal-form";
import { FollowerSnapshotForm } from "@/features/growth/snapshot-form";
import type { GrowthPlatform } from "@/types/database";

export const metadata: Metadata = { title: "Growth — LINOE" };

export default async function GrowthPage() {
  const session = await requireSessionContext();
  const supabase = await createClient();

  const [{ data: goals }, { data: snapshots }] = await Promise.all([
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
  ]);

  const goalByPlatform = new Map((goals ?? []).map((g) => [g.platform, g]));
  const snapshotsByPlatform = new Map<GrowthPlatform, typeof snapshots>();
  for (const s of snapshots ?? []) {
    const list = snapshotsByPlatform.get(s.platform) ?? [];
    list.push(s);
    snapshotsByPlatform.set(s.platform, list);
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Growth</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Target dan riwayat pertumbuhan follower Anda — dicatat manual, tanpa bot atau engagement palsu.
          LINOE tidak (dan tidak akan pernah) membeli follower atau memalsukan interaksi.
        </p>
      </div>

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
                <div>
                  <p className="text-2xl font-semibold text-foreground">
                    {latest ? latest.follower_count.toLocaleString("id-ID") : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {latest ? `Terakhir dicatat ${formatDate(latest.recorded_at)}` : "Belum ada data dicatat"}
                  </p>
                </div>

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

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <Target className="size-4 text-muted-foreground" aria-hidden />
          <CardTitle>Atur Target Follower</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {session.role === "owner" || session.role === "marketing" ? (
            <GrowthGoalForm />
          ) : (
            <p className="text-sm text-muted-foreground">Hanya Owner/Marketing yang dapat mengatur target.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <TrendingUp className="size-4 text-muted-foreground" aria-hidden />
          <CardTitle>Catat Jumlah Follower</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {session.role === "owner" || session.role === "marketing" ? (
            <FollowerSnapshotForm />
          ) : (
            <p className="text-sm text-muted-foreground">Hanya Owner/Marketing yang dapat mencatat data.</p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Buka halaman profil Anda di {channelLabel("FACEBOOK")}/{channelLabel("INSTAGRAM")}/
            {channelLabel("TIKTOK")}/{channelLabel("X")} untuk melihat jumlah follower saat ini, lalu catat di
            sini. Tidak ada API penghitung follower organik yang terhubung otomatis hari ini.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
