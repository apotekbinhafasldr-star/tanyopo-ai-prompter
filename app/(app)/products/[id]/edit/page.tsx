import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductForm } from "@/features/products/product-form";
import { updateProductAction } from "@/features/products/actions";
import { requireSessionContext } from "@/services/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Edit Produk — LINOE" };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
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

  const boundAction = updateProductAction.bind(null, id);

  return (
    <div className="flex flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Edit Produk</h1>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Detail Produk</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <ProductForm
            action={boundAction}
            product={product}
            submitLabel="Simpan Perubahan"
            defaultCurrency={session.defaultCurrency}
          />
        </CardContent>
      </Card>
    </div>
  );
}
