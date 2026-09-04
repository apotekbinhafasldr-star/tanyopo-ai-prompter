import type { Metadata } from "next";
import { BarChart3, TrendingUp, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { requireSessionContext } from "@/services/session";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate } from "@/lib/utils/format";
import { sumByCurrency } from "@/lib/fx/convert";
import { ConversionForm } from "@/features/analytics/conversion-form";
import { GenerateInsightButton } from "@/features/analytics/generate-insight-button";

export const metadata: Metadata = { title: "Analytics — LINOE" };

const EVENT_LABEL: Record<string, string> = {
  LEAD: "Lead",
  SIGNUP: "Signup",
  ADD_TO_CART: "Add to Cart",
  CHECKOUT: "Checkout",
  PURCHASE: "Purchase",
  SUBSCRIPTION: "Subscription",
};

export default async function AnalyticsPage() {
  const session = await requireSessionContext();
  const supabase = await createClient();

  const [{ data: metrics }, { data: conversions }, { data: campaigns }, { data: insight }] = await Promise.all([
    supabase
      .from("prompter_marketing_metrics")
      .select("id")
      .eq("tenant_id", session.tenantId)
      .limit(1),
    supabase
      .from("prompter_conversions")
      .select("id, event_type, value, currency, customer_reference, occurred_at, master_campaign_id")
      .eq("tenant_id", session.tenantId)
      .order("occurred_at", { ascending: false })
      .limit(50),
    supabase
      .from("prompter_master_campaigns")
      .select("id, name")
      .eq("tenant_id", session.tenantId)
      .order("created_at", { ascending: false }),
    supabase
      .from("prompter_analytics_insights")
      .select("*")
      .eq("tenant_id", session.tenantId)
      .maybeSingle(),
  ]);

  const campaignNameById = new Map((campaigns ?? []).map((c) => [c.id, c.name]));
  // Grouped by currency, never summed across currencies (product spec
  // §13) — no FX provider is configured, so a blind sum across e.g. IDR
  // and USD conversions would silently misreport the total.
  const conversionTotalsByCurrency = sumByCurrency(
    conversions ?? [],
    (c) => c.currency,
    (c) => c.value,
  );
  const hasRealMetrics = (metrics ?? []).length > 0;
  const hasAnyData = hasRealMetrics || (conversions ?? []).length > 0;
  const trends = (insight?.trends as { metric: string; observation: string; direction: string }[] | undefined) ?? [];
  const risks = (insight?.risks as string[] | undefined) ?? [];
  const underperforming = (insight?.underperforming_channels as string[] | undefined) ?? [];

  return (
    <div className="flex flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Spend dan performa iklan aktif setelah channel terhubung (Phase 3). Konversi bisa dicatat manual
          sejak sekarang.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <BarChart3 className="size-4 text-muted-foreground" aria-hidden />
          <CardTitle>Spend &amp; Performa Iklan</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {hasRealMetrics ? (
            <p className="text-sm text-muted-foreground">Data metrik tersedia.</p>
          ) : (
            <EmptyState
              icon={BarChart3}
              title="Belum ada data iklan"
              description="Sinkronkan insight di halaman detail campaign (untuk campaign yang sudah Aktif) untuk mengisi data ini dari platform sungguhan."
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <Sparkles className="size-4 text-brand" aria-hidden />
          <CardTitle>Tanyopo Intelligence</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-4">
          {!hasAnyData ? (
            <EmptyState
              icon={Sparkles}
              title="Belum ada data untuk dianalisis"
              description="Insight AI aktif setelah ada data metrik iklan (sinkronkan dari campaign Aktif) atau konversi tercatat."
            />
          ) : (
            <>
              {(session.role === "owner" || session.role === "marketing") ? (
                <GenerateInsightButton hasExisting={!!insight?.summary} />
              ) : null}

              {!insight?.summary ? (
                <p className="text-sm text-muted-foreground">Belum ada insight dibuat.</p>
              ) : (
                <div className="flex flex-col gap-4">
                  <p className="text-sm text-foreground">{insight.summary}</p>

                  <div className="flex flex-wrap items-center gap-2">
                    {insight.top_channel ? <Badge variant="success">Terbaik: {insight.top_channel}</Badge> : null}
                    {underperforming.map((c) => (
                      <Badge key={c} variant="warning">
                        Perlu perhatian: {c}
                      </Badge>
                    ))}
                  </div>

                  {trends.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      <p className="text-xs font-medium text-muted-foreground">Tren</p>
                      {trends.map((t, i) => (
                        <div key={i} className="flex items-start gap-2 text-sm">
                          <Badge variant={t.direction === "UP" ? "success" : t.direction === "DOWN" ? "danger" : "neutral"}>
                            {t.direction}
                          </Badge>
                          <p className="text-foreground">
                            <strong>{t.metric}:</strong> {t.observation}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {risks.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      <p className="text-xs font-medium text-warning">Catatan/Risiko</p>
                      <ul className="list-inside list-disc text-sm text-foreground">
                        {risks.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <p className="text-xs text-muted-foreground">Diperbarui {formatDate(insight.updated_at)}</p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2">
            <TrendingUp className="size-4 text-muted-foreground" aria-hidden />
            <CardTitle>Konversi</CardTitle>
          </div>
          {conversionTotalsByCurrency.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {conversionTotalsByCurrency.map(({ currency, total }) => (
                <Badge key={currency} variant="brand">
                  {formatCurrency(total, currency, session.locale)} tercatat
                </Badge>
              ))}
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-6 pt-4">
          <ConversionForm campaigns={campaigns ?? []} />

          {!conversions || conversions.length === 0 ? (
            <EmptyState
              icon={TrendingUp}
              title="Belum ada konversi tercatat"
              description="Catat penjualan atau lead yang Anda tahu berasal dari campaign menggunakan form di atas."
            />
          ) : (
            <div className="flex flex-col divide-y divide-border rounded-[var(--radius-lg)] border border-border">
              {conversions.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 p-4">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {EVENT_LABEL[c.event_type] ?? c.event_type}
                      {c.customer_reference ? ` — ${c.customer_reference}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(c.occurred_at)}
                      {c.master_campaign_id ? ` · ${campaignNameById.get(c.master_campaign_id) ?? ""}` : ""}
                    </p>
                  </div>
                  <span className="text-sm font-medium text-foreground">
                    {c.value ? formatCurrency(c.value, c.currency) : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
