import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Sparkles, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { requireSessionContext } from "@/services/session";
import { createClient } from "@/lib/supabase/server";
import { GenerateRecommendationsButton } from "@/features/seo/generate-recommendations-button";

export const metadata: Metadata = { title: "Detail Project SEO — Tanyopo AI Promoter" };

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

  return (
    <div className="flex flex-1 flex-col gap-6 p-8">
      <div>
        <p className="text-xs text-muted-foreground">Project SEO</p>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{project.website_url}</h1>
      </div>

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

      <div className="flex flex-col gap-2">
        {session.role === "owner" || session.role === "marketing" ? (
          <GenerateRecommendationsButton projectId={id} hasExisting={!!recommendations} />
        ) : null}
        <p className="text-xs text-muted-foreground">
          AI menyusun rekomendasi ini berdasarkan URL dan konteks bisnis Anda — bukan hasil crawling/audit
          langsung ke halaman website. Tinjau dan sesuaikan sebelum diterapkan.
        </p>
      </div>

      {!recommendations ? (
        <EmptyState
          icon={Sparkles}
          title="Belum ada rekomendasi SEO"
          description="Klik tombol di atas untuk membuat rekomendasi on-page dan content plan dengan AI."
        />
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
