import { BarChart3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdVerdictCard, AdVerdictDisclaimer } from "@/features/demo/ad-verdict-card";
import { ManualMetricsForm } from "@/features/campaigns/manual-metrics-form";
import { ManualMetricRowActions } from "@/features/campaigns/manual-metrics-row-actions";
import { createClient } from "@/lib/supabase/server";
import {
  MANUAL_ASSUMPTION_NOTE,
  MANUAL_DATA_LABEL,
  MANUAL_METRICS_UNAVAILABLE_MESSAGE,
  isManualMetricsTableMissing,
  summarizeManualMetrics,
} from "@/lib/manual-ad-metrics";
import { MANUAL_METRIC_CHANNELS } from "@/schemas/manual-ad-metrics";
import { channelLabel, formatCurrency } from "@/lib/utils/format";
import type { Channel, TenantRole } from "@/types/database";

interface ChannelCampaignRef {
  id: string;
  channel: Channel;
  external_campaign_id: string | null;
}

/**
 * Winning Ads Phase 2B — manual ad metrics + Ad Performance Verdict for one
 * campaign. Read-mostly server component; the only writes go through the
 * actions in manual-metrics-actions.ts. It reads `prompter_manual_ad_metrics`
 * (+ the product's price/HPP) and nothing else: no connector data, no Budget
 * Guard, no launch or approval path. Fails closed when the table is absent.
 */
export async function ManualMetricsSection({
  masterCampaignId,
  tenantId,
  role,
  campaignCurrency,
  productId,
  channelCampaigns,
}: {
  masterCampaignId: string;
  tenantId: string;
  role: TenantRole;
  campaignCurrency: string;
  productId: string | null;
  channelCampaigns: ChannelCampaignRef[];
}) {
  const adChannels = channelCampaigns.filter((cc) =>
    (MANUAL_METRIC_CHANNELS as readonly string[]).includes(cc.channel),
  );
  if (adChannels.length === 0) return null;

  const canEdit = role === "owner" || role === "marketing";
  const supabase = await createClient();

  const { data: rows, error } = await supabase
    .from("prompter_manual_ad_metrics")
    .select("id, channel_campaign_id, metric_date, spend, impressions, clicks, conversions, revenue, currency")
    .eq("master_campaign_id", masterCampaignId)
    .eq("tenant_id", tenantId)
    .order("metric_date", { ascending: false });

  const header = (
    <CardHeader className="flex flex-row items-center gap-2 space-y-0">
      <BarChart3 className="size-4 text-brand" aria-hidden />
      <CardTitle>Metrik Iklan Manual &amp; Verdict</CardTitle>
    </CardHeader>
  );

  if (error) {
    // Fail closed: no form, no verdict. A missing table is a deployment state,
    // any other read error is shown generically (never as an empty "no data").
    return (
      <Card>
        {header}
        <CardContent className="pt-4">
          <p role="status" className="text-sm text-muted-foreground">
            {isManualMetricsTableMissing(error)
              ? MANUAL_METRICS_UNAVAILABLE_MESSAGE
              : "Data metrik manual tidak dapat dimuat saat ini. Silakan coba lagi nanti."}
          </p>
        </CardContent>
      </Card>
    );
  }

  const product = productId
    ? (
        await supabase
          .from("prompter_products")
          .select("hpp, price, currency")
          .eq("id", productId)
          .eq("tenant_id", tenantId)
          .maybeSingle()
      ).data
    : null;

  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <Card>
      {header}
      <CardContent className="flex flex-col gap-6 pt-4">
        <div className="flex flex-col gap-2">
          <Badge variant="warning" className="w-fit">
            {MANUAL_DATA_LABEL}
          </Badge>
          <p className="text-xs text-muted-foreground">
            Untuk iklan yang Anda jalankan sendiri di luar LINOE. Angka diketik manual dan tidak dicek ke
            platform iklan. Data ini terpisah dari data platform dan tidak memengaruhi batas anggaran,
            rekomendasi optimasi, maupun peluncuran. Verdict hanya saran, tidak ada tindakan otomatis.
          </p>
          <p className="text-xs text-muted-foreground">{MANUAL_ASSUMPTION_NOTE}</p>
        </div>

        {adChannels.map((cc) => {
          const channelRows = (rows ?? []).filter((r) => r.channel_campaign_id === cc.id);
          const linked = !!cc.external_campaign_id;
          const summary = linked
            ? null
            : summarizeManualMetrics(channelRows, {
                campaignCurrency,
                product: productId && product ? product : null,
              });

          return (
            <section key={cc.id} className="flex flex-col gap-4 border-t border-border pt-4 first:border-t-0 first:pt-0">
              <h3 className="text-sm font-semibold text-foreground">{channelLabel(cc.channel)}</h3>

              {linked ? (
                <p role="status" className="text-sm text-muted-foreground">
                  Channel ini sudah terhubung ke campaign di platform. Data platform adalah sumber utama,
                  jadi input manual dan verdict manual dinonaktifkan untuk channel ini.
                </p>
              ) : canEdit ? (
                <ManualMetricsForm channelCampaignId={cc.id} currency={campaignCurrency} todayIso={todayIso} />
              ) : (
                <p className="text-xs text-muted-foreground">Hanya Owner atau Marketing yang dapat menambah data.</p>
              )}

              {channelRows.length > 0 ? (
                <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-md)] border border-border">
                  {channelRows.map((r) => (
                    <li key={r.id} className="flex flex-col gap-2 p-3">
                      <p className="text-sm font-medium text-foreground">{r.metric_date}</p>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-5">
                        <div>
                          <dt>Biaya</dt>
                          <dd className="text-sm text-foreground">{formatCurrency(r.spend, r.currency)}</dd>
                        </div>
                        <div>
                          <dt>Tayangan</dt>
                          <dd className="text-sm text-foreground">{r.impressions.toLocaleString("id-ID")}</dd>
                        </div>
                        <div>
                          <dt>Klik</dt>
                          <dd className="text-sm text-foreground">{r.clicks.toLocaleString("id-ID")}</dd>
                        </div>
                        <div>
                          <dt>Konversi</dt>
                          <dd className="text-sm text-foreground">{r.conversions.toLocaleString("id-ID")}</dd>
                        </div>
                        <div>
                          <dt>Omzet</dt>
                          <dd className="text-sm text-foreground">{formatCurrency(r.revenue, r.currency)}</dd>
                        </div>
                      </dl>
                      <ManualMetricRowActions
                        canEdit={canEdit}
                        editable={!linked}
                        row={{
                          id: r.id,
                          spend: r.spend,
                          impressions: r.impressions,
                          clicks: r.clicks,
                          conversions: r.conversions,
                          revenue: r.revenue,
                        }}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Belum ada data harian untuk channel ini.</p>
              )}

              {summary ? (
                <>
                  {summary.warnings.map((w) => (
                    <p key={w} className="text-xs text-warning">
                      {w}
                    </p>
                  ))}
                  {summary.verdict ? (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Dihitung dari {summary.daysObserved} hari yang diisi.
                      </p>
                      <AdVerdictCard
                        title={`Verdict ${channelLabel(cc.channel)}`}
                        result={summary.verdict}
                        simulated={false}
                        sourceLabel={MANUAL_DATA_LABEL}
                        currency={summary.currency ?? campaignCurrency}
                      />
                    </>
                  ) : (
                    <p role="status" className="text-sm text-muted-foreground">
                      {summary.blockedMessage}
                    </p>
                  )}
                </>
              ) : null}
            </section>
          );
        })}

        <AdVerdictDisclaimer />
      </CardContent>
    </Card>
  );
}
