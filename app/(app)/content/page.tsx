import type { Metadata } from "next";
import { FileText, CalendarDays } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs } from "@/components/shared/tabs";
import { requireSessionContext } from "@/services/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, channelLabel } from "@/lib/utils/format";
import { ContentGeneratorForm } from "@/features/content/content-generator-form";
import { ScheduleForm } from "@/features/content/schedule-form";
import type { ContentGeneration } from "@/schemas/ai/content-generation";
import type { Database } from "@/types/database";

export const metadata: Metadata = { title: "Content — Tanyopo AI Promoter" };

type ContentItem = Pick<
  Database["public"]["Tables"]["prompter_content_items"]["Row"],
  "id" | "platform" | "content_type" | "status" | "body" | "created_at" | "product_id" | "scheduled_at"
>;

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  const { product } = await searchParams;
  const session = await requireSessionContext();
  const supabase = await createClient();
  const canEdit = session.role === "owner" || session.role === "marketing";

  const { data: products } = await supabase
    .from("prompter_products")
    .select("id, name")
    .eq("tenant_id", session.tenantId)
    .order("created_at", { ascending: false });

  const { data: contentItems } = await supabase
    .from("prompter_content_items")
    .select("id, platform, content_type, status, body, created_at, product_id, scheduled_at")
    .eq("tenant_id", session.tenantId)
    .order("created_at", { ascending: false })
    .limit(50);

  const productNameById = new Map((products ?? []).map((p) => [p.id, p.name]));

  const libraryTab = (
    <div className="flex flex-col gap-3">
      {!contentItems || contentItems.length === 0 ? (
        <EmptyState icon={FileText} title="Belum ada konten" description="Konten yang dibuat akan muncul di sini." />
      ) : (
        contentItems.map((item) => (
          <ContentItemCard
            key={item.id}
            item={item}
            productName={item.product_id ? productNameById.get(item.product_id) : undefined}
            canEdit={canEdit}
          />
        ))
      )}
    </div>
  );

  const scheduledItems = (contentItems ?? [])
    .filter((item): item is ContentItem & { scheduled_at: string } => !!item.scheduled_at)
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));

  const itemsByDate = new Map<string, ContentItem[]>();
  for (const item of scheduledItems) {
    const dateKey = item.scheduled_at.slice(0, 10);
    const list = itemsByDate.get(dateKey) ?? [];
    list.push(item);
    itemsByDate.set(dateKey, list);
  }

  const calendarTab = (
    <div className="flex flex-col gap-4">
      {itemsByDate.size === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="Belum ada konten terjadwal"
          description="Atur tanggal pada konten di tab Perpustakaan untuk melihatnya di sini."
        />
      ) : (
        Array.from(itemsByDate.entries()).map(([dateKey, items]) => (
          <div key={dateKey} className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-foreground">{formatDate(dateKey)}</p>
            <div className="flex flex-col divide-y divide-border rounded-[var(--radius-lg)] border border-border">
              {items.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 p-4">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {item.content_type} — {channelLabel(item.platform)}
                      {item.product_id ? ` · ${productNameById.get(item.product_id) ?? ""}` : ""}
                    </p>
                  </div>
                  <Badge variant="brand">{item.status}</Badge>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );

  return (
    <div className="flex flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Content Studio</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Buat caption, ad copy, blog, atau video script dengan AI, lalu atur jadwal publikasinya.
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

      <Tabs
        tabs={[
          { id: "library", label: "Perpustakaan", content: libraryTab },
          { id: "calendar", label: "Kalender", content: calendarTab },
        ]}
      />
    </div>
  );
}

function ContentItemCard({
  item,
  productName,
  canEdit,
}: {
  item: ContentItem;
  productName?: string;
  canEdit: boolean;
}) {
  const body = item.body as unknown as ContentGeneration;

  return (
    <details className="rounded-[var(--radius-lg)] border border-border bg-surface">
      <summary className="flex cursor-pointer items-center justify-between gap-3 p-4">
        <div>
          <p className="text-sm font-medium text-foreground">
            {item.content_type} — {channelLabel(item.platform)}
            {productName ? ` · ${productName}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatDate(item.created_at)}
            {item.scheduled_at ? ` · Terjadwal ${formatDate(item.scheduled_at)}` : ""}
          </p>
        </div>
        <Badge variant="neutral">{item.status}</Badge>
      </summary>
      <div className="flex flex-col gap-3 border-t border-border p-4 text-sm text-foreground">
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
        {canEdit ? (
          <div className="border-t border-border pt-3">
            <ScheduleForm contentItemId={item.id} scheduledAt={item.scheduled_at} />
          </div>
        ) : null}
      </div>
    </details>
  );
}
