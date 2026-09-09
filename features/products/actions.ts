"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSessionContext } from "@/services/session";
import { productSchema } from "@/schemas/products";
import { isOwnProductMediaPath } from "@/lib/media/product-media-path";
import type { MediaType } from "@/types/database";
import { MarketingBlueprintSchema } from "@/schemas/ai/marketing-blueprint";
import { buildSystemPreamble, buildMarketingBlueprintPrompt } from "@/lib/ai/prompts";
import { runAiJob } from "@/services/ai-jobs";
import type { BusinessCategory } from "@/types/database";

export interface ActionState {
  error: string | null;
}

function parseProductForm(formData: FormData) {
  return productSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    productType: formData.get("productType"),
    category: formData.get("category"),
    price: formData.get("price") || undefined,
    currency: formData.get("currency") || undefined,
    stock: formData.get("stock") || undefined,
    stockUnit: formData.get("stockUnit"),
    hpp: formData.get("hpp") || undefined,
    websiteUrl: formData.get("websiteUrl"),
    targetCountries: formData.get("targetCountries"),
    language: formData.get("language") || undefined,
  });
}

/** "id, my, sg" -> ["ID","MY","SG"], de-duplicated, blanks dropped. */
function parseTargetCountries(input: string | undefined): string[] {
  if (!input) return [];
  return Array.from(
    new Set(
      input
        .split(",")
        .map((c) => c.trim().toUpperCase())
        .filter((c) => /^[A-Z]{2}$/.test(c)),
    ),
  );
}

export async function createProductAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = parseProductForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data tidak valid" };
  }

  const session = await requireSessionContext();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("prompter_products")
    .insert({
      tenant_id: session.tenantId,
      name: parsed.data.name,
      description: parsed.data.description || null,
      product_type: parsed.data.productType as BusinessCategory,
      category: parsed.data.category || null,
      price: parsed.data.price,
      currency: parsed.data.currency,
      stock: parsed.data.stock,
      stock_unit: parsed.data.stockUnit || null,
      hpp: parsed.data.hpp,
      website_url: parsed.data.websiteUrl || null,
      target_countries: parseTargetCountries(parsed.data.targetCountries),
      language: parsed.data.language || null,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { error: "Gagal menyimpan produk. Silakan coba lagi." };
  }

  revalidatePath("/products");
  redirect(`/products/${data.id}?created=1`);
}

export async function updateProductAction(
  productId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = parseProductForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data tidak valid" };
  }

  const session = await requireSessionContext();
  const supabase = await createClient();

  const { error } = await supabase
    .from("prompter_products")
    .update({
      name: parsed.data.name,
      description: parsed.data.description || null,
      product_type: parsed.data.productType as BusinessCategory,
      category: parsed.data.category || null,
      price: parsed.data.price,
      currency: parsed.data.currency,
      stock: parsed.data.stock,
      stock_unit: parsed.data.stockUnit || null,
      hpp: parsed.data.hpp,
      website_url: parsed.data.websiteUrl || null,
      target_countries: parseTargetCountries(parsed.data.targetCountries),
      language: parsed.data.language || null,
    })
    .eq("id", productId)
    .eq("tenant_id", session.tenantId);

  if (error) {
    return { error: "Gagal memperbarui produk. Silakan coba lagi." };
  }

  revalidatePath("/products");
  revalidatePath(`/products/${productId}`);
  redirect(`/products/${productId}`);
}

/**
 * Batch B4 hotfix — root cause of the production crash this replaces:
 * uploadProductMediaAction used to receive the raw file bytes as this
 * Server Action's own FormData payload. Next.js caps a Server Action
 * request body at 1MB by default (next.config.ts never overrode it),
 * and any real product photo exceeds that — Next.js rejects the request
 * before this action's code (and its own error handling) ever runs,
 * which crashed the whole page instead of failing gracefully.
 *
 * The fix moves the actual upload to the browser
 * (features/products/media-uploader.tsx uses the existing browser
 * Supabase client, lib/supabase/client.ts, to upload straight to the
 * `product-media` bucket — anon/publishable key only, gated by the same
 * tenant-scoped storage.objects RLS policy every other write already
 * relies on) and shrinks this action to recording the resulting path —
 * a few bytes, never a file, so the body-size ceiling no longer matters.
 */
