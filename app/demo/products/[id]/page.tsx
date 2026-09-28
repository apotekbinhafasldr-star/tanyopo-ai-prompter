import { notFound } from "next/navigation";
import { requireDemoSession } from "@/lib/demo/is-demo-request";
import { DEMO_PRODUCTS } from "@/lib/demo/dataset";
import { DemoBlueprintGenerator } from "@/features/demo/blueprint-generator";

export default async function DemoProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireDemoSession();
  const { id } = await params;
  const product = DEMO_PRODUCTS.find((p) => p.id === id);

  if (!product) {
    notFound();
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{product.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{product.description}</p>
        <p className="mt-2 text-sm text-foreground">
          Rp{product.price.toLocaleString("id-ID")} &middot; Stok {product.stock}
        </p>
      </div>

      <DemoBlueprintGenerator productId={product.id} />
    </div>
  );
}
