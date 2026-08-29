import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { requireSessionContext } from "@/services/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, channelLabel } from "@/lib/utils/format";
import { ContentGeneratorForm } from "@/features/content/content-generator-form";
import type { ContentGeneration } from "@/schemas/ai/content-generation";

export const metadata: Metadata = { title: "Content — Tanyopo AI Promoter" };

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  const { product } = await searchParams;
  const session = await requireSessionContext();
  const supabase = await createClient();

  const { data: products } = await supabase
    .from("prompter_products")
    .select("id, name")
    .eq("tenant_id", session.tenantId)
    .order("created_at", { ascending: false });

  const { data: contentItems } = await supabase
    .from("prompter_content_items")
    .select("id, platform, content_type, status, body, created_at, product_id")
    .eq("tenant_id", session.tenantId)
    .order("created_at", { ascending: false })
    .limit(50);

  const productNameById = new Map((products ?? []).map((p) => [p.id, p.name]));

  return (
    <div className="flex flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Content Studio</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Buat caption, ad copy, blog, atau video script dengan AI.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>AI Content Generator</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {!products || products.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="Tambahkan produk terlebih dahulu"
              description="Content Generator butuh produk untuk dijadikan konteks."
            />
          ) : (
            <ContentGeneratorForm products={products} preselectedProductId={product} />
          )}
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Content Library</h2>
        {!contentItems || contentItems.length === 0 ? (
          <EmptyState icon={FileText} title="Belum ada konten" description="Konten yang dibuat akan muncul di sini." />
        ) : (
          <div className="flex flex-col gap-3">
            {contentItems.map((item) => {
              const body = item.body as unknown as ContentGeneration;
              return (
                <details key={item.id} className="rounded-[var(--radius-lg)] border border-border bg-surface">
                  <summary className="flex cursor-pointer items-center justify-between gap-3 p-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {item.content_type} — {channelLabel(item.platform)}
                        {item.product_id ? ` · ${productNameById.get(item.product_id) ?? ""}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">{formatDate(item.created_at)}</p>
                    </div>
                    <Badge variant="neutral">{item.status}</Badge>
                  </summary>
                  <div className="flex flex-col gap-2 border-t border-border p-4 text-sm text-foreground">
                    <p>
                      <strong>Hook:</strong> {body.hook}
                    </p>
                    <p>
                      <strong>Caption:</strong> {body.caption}
                    </p>
                    <p>
                      <strong>Body:</strong> {body.body}
                    </p>
                    <p>
                      <strong>CTA:</strong> {body.cta}
                    </p>
                    {body.hashtags?.length ? (
                      <p>
                        <strong>Hashtag:</strong> {body.hashtags.join(" ")}
                      </p>
                    ) : null}
                    {body.video_script ? (
                      <p>
                        <strong>Video Script:</strong> {body.video_script}
                      </p>
                    ) : null}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
