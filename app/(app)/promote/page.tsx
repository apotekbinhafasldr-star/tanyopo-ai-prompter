import type { Metadata } from "next";
import { requireSessionContext } from "@/services/session";
import { createClient } from "@/lib/supabase/server";
import { PromoteWizard } from "@/features/promote/promote-wizard";

export const metadata: Metadata = { title: "Promote — Tanyopo AI Promoter" };

export default async function PromotePage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  const { product } = await searchParams;
  const session = await requireSessionContext();
  const supabase = await createClient();

  const { data: products } = await supabase
    .from("prompter_products")
    .select("id, name, product_type, price, currency")
    .eq("tenant_id", session.tenantId)
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-1 flex-col items-center gap-6 p-8">
      <div className="w-full max-w-2xl">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Promote dengan AI</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Jawab beberapa pertanyaan singkat — AI akan menyusun strategi dan campaign untuk Anda.
        </p>
      </div>
      <PromoteWizard products={products ?? []} preselectedProductId={product} />
    </div>
  );
}
