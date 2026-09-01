import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Trash2, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireSessionContext } from "@/services/session";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate, channelLabel, campaignStatusLabel, campaignStatusVariant, goalLabel } from "@/lib/utils/format";
import { RegenerateProposalButton } from "@/features/campaigns/regenerate-button";
import { CampaignCopyEditor } from "@/features/campaigns/copy-editor";
import { SubmitForApprovalButton } from "@/features/campaigns/submit-button";
import { updateCampaignCopyAction, deleteCampaignAction, cancelSubmissionAction } from "@/features/campaigns/actions";
import { LaunchChannelButton } from "@/features/campaigns/launch-button";
import { SyncInsightsButton } from "@/features/campaigns/sync-insights-button";
import { GenerateOptimizationButton } from "@/features/campaigns/generate-optimization-button";
import { SubmitRecommendationButton } from "@/features/campaigns/submit-recommendation-button";
import { CHANNEL_TO_CONNECTOR } from "@/lib/connectors/channel-map";
import { getConnector } from "@/lib/connectors/get-connector";
import type { CampaignProposal } from "@/schemas/ai/campaign-proposal";
import type { Channel, ConnectorPlatform, OptimizationActionType, RiskLevel } from "@/types/database";

export const metadata: Metadata = { title: "Detail Campaign — Tanyopo AI Promoter" };

interface LaunchabilityResult {
  launchable: boolean;
  reason: string | null;
}

/**
 * Whether a channel can actually be launched — real, not assumed. A
 * channel is launchable only if every one of these is independently true:
 * a connector implementation exists for it, its CREATE_AD capability is
 * marked enabled in the platform_capabilities registry, the connector
 * itself is configured (real credentials present), and the tenant has an
 * actual CONNECTED account for that platform. Fixes a Phase 6 gap where
 * the launch button was gated by a hardcoded channel list instead of
 * this — meaning it could show for a channel with no working connector,
 * or hide for one that was in fact ready.
 */
function resolveLaunchability(
  channel: Channel,
  createAdEnabledPlatforms: Set<ConnectorPlatform>,
  connectedPlatforms: Set<ConnectorPlatform>,
): LaunchabilityResult {
  const platform = CHANNEL_TO_CONNECTOR[channel];
  if (!platform) {
    return { launchable: false, reason: null }; // e.g. SEO — not an ad platform, nothing to explain
  }

  const connector = getConnector(platform);
  if (!connector) {
    return { launchable: false, reason: `Connector ${platform} belum tersedia.` };
  }
  if (!createAdEnabledPlatforms.has(platform)) {
    return { launchable: false, reason: `Kapabilitas peluncuran ${platform} belum diaktifkan.` };
  }
  if (!connector.isConfigured()) {
    return { launchable: false, reason: `Connector ${platform} belum dikonfigurasi di server.` };
  }
  if (!connectedPlatforms.has(platform)) {
    return { launchable: false, reason: `Akun ${platform} belum terhubung. Hubungkan di halaman Connections.` };
  }

  return { launchable: true, reason: null };
}

