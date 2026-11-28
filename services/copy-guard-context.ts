import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { CopyGuardContext } from "@/lib/campaigns/copy-guard";
import { buildKnownFacts } from "@/lib/ai/known-facts";

/**
 * Read-only product name and "known facts" for the copy guard, scoped by tenant. Shared by submit and launch so
 * both evaluate the Quality Gate against the same facts. `null` = the read failed (the caller fails closed).
 * A campaign without a product is judged without facts, as the page and submit always did.
 */
export async function readCopyGuardContext(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  productId: string | null | undefined,
): Promise<CopyGuardContext | null> {
  if (!productId) return { productName: null, knownFacts: null };
  try {
    const { data: product, error } = await supabase
      .from("prompter_products")
      .select("name, description, price, category, currency")
      .eq("id", productId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) return null;
    return { productName: product?.name ?? null, knownFacts: buildKnownFacts(product) };
  } catch {
    return null;
  }
}
