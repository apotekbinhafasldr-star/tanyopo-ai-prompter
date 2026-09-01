import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductForm } from "@/features/products/product-form";
import { createProductAction } from "@/features/products/actions";
import { requireSessionContext } from "@/services/session";

export const metadata: Metadata = { title: "Tambah Produk — Tanyopo AI Promoter" };

export default async function NewProductPage() {
  const session = await requireSessionContext();

  return (
    <div className="flex flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Tambah Produk</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Anda bisa menambahkan foto/video setelah produk dibuat.
        </p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Detail Produk</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <ProductForm
            action={createProductAction}
            submitLabel="Simpan Produk"
            defaultCurrency={session.defaultCurrency}
          />
        </CardContent>
      </Card>
    </div>
  );
}