export async function recordProductMediaAction(
  productId: string,
  storagePath: string,
  mediaType: MediaType,
): Promise<ActionState> {
  const session = await requireSessionContext();
  const supabase = await createClient();

  if (!isOwnProductMediaPath(storagePath, session.tenantId, productId)) {
    return { error: "Media tidak valid untuk produk ini." };
  }

  const { data: existing } = await supabase
    .from("prompter_product_media")
    .select("position")
    .eq("product_id", productId)
    .order("position", { ascending: false })
    .limit(1);

  const nextPosition = (existing?.[0]?.position ?? -1) + 1;

  const { error: insertError } = await supabase.from("prompter_product_media").insert({
    tenant_id: session.tenantId,
    product_id: productId,
    storage_path: storagePath,
    media_type: mediaType,
    position: nextPosition,
  });

  if (insertError) {
    return { error: "Foto/video belum berhasil diunggah. Coba lagi." };
  }

  revalidatePath(`/products/${productId}`);
  return { error: null };
}

export async function deleteProductMediaAction(formData: FormData): Promise<void> {
  const mediaId = formData.get("mediaId");
  const productId = formData.get("productId");
  const storagePath = formData.get("storagePath");

  if (typeof mediaId !== "string" || typeof productId !== "string" || typeof storagePath !== "string") {
    return;
  }

  // Defense-in-depth: every other resource-scoped action in this file
  // explicitly re-verifies tenant ownership rather than relying solely on
  // RLS (which already blocks this — storage.objects and
  // prompter_product_media policies are both tenant-scoped). Kept
  // consistent with that pattern rather than being the one exception.
  const session = await requireSessionContext();
  const supabase = await createClient();

  await supabase.storage.from("product-media").remove([storagePath]);
  await supabase
    .from("prompter_product_media")
    .delete()
    .eq("id", mediaId)
    .eq("tenant_id", session.tenantId);

  revalidatePath(`/products/${productId}`);
}

export async function generateMarketingBlueprintAction(productId: string): Promise<ActionState> {
  const session = await requireSessionContext();
  const supabase = await createClient();

  const { data: product, error: productError } = await supabase
    .from("prompter_products")
    .select("*")
    .eq("id", productId)
    .eq("tenant_id", session.tenantId)
    .single();

  if (productError || !product) {
    return { error: "Produk tidak ditemukan." };
  }

  const { data: brandProfile } = await supabase
    .from("prompter_brand_profiles")
    .select("*")
    .eq("tenant_id", session.tenantId)
    .maybeSingle();

  const result = await runAiJob({
    supabase,
    tenantId: session.tenantId,
    actorUserId: session.userId,
    jobType: "MARKETING_BLUEPRINT",
    schema: MarketingBlueprintSchema,
    system: buildSystemPreamble(brandProfile),
    prompt: buildMarketingBlueprintPrompt(product, brandProfile?.country_code ?? null),
    inputReference: { product_id: productId },
  });

  if (!result.ok) {
    return { error: result.error };
  }

  const { error: upsertError } = await supabase.from("prompter_marketing_blueprints").upsert(
    {
      tenant_id: session.tenantId,
      product_id: productId,
      summary: result.data.summary,
      usp: result.data.usp,
      benefits: result.data.benefits,
      pain_points: result.data.pain_points,
      target_personas: result.data.target_personas,
      positioning: result.data.positioning,
      marketing_angles: result.data.marketing_angles,
      recommended_channels: result.data.recommended_channels,
      content_ideas: result.data.content_ideas,
      risks: result.data.risks,
      disclaimers: result.data.disclaimers,
      // Real tenant/product data, never AI-invented (product spec §10) —
      // localization_strategy is the one field the AI actually reasons about.
      home_market: brandProfile?.country_code ?? null,
      target_markets: Array.isArray(product.target_countries) ? product.target_countries : [],
      target_languages: product.language ? [product.language] : [],
      target_currency: product.currency,
      localization_strategy: result.data.localization_strategy || null,
      ai_job_id: result.jobId,
      model: result.model,
    },
    { onConflict: "product_id" },
  );

  if (upsertError) {
    return { error: "AI berhasil membuat blueprint tapi gagal menyimpannya. Silakan coba lagi." };
  }

  revalidatePath(`/products/${productId}`);
  return { error: null };
}
