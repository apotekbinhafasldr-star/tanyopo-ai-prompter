import type { Metadata } from "next";
import Link from "next/link";
import { Search, Globe } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { requireSessionContext } from "@/services/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils/format";
import { SeoProjectForm } from "@/features/seo/project-form";

export const metadata: Metadata = { title: "SEO & Discovery — LINOE" };

export default async function SeoPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string; campaign?: string }>;
}) {
  const { product, campaign: campaignId } = await searchParams;
  const session = await requireSessionContext();
  const supabase = await createClient();

  const [{ data: projects }, { data: brandProfile }] = await Promise.all([
    supabase
      .from("prompter_seo_projects")
      .select("id, website_url, target_keywords, status, discovery_mode, created_at")
      .eq("tenant_id", session.tenantId)
      .order("created_at", { ascending: false }),
    supabase.from("prompter_brand_profiles").select("whatsapp_number").eq("tenant_id", session.tenantId).maybeSingle(),
  ]);

  // Batch B5 — Context Inheritance. Opened from a product directly, or
  // from a campaign (whose own product_id is reused) — the business
  // context LINOE already has is never asked for again on the form
  // itself; only productId is threaded through so generation can pull
  // the rest (name/description/category/target market) fresh each time.
  let preselectedProductId = product;
  let contextNote: string | undefined;

  if (campaignId) {
    const { data: campaign } = await supabase
      .from("prompter_master_campaigns")
      .select("product_id")
      .eq("id", campaignId)
      .eq("tenant_id", session.tenantId)
      .maybeSingle();

    if (campaign?.product_id) {
      preselectedProductId = preselectedProductId ?? campaign.product_id;
      contextNote = "Konteks produk dari campaign ini akan digunakan otomatis — Anda tidak perlu mengisi ulang.";
    }
  } else if (preselectedProductId) {
    const { data: linkedProduct } = await supabase
      .from("prompter_products")
      .select("name")
      .eq("id", preselectedProductId)
      .eq("tenant_id", session.tenantId)
      .maybeSingle();

    if (linkedProduct) {
      contextNote = `Konteks produk "${linkedProduct.name}" akan digunakan otomatis — Anda tidak perlu mengisi ulang.`;
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">SEO & Discovery</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Punya website? Dapatkan rekomendasi keyword, on-page, dan content plan. Belum punya website? LINOE tetap
          bisa membantu bisnis Anda lebih mudah ditemukan lewat media sosial dan marketplace.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <Globe className="size-4 text-muted-foreground" aria-hidden />
          <CardTitle>Tambah Project SEO & Discovery</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {session.role === "owner" || session.role === "marketing" ? (
            <SeoProjectForm
              preselectedProductId={preselectedProductId}
              contextNote={contextNote}
              existingWhatsappNumber={brandProfile?.whatsapp_number}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Hanya Owner/Marketing yang dapat menambah project ini.</p>
          )}
        </CardContent>
      </Card>

      {!projects || projects.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Belum ada project SEO & Discovery"
          description="Pilih salah satu opsi di atas untuk mulai mendapatkan rekomendasi dari AI."
        />
      ) : (
        <div className="flex flex-col divide-y divide-border rounded-[var(--radius-lg)] border border-border">
          {projects.map((p) => (
            <Link key={p.id} href={`/seo/${p.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-surface-muted">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {p.discovery_mode === "NO_WEBSITE" ? "Discovery tanpa website" : p.website_url}
                </p>
                <p className="text-xs text-muted-foreground">
                  {(p.target_keywords as string[]).length > 0
                    ? (p.target_keywords as string[]).join(", ")
                    : "Belum ada kata kunci target"}
                  {" · "}
                  {formatDate(p.created_at)}
                </p>
              </div>
              <Badge variant={p.status === "ACTIVE" ? "success" : "neutral"}>
                {p.status === "ACTIVE" ? "Aktif" : "Dijeda"}
              </Badge>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