const STATUS_BANNER: Record<string, { tone: "info" | "warning" | "success"; text: string }> = {
  DRAFT: {
    tone: "info",
    text: "Campaign ini masih berupa draft internal. Ajukan untuk persetujuan saat Anda siap.",
  },
  AWAITING_APPROVAL: {
    tone: "warning",
    text: "Menunggu persetujuan Owner di Approval Center sebelum dijadwalkan.",
  },
  SCHEDULED: {
    tone: "success",
    text: "Sudah disetujui dan terjadwal. Peluncuran nyata ke channel akan aktif setelah Connection Center tersedia (Phase 3).",
  },
};

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSessionContext();
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from("prompter_master_campaigns")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", session.tenantId)
    .single();

  if (!campaign) {
    notFound();
  }

  const [
    { data: product },
    { data: channelCampaigns },
    { data: capabilities },
    { data: connectedAccounts },
    { data: optimizationRecommendation },
  ] = await Promise.all([
    campaign.product_id
      ? supabase.from("prompter_products").select("id, name").eq("id", campaign.product_id).single()
      : Promise.resolve({ data: null }),
    supabase
      .from("prompter_channel_campaigns")
      .select("id, channel, status, budget_percentage, external_campaign_id, error")
      .eq("master_campaign_id", id)
      .order("channel"),
    supabase
      .from("prompter_platform_capabilities")
      .select("platform, enabled")
      .eq("capability", "CREATE_AD"),
    supabase
      .from("prompter_connected_accounts")
      .select("platform, status")
      .eq("tenant_id", session.tenantId),
    supabase
      .from("prompter_optimization_recommendations")
      .select("summary, recommendations, updated_at")
      .eq("master_campaign_id", id)
      .maybeSingle(),
  ]);

  const createAdEnabledPlatforms = new Set(
    (capabilities ?? []).filter((c) => c.enabled).map((c) => c.platform),
  );
  const connectedPlatforms = new Set(
    (connectedAccounts ?? []).filter((a) => a.status === "CONNECTED").map((a) => a.platform),
  );

  interface OptimizationRecommendationItem {
    channel: Channel;
    action_type: OptimizationActionType;
    rationale: string;
    suggested_daily_budget: number | null;
    risk_level: RiskLevel;
  }

  const recommendations =
    (optimizationRecommendation?.recommendations as unknown as OptimizationRecommendationItem[] | undefined) ?? [];
  const activeChannels = new Set(
    (channelCampaigns ?? []).filter((cc) => cc.status === "ACTIVE").map((cc) => cc.channel),
  );
  const hasChannelData = (channelCampaigns ?? []).length > 0;

  const proposal = campaign.ai_proposal as CampaignProposal | null;
  const boundCopyAction = updateCampaignCopyAction.bind(null, id);
  const isDraft = campaign.status === "DRAFT";
  const isAwaitingApproval = campaign.status === "AWAITING_APPROVAL";
  const banner = STATUS_BANNER[campaign.status];
  const bannerClass =
    banner?.tone === "warning"
      ? "bg-warning-muted text-warning"
      : banner?.tone === "success"
        ? "bg-success-muted text-success"
        : "bg-info-muted text-info";

  return (
    <div className="flex flex-1 flex-col gap-6 p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">{campaign.name}</h1>
            <Badge variant={campaignStatusVariant(campaign.status)}>
              {campaignStatusLabel(campaign.status)}
            </Badge>
          </div>
          {product ? (
            <Link href={`/products/${product.id}`} className="text-sm text-brand hover:underline">
              {product.name}
            </Link>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {isDraft ? <SubmitForApprovalButton campaignId={id} /> : null}
          {isAwaitingApproval && session.role === "owner" ? (
            <form action={cancelSubmissionAction}>
              <input type="hidden" name="campaignId" value={id} />
              <Button type="submit" variant="ghost" size="sm">
                Batalkan Pengajuan
              </Button>
            </form>
          ) : null}
          <form action={deleteCampaignAction}>
            <input type="hidden" name="campaignId" value={id} />
            <Button type="submit" variant="ghost" size="sm" disabled={!isDraft}>
              <Trash2 />
              Hapus Draft
            </Button>
          </form>
        </div>
      </div>

      {banner ? <div className={`rounded-[var(--radius-md)] p-4 text-sm ${bannerClass}`}>{banner.text}</div> : null}

      <Card>
        <CardHeader>
          <CardTitle>Ringkasan Target &amp; Budget</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Tujuan</dt>
              <dd className="text-sm font-medium text-foreground">{goalLabel(campaign.objective)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Channel</dt>
              <dd className="text-sm font-medium text-foreground">
                {campaign.channels.map(channelLabel).join(", ") || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Lokasi</dt>
              <dd className="text-sm font-medium text-foreground">
                {[campaign.target_city, campaign.target_region, campaign.target_country].filter(Boolean).join(", ") || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Budget Harian</dt>
              <dd className="text-sm font-medium text-foreground">{formatCurrency(campaign.daily_budget, campaign.currency)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Budget Total</dt>
              <dd className="text-sm font-medium text-foreground">{formatCurrency(campaign.total_budget, campaign.currency)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Dibuat</dt>
              <dd className="text-sm font-medium text-foreground">{formatDate(campaign.created_at)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {channelCampaigns && channelCampaigns.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Breakdown per Channel</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="flex flex-col divide-y divide-border">
              {channelCampaigns.map((cc) => {
                const { launchable, reason } = resolveLaunchability(
                  cc.channel,
                  createAdEnabledPlatforms,
                  connectedPlatforms,
                );
                const showLaunchControl = campaign.status === "SCHEDULED" && cc.status !== "ACTIVE";

                return (
                  <div key={cc.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-sm font-medium text-foreground">{channelLabel(cc.channel)}</span>
                      <span className="text-sm text-muted-foreground">
                        {cc.budget_percentage !== null ? `${cc.budget_percentage}%` : "—"}
                      </span>
                      <Badge variant={campaignStatusVariant(cc.status)}>
                        {campaignStatusLabel(cc.status)}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {cc.external_campaign_id ?? "Belum terhubung ke platform"}
                      </span>
                    </div>
                    {cc.error ? <p className="max-w-md text-xs text-danger">{cc.error}</p> : null}
                    {showLaunchControl ? (
                      launchable ? (
                        <LaunchChannelButton channelCampaignId={cc.id} retry={cc.status === "FAILED"} />
                      ) : reason ? (
                        <p className="max-w-xs text-right text-xs text-muted-foreground">{reason}</p>
                      ) : null
                    ) : cc.status === "ACTIVE" ? (
                      <SyncInsightsButton channelCampaignId={cc.id} />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {hasChannelData && activeChannels.size > 0 ? (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 space-y-0">
            <Lightbulb className="size-4 text-brand" aria-hidden />
            <CardTitle>Rekomendasi Optimasi AI</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pt-4">
            <p className="text-xs text-muted-foreground">
              Membandingkan channel campaign ini berdasarkan estimasi kontribusi marketing (bukan hanya
              ROAS), dari data spend/konversi yang sudah tercatat. Ini rekomendasi untuk ditinjau — tidak
              ada tindakan yang berjalan otomatis tanpa persetujuan Anda.
            </p>
            {session.role === "owner" || session.role === "marketing" ? (
              <GenerateOptimizationButton masterCampaignId={id} hasExisting={!!optimizationRecommendation} />
            ) : null}

            {optimizationRecommendation ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-foreground">{optimizationRecommendation.summary}</p>
                <div className="flex flex-col divide-y divide-border rounded-[var(--radius-lg)] border border-border">
                  {recommendations.map((rec, i) => (
                    <div key={i} className="flex flex-col gap-2 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{channelLabel(rec.channel)}</span>
                          <Badge variant="brand">{rec.action_type.replaceAll("_", " ")}</Badge>
                          <Badge
                            variant={
                              rec.risk_level === "HIGH" ? "danger" : rec.risk_level === "MEDIUM" ? "warning" : "neutral"
                            }
                          >
                            Risiko {rec.risk_level}
                          </Badge>
                        </div>
                        {rec.action_type !== "NO_ACTION" && activeChannels.has(rec.channel) ? (
                          <SubmitRecommendationButton
                            masterCampaignId={id}
                            channel={rec.channel}
                            actionType={rec.action_type}
                            suggestedDailyBudget={rec.suggested_daily_budget}
                            rationale={rec.rationale}
                            riskLevel={rec.risk_level}
                          />
                        ) : null}
                      </div>
                      <p className="text-xs text-muted-foreground">{rec.rationale}</p>
                      {rec.suggested_daily_budget !== null ? (
                        <p className="text-xs text-foreground">
                          Usulan budget harian: {formatCurrency(rec.suggested_daily_budget, campaign.currency)}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Diperbarui {formatDate(optimizationRecommendation.updated_at)}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Belum ada rekomendasi dibuat.</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {!proposal ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Belum ada proposal AI untuk campaign ini.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>Strategi AI</CardTitle>
              {isDraft ? <RegenerateProposalButton campaignId={id} /> : null}
            </CardHeader>
            <CardContent className="flex flex-col gap-4 pt-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Positioning</p>
                <p className="text-sm text-foreground">{proposal.positioning}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Audiens</p>
                <p className="text-sm text-foreground">{proposal.audience_summary}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Marketing Angle</p>
                <p className="text-sm text-foreground">{proposal.marketing_angle}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Konsep Kreatif</p>
                <p className="text-sm text-foreground">{proposal.creative_concept}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Konten Iklan</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              {isDraft ? (
                <CampaignCopyEditor
                  action={boundCopyAction}
                  headline={proposal.headline}
                  primaryText={proposal.primary_text}
                  cta={proposal.cta}
                />
              ) : (
                <div className="flex flex-col gap-3 text-sm">
                  <p>
                    <strong>Headline:</strong> {proposal.headline}
                  </p>
                  <p>
                    <strong>Teks Utama:</strong> {proposal.primary_text}
                  </p>
                  <p>
                    <strong>CTA:</strong> {proposal.cta}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Alokasi Budget</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 pt-4">
              {proposal.budget_allocation.map((b) => (
                <div key={b.channel} className="flex items-center justify-between text-sm">
                  <span className="text-foreground">{channelLabel(b.channel)}</span>
                  <span className="font-medium text-foreground">{b.percentage}%</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
