import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Sparkles, Pencil, X as XIcon, Package, FileText, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs } from "@/components/shared/tabs";
import { requireSessionContext } from "@/services/session";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, formatDate, productTypeLabel, channelLabel, campaignStatusLabel } from "@/lib/utils/format";
import { publicStorageUrl } from "@/lib/utils/storage-url";
import { computeProfitEstimate } from "@/lib/profit-estimate";
import { MediaUploader } from "@/features/products/media-uploader";
import { GenerateBlueprintButton } from "@/features/products/generate-blueprint-button";
import { deleteProductMediaAction, uploadProductMediaAction } from "@/features/products/actions";

export const metadata: Metadata = { title: "Detail Produk — Tanyopo AI Promoter" };

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSessionContext();
  const supabase = await createClient();

  const { data: product } = await supabase
    .from("prompter_products")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", session.tenantId)
    .single();

  if (!product) {
    notFound();
  }

  const [{ data: media }, { data: blueprint }, { data: content }, { data: campaigns }] = await Promise.all([
    supabase
      .from("prompter_product_media")
      .select("id, storage_path, media_type")
      .eq("product_id", id)
      .order("position"),
    supabase.from("prompter_marketing_blueprints").select("*").eq("product_id", id).maybeSingle(),
    supabase
      .from("prompter_content_items")
      .select("id, platform, content_type, status, created_at")
      .eq("product_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("prompter_master_campaigns")
      .select("id, name, status, channels, created_at")
      .eq("product_id", id)
      .order("created_at", { ascending: false }),
  ]);

  const campaignIds = (campaigns ?? []).map((c) => c.id);

  const [{ data: purchaseConversions }, { data: metrics }] =
    campaignIds.length > 0
      ? await Promise.all([
          supabase
            .from("prompter_conversions")
            .select("value")
            .in("master_campaign_id", campaignIds)
            .eq("event_type", "PURCHASE"),
          supabase.from("prompter_marketing_metrics").select("spend").in("master_campaign_id", campaignIds),
        ])
      : [{ data: [] }, { data: [] }];

  const revenue = (purchaseConversions ?? []).reduce((sum, c) => sum + (c.value ?? 0), 0);
  const unitsSold = (purchaseConversions ?? []).length;
  const adSpend = (metrics ?? []).reduce((sum, m) => sum + m.spend, 0);
  const profitEstimate = computeProfitEstimate({ revenue, adSpend, hpp: product.hpp, unitsSold });

  const overviewTab = (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Informasi Produk</CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link href={`/products/${id}/edit`}>
              <Pencil />
              Edit
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="pt-4">
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Jenis</dt>
              <dd className="text-sm font-medium text-foreground">{productTypeLabel(product.product_type)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Kategori</dt>
              <dd className="text-sm font-medium text-foreground">{product.category ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Harga</dt>
              <dd className="text-sm font-medium text-foreground">{formatCurrency(product.price, product.currency)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Stok</dt>
              <dd className="text-sm font-medium text-foreground">{product.stock ?? "—"}</dd>
            </div>
            {product.description ? (
              <div className="sm:col-span-2">
                <dt className="text-xs text-muted-foreground">Deskripsi</dt>
                <dd className="text-sm text-foreground">{product.description}</dd>
              </div>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Media</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-4">
          <MediaUploader action={uploadProductMediaAction.bind(null, id)} />

          {media && media.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {media.map((m) => (
                <div key={m.id} className="group relative aspect-square overflow-hidden rounded-[var(--radius-md)] bg-surface-muted">
                  {m.media_type === "IMAGE" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={publicStorageUrl("product-media", m.storage_path)}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <video src={publicStorageUrl("product-media", m.storage_path)} className="h-full w-full object-cover" />
                  )}
                  <form action={deleteProductMediaAction} className="absolute right-1 top-1">
                    <input type="hidden" name="mediaId" value={m.id} />
                    <input type="hidden" name="productId" value={id} />
                    <input type="hidden" name="storagePath" value={m.storage_path} />
                    <button
                      type="submit"
                      aria-label="Hapus media"
                      className="flex size-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <XIcon className="size-3.5" aria-hidden />
                    </button>
                  </form>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Belum ada foto/video produk.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );

  const blueprintTab = (
    <div className="flex flex-col gap-6">
      <GenerateBlueprintButton productId={id} hasExisting={!!blueprint} />

      {!blueprint ? (
        <EmptyState
          icon={Sparkles}
          title="Belum ada Marketing Blueprint"
          description="Buat blueprint AI untuk mendapatkan positioning, USP, target audiens, dan ide konten untuk produk ini."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="flex flex-col gap-4 p-6">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Ringkasan</p>
                <p className="text-sm text-foreground">{blueprint.summary}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">USP</p>
                <p className="text-sm text-foreground">{blueprint.usp}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Positioning</p>
                <p className="text-sm text-foreground">{blueprint.positioning}</p>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <BlueprintList title="Benefit" items={blueprint.benefits as string[]} />
            <BlueprintList title="Pain Points" items={blueprint.pain_points as string[]} />
            <BlueprintList title="Marketing Angles" items={blueprint.marketing_angles as string[]} />
            <BlueprintList title="Ide Konten" items={blueprint.content_ideas as string[]} />
          </div>

          <Card>
            <CardContent className="flex flex-col gap-3 p-6">
              <p className="text-xs font-medium text-muted-foreground">Channel yang Direkomendasikan</p>
              <div className="flex flex-wrap gap-2">
                {(blueprint.recommended_channels as string[]).map((c) => (
                  <Badge key={c} variant="brand">
                    {channelLabel(c)}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          {(blueprint.risks as string[]).length > 0 ? (
            <Card>
              <CardContent className="flex flex-col gap-2 p-6">
                <p className="text-xs font-medium text-warning">Risiko untuk Ditinjau</p>
                <ul className="list-inside list-disc text-sm text-foreground">
                  {(blueprint.risks as string[]).map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );

  const contentTab = (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button asChild size="sm">
          <Link href={`/content?product=${id}`}>Buat Konten</Link>
        </Button>
      </div>
      {!content || content.length === 0 ? (
        <EmptyState icon={FileText} title="Belum ada konten" description="Buat konten AI untuk produk ini di Content Studio." />
      ) : (
        <div className="flex flex-col divide-y divide-border rounded-[var(--radius-lg)] border border-border">
          {content.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 p-4">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {c.content_type} — {channelLabel(c.platform)}
                </p>
                <p className="text-xs text-muted-foreground">{formatDate(c.created_at)}</p>
              </div>
              <Badge variant="neutral">{c.status}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const campaignsTab = (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button asChild size="sm">
          <Link href={`/promote?product=${id}`}>
            <Rocket />
            Promosikan Produk Ini
          </Link>
        </Button>
      </div>
      {!campaigns || campaigns.length === 0 ? (
        <EmptyState icon={Rocket} title="Belum ada campaign" description="Mulai Promote Wizard untuk membuat campaign pertama." />
      ) : (
        <div className="flex flex-col divide-y divide-border rounded-[var(--radius-lg)] border border-border">
          {campaigns.map((c) => (
            <Link key={c.id} href={`/campaigns/${c.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-surface-muted">
              <div>
                <p className="text-sm font-medium text-foreground">{c.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(c.channels as string[]).map(channelLabel).join(", ") || "Belum ada channel"}
                </p>
              </div>
              <Badge variant={c.status === "DRAFT" ? "neutral" : "brand"}>{campaignStatusLabel(c.status)}</Badge>
            </Link>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-1 flex-col gap-6 p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs text-muted-foreground">{productTypeLabel(product.product_type)}</p>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{product.name}</h1>
        </div>
        <Button asChild size="lg">
          <Link href={`/promote?product=${id}`}>
            <Sparkles />
            Promote with AI
          </Link>
        </Button>
      </div>

      <Tabs
        tabs={[
          { id: "overview", label: "Overview", content: overviewTab },
          { id: "blueprint", label: "Marketing Blueprint", content: blueprintTab },
          { id: "content", label: "Content", content: contentTab },
          { id: "campaigns", label: "Campaigns", content: campaignsTab },
          {
            id: "analytics",
            label: "Analytics",
            content:
              campaignIds.length === 0 ? (
                <EmptyState
                  icon={Package}
                  title="Belum ada data untuk dianalisis"
                  description="Estimasi profit muncul setelah produk ini punya campaign dan konversi Purchase tercatat."
                />
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle>Estimasi Profit Marketing (perkiraan)</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-4 pt-4">
                    <p className="text-xs text-muted-foreground">
                      Pendapatan − HPP − biaya iklan, dihitung dari konversi Purchase produk ini. Ini
                      perkiraan, bukan laporan keuangan resmi — asumsi 1 unit terjual per konversi Purchase,
                      dan biaya iklan hanya mencakup data yang sudah tercatat di Analytics (belum otomatis
                      terisi sampai integrasi insights platform diaktifkan).
                    </p>
                    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <dt className="text-xs text-muted-foreground">Pendapatan (Purchase)</dt>
                        <dd className="text-sm font-medium text-foreground">
                          {formatCurrency(profitEstimate.revenue, product.currency)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Unit Terjual (perkiraan)</dt>
                        <dd className="text-sm font-medium text-foreground">{unitsSold}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Biaya Iklan</dt>
                        <dd className="text-sm font-medium text-foreground">
                          {formatCurrency(profitEstimate.adSpend, product.currency)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">HPP</dt>
                        <dd className="text-sm font-medium text-foreground">
                          {product.hpp !== null ? formatCurrency(product.hpp, product.currency) : "Belum diisi"}
                        </dd>
                      </div>
                    </dl>
                    <div className="rounded-[var(--radius-md)] bg-surface-muted p-4">
                      <p className="text-xs text-muted-foreground">Estimasi Profit Bersih</p>
                      {profitEstimate.netProfit !== null ? (
                        <p
                          className={
                            profitEstimate.netProfit >= 0
                              ? "text-lg font-semibold text-success"
                              : "text-lg font-semibold text-danger"
                          }
                        >
                          {formatCurrency(profitEstimate.netProfit, product.currency)}
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Isi HPP produk (di halaman Edit) untuk menghitung estimasi profit bersih.
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ),
          },
        ]}
      />
    </div>
  );
}

function BlueprintList({ title, items }: { title: string; items: string[] }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-6">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <ul className="list-inside list-disc text-sm text-foreground">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
