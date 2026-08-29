import type { Metadata } from "next";
import Link from "next/link";
import { Package, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { requireSessionContext } from "@/services/session";
import { createClient } from "@/lib/supabase/server";
import { formatCurrency, productTypeLabel } from "@/lib/utils/format";
import { publicStorageUrl } from "@/lib/utils/storage-url";

export const metadata: Metadata = { title: "Products — Tanyopo AI Promoter" };

export default async function ProductsPage() {
  const session = await requireSessionContext();
  const supabase = await createClient();

  const { data: products } = await supabase
    .from("prompter_products")
    .select("id, name, product_type, price, currency, stock, status")
    .eq("tenant_id", session.tenantId)
    .order("created_at", { ascending: false });

  const productIds = (products ?? []).map((p) => p.id);
  const { data: media } = productIds.length
    ? await supabase
        .from("prompter_product_media")
        .select("product_id, storage_path")
        .in("product_id", productIds)
        .eq("position", 0)
    : { data: [] };

  const thumbnailByProduct = new Map((media ?? []).map((m) => [m.product_id, m.storage_path]));

  return (
    <div className="flex flex-1 flex-col gap-6 p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Products</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Produk, jasa, aplikasi, dan langganan yang bisa Anda promosikan dengan AI.
          </p>
        </div>
        <Button asChild>
          <Link href="/products/new">
            <Plus />
            Tambah Produk
          </Link>
        </Button>
      </div>

      {!products || products.length === 0 ? (
        <EmptyState
          icon={Package}
          title="Belum ada produk"
          description="Tambahkan produk pertama Anda untuk mulai membuat strategi dan campaign dengan AI."
          action={
            <Button asChild size="sm">
              <Link href="/products/new">Tambah Produk Pertama</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => {
            const thumbnail = thumbnailByProduct.get(product.id);
            return (
              <Link key={product.id} href={`/products/${product.id}`}>
                <Card className="h-full transition-shadow hover:shadow-[var(--shadow-md)]">
                  <div className="flex h-36 items-center justify-center overflow-hidden rounded-t-[var(--radius-lg)] bg-surface-muted">
                    {thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={publicStorageUrl("product-media", thumbnail)}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Package className="size-8 text-muted-foreground" aria-hidden />
                    )}
                  </div>
                  <CardContent className="flex flex-col gap-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-1 text-sm font-semibold text-foreground">
                        {product.name}
                      </p>
                      <Badge variant={product.status === "ACTIVE" ? "success" : "neutral"}>
                        {product.status === "ACTIVE" ? "Aktif" : product.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {productTypeLabel(product.product_type)}
                      {product.stock !== null ? ` · Stok ${product.stock}` : ""}
                    </p>
                    <p className="text-sm font-medium text-foreground">
                      {formatCurrency(product.price, product.currency)}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
