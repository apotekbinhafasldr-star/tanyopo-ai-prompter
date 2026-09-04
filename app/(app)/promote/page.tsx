import type { Metadata } from "next";
import { requireSessionContext } from "@/services/session";
import { createClient } from "@/lib/supabase/server";
import { PromoteWizard } from "@/features/promote/promote-wizard";

export const metadata: Metadata = { title: "Promote — LINOE" };

/**
 * Resolves a `?handoff=<id>` query param from UMKMpro AI's "🚀 PROMOSIKAN
 * DENGAN AI" button (product spec §47) into a preselected product id.
 *
 * Uses the normal session-scoped Supabase client, not the admin client —
 * `prompter_promotion_handoffs`' RLS SELECT/UPDATE policies are exactly
 * what "validates this handoff belongs to the visiting user's tenant"
 * means here: a handoff for a different tenant simply doesn't come back
 * from this query, full stop, no extra check needed in this code.
 */
async function resolveHandoff(
  supabase: Awaited<ReturnType<typeof createClient>>,
  handoffId: string,
): Promise<{ productId: string | null; error: string | null }> {
  const { data: handoffRow } = await supabase
    .from("prompter_promotion_handoffs")
    .select("id, status, expires_at, product_id")
    .eq("id", handoffId)
    .maybeSingle();

  if (!handoffRow) {
    return { productId: null, error: "Link promosi tidak ditemukan atau bukan milik akun ini." };
  }

  if (new Date(handoffRow.expires_at) < new Date()) {
    return { productId: null, error: "Link promosi ini sudah kedaluwarsa. Kembali ke UMKMpro AI dan coba lagi." };
  }

  if (handoffRow.status === "PENDING") {
    await supabase
      .from("prompter_promotion_handoffs")
      .update({ status: "CONSUMED", consumed_at: new Date().toISOString() })
      .eq("id", handoffId);
  }

  // Status CONSUMED (e.g. a page refresh on the same link) still resolves
  // the product — the one-time semantics are about not re-triggering a
  // fresh handoff record, not about blocking the user from continuing
  // the wizard they were already sent to.
  return { productId: handoffRow.product_id, error: null };
}

export default async function PromotePage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string; handoff?: string }>;
}) {
  const { product, handoff } = await searchParams;
  const session = await requireSessionContext();
  const supabase = await createClient();

  let handoffProductId: string | null = null;
  let handoffError: string | null = null;

  if (handoff) {
    const result = await resolveHandoff(supabase, handoff);
    handoffProductId = result.productId;
    handoffError = result.error;
  }

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
        {handoffError ? (
          <p className="mt-3 rounded-[var(--radius-md)] bg-danger-muted p-3 text-sm text-danger">
            {handoffError}
          </p>
        ) : null}
      </div>
      <PromoteWizard products={products ?? []} preselectedProductId={product ?? handoffProductId ?? undefined} />
    </div>
  );
}
