import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Sparkles, FileText, Compass } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { requireSessionContext } from "@/services/session";
import { createClient } from "@/lib/supabase/server";
import { GenerateRecommendationsButton } from "@/features/seo/generate-recommendations-button";
import { countryLabel } from "@/lib/i18n/countries";

export const metadata: Metadata = { title: "Detail Project SEO & Discovery — LINOE" };

interface OnPageRecommendation {
  issue: string;
  recommendation: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
}

interface ContentPlanItem {
  title: string;
  target_keyword: string;
  content_type: string;
  angle: string;
}

interface TargetKeyword {
  keyword: string;
  intent: string;
  rationale: string;
}

interface DiscoveryContentIdea {
  title: string;
  angle: string;
}

interface DiscoveryChannel {
  channel: string;
  reason: string;
}

interface DiscoveryRecommendationsData {
  primary_keywords: string[];
  supporting_keywords?: string[];
  profile_name_tip: string;
  bio_recommendation: string;
  content_ideas: DiscoveryContentIdea[];
  hashtags?: string[];
  cta_recommendation: string;
  recommended_channels: DiscoveryChannel[];
}

const PRIORITY_VARIANT: Record<string, "danger" | "warning" | "neutral"> = {
  HIGH: "danger",
  MEDIUM: "warning",
  LOW: "neutral",
};

const CONTENT_TYPE_LABEL: Record<string, string> = {
  BLOG: "Blog",
  LANDING_PAGE: "Landing Page",
  FAQ: "FAQ",
  GUIDE: "Panduan",
};

const DISCOVERY_CHANNEL_LABEL: Record<string, string> = {
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  TIKTOK: "TikTok",
  MARKETPLACE: "Marketplace",
};

export default async function SeoProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSessionContext();
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("prompter_seo_projects")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", session.tenantId)
    .single();

  if (!project) {
    notFound();
  }

  const { data: recommendations } = await supabase
    .from("prompter_seo_recommendations")
    .select("*")
    .eq("project_id", id)
    .maybeSingle();

  const isNoWebsite = project.discovery_mode === "NO_WEBSITE";
  const discovery = recommendations?.discovery_recommendations as unknown as DiscoveryRecommendationsData | null;

  return (
    <div className="flex flex-1 flex-col gap-6 p-8">
      <div>
        <p className="text-xs text-muted-foreground">Project SEO & Discovery</p>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {isNoWebsite ? "Discovery tanpa website" : project.website_url}
        </h1>
        {project.country_code ? (
          <Badge variant="neutral" className="mt-1">
            Target pasar: {countryLabel(project.country_code, session.locale)}
          </Badge>
        ) : null}
      </div>

      {isNoWebsite ? (
        <Card>
          <CardContent className="flex items-start gap-3 p-5">
            <Compass className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
            <div>
              <p className="text-sm font-medium text-foreground">
                Tidak masalah. LINOE tetap bisa membantu bisnis Anda lebih mudah ditemukan.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Rekomendasi di bawah disusun dari konteks bisnis/produk Anda — bukan hasil audit ranking Google atau
                jaminan hasil tertentu.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Kata Kunci Target (Anda)</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            {(project.target_keywords as string[]).length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {(project.target_keywords as string[]).map((k) => (
                  <Badge key={k} variant="neutral">
                    {k}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Belum ada kata kunci yang ditentukan.</p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-2">
        {session.role === "owner" || session.role === "marketing" ? (
          <GenerateRecommendationsButton projectId={id} hasExisting={!!recommendations} />
        ) : null}
        <p className="text-xs text-muted-foreground">
          {isNoWebsite
            ? "AI menyusun rekomendasi ini dari konteks bisnis/produk Anda — bukan janji ranking, follower, views, atau penjualan tertentu."
            : "AI menyusun rekomendasi ini berdasarkan URL dan konteks bisnis Anda — bukan hasil crawling/audit langsung ke halaman website. Tinjau dan sesuaikan sebelum diterapkan."}
        </p>
      </div>

      {!recommendations ? (
        <EmptyState
          icon={Sparkles}
          title="Belum ada rekomendasi"
          description="Klik tombol di atas untuk membuat rekomendasi dengan AI."
        />
      ) : isNoWebsite ? (
        discovery ? (
          <div className="flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-foreground">
              Rekomendasi LINOE agar produk Anda lebih mudah ditemukan
            </h2>

            <Card>
              <CardHeader>
                <CardTitle>Keyword Utama</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 pt-4">
                <div className="flex flex-wrap gap-2">
                  {discovery.primary_keywords.map((k) => (
                    <Badge key={k} variant="brand">
                      {k}
                    </Badge>
                  ))}
                </div>
                {discovery.supporting_keywords && discovery.supporting_keywords.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    <p className="text-xs font-medium text-muted-foreground">Kata kunci pendukung</p>
                    <div className="flex flex-wrap gap-2">
                      {discovery.supporting_keywords.map((k) => (
                        <Badge key={k} variant="neutral">
                          {k}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Bio/Profile</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 pt-4 text-sm text-foreground">
                <p>
                  <span className="font-medium">Saran nama/username:</span> {discovery.profile_name_tip}
                </p>
                <p>
                  <span className="font-medium">Saran bio:</span> {discovery.bio_recommendation}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Ide Konten</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 pt-4">
                {discovery.content_ideas.map((idea, i) => (
                  <div key={i} className="rounded-[var(--radius-md)] border border-border p-3">
                    <p className="text-sm font-medium text-foreground">{idea.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{idea.angle}</p>
                  </div>
                ))}
                {discovery.hashtags && discovery.hashtags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {discovery.hashtags.map((h) => (
                      <span key={h} className="text-xs text-brand">
                        {h.startsWith("#") ? h : `#${h}`}
                      </span>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>CTA</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <p className="text-sm text-foreground">{discovery.cta_recommendation}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Channel yang Disarankan</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 pt-4">
                {discovery.recommended_channels.map((c, i) => (
                  <div key={i} className="rounded-[var(--radius-md)] border border-border p-3">
                    <p className="text-sm font-medium text-foreground">
                      {DISCOVERY_CHANNEL_LABEL[c.channel] ?? c.channel}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{c.reason}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        ) : null
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="p-6">
              <p className="text-xs font-medium text-muted-foreground">Ringkasan</p>
              <p className="text-sm text-foreground">{recommendations.summary}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Kata Kunci yang Direkomendasikan AI</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 pt-4">
              {(recommendations.target_keywords as unknown as TargetKeyword[]).map((k, i) => (
                <div key={i} className="rounded-[var(--radius-md)] border border-border p-3">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{k.keyword}</p>
                    <Badge variant="brand">{k.intent}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{k.rationale}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Rekomendasi On-Page</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 pt-4">
              {(recommendations.on_page_recommendations as unknown as OnPageRecommendation[]).map((r, i) => (
                <div key={i} className="rounded-[var(--radius-md)] border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">{r.issue}</p>
                    <Badge variant={PRIORITY_VARIANT[r.priority] ?? "neutral"}>{r.priority}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{r.recommendation}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center gap-2 space-y-0">
              <FileText className="size-4 text-muted-foreground" aria-hidden />
              <CardTitle>Content Plan</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 pt-4">
              {(recommendations.content_plan as unknown as ContentPlanItem[]).map((c, i) => (
                <div key={i} className="rounded-[var(--radius-md)] border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">{c.title}</p>
                    <Badge variant="neutral">{CONTENT_TYPE_LABEL[c.content_type] ?? c.content_type}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Kata kunci: {c.target_keyword} — {c.angle}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
