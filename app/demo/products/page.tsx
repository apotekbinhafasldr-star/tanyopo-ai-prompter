import Link from "next/link";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { requireDemoSession } from "@/lib/demo/is-demo-request";
import { DEMO_PRODUCTS } from "@/lib/demo/dataset";

export default async function DemoProductsPage() {
  await requireDemoSession();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Produk (Demo)</h1>
        <p className="mt-1 text-sm text-muted-foreground">Pilih salah satu produk contoh untuk melihat Marketing Blueprint AI.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {DEMO_PRODUCTS.map((product) => (
          <Link key={product.id} href={`/demo/products/${product.id}`}>
            <Card className="h-full transition hover:border-brand">
              <CardContent className="flex flex-col gap-2 p-5">
                <CardTitle>{product.name}</CardTitle>
                <CardDescription>{product.category}</CardDescription>
                <p className="mt-2 text-sm font-medium text-foreground">
                  Rp{product.price.toLocaleString("id-ID")}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
