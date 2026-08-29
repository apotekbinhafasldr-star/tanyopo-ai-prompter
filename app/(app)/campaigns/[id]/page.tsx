import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireSessionContext } from "@/services/session";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate, channelLabel, campaignStatusLabel, goalLabel } from "@/lib/utils/format";
import { RegenerateProposalButton } from "@/features/campaigns/regenerate-button";
import { CampaignCopyEditor } from "@/features/campaigns/copy-editor";
import { updateCampaignCopyAction, deleteCampaignAction } from "@/features/campaigns/actions";
import type { CampaignProposal } from "@/schemas/ai/campaign-proposal";

export const metadata: Metadata = { title: "Detail Campaign — Tanyopo AI Promoter" };

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

  const { data: product } = campaign.product_id
    ? await supabase.from("prompter_products").select("id, name").eq("id", campaign.product_id).single()
    : { data: null };

  const proposal = campaign.ai_proposal as CampaignProposal | null;
  const boundCopyAction = updateCampaignCopyAction.bind(null, id);

  return (
    <div className="flex flex-1 flex-col gap-6 p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">{campaign.name}</h1>
            <Badge variant={campaign.status === "DRAFT" ? "neutral" : "brand"}>
              {campaignStatusLabel(campaign.status)}
            </Badge>
          </div>
          {product ? (
            <Link href={`/products/${product.id}`} className="text-sm text-brand hover:underline">
              {product.name}
            </Link>
          ) : null}
        </div>
        <form action={deleteCampaignAction}>
          <input type="hidden" name="campaignId" value={id} />
          <Button type="submit" variant="ghost" size="sm" disabled={campaign.status !== "DRAFT"}>
            <Trash2 />
            Hapus Draft
          </Button>
        </form>
      </div>

      <div className="rounded-[var(--radius-md)] bg-info-muted p-4 text-sm text-info">
        Campaign ini masih berupa <strong>draft internal</strong>. Persetujuan dan peluncuran ke channel nyata
        akan tersedia setelah Approval Center dan Connection Center aktif.
      </div>

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
              <RegenerateProposalButton campaignId={id} />
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
              <CampaignCopyEditor
                action={boundCopyAction}
                headline={proposal.headline}
                primaryText={proposal.primary_text}
                cta={proposal.cta}
              />
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
