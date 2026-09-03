"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSessionContext } from "@/services/session";
import { productSchema, ALLOWED_PRODUCT_MEDIA_TYPES, MAX_PRODUCT_MEDIA_BYTES } from "@/schemas/products";
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
  redirect(`/products/${data.id}`);
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

export async function uploadProductMediaAction(
  productId: string,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSessionContext();
  const supabase = await createClient();

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    return { error: "Pilih minimal satu file." };
  }

  for (const file of files) {
    if (!ALLOWED_PRODUCT_MEDIA_TYPES.includes(file.type)) {
      return { error: `Tipe file tidak didukung: ${file.type || file.name}` };
    }
    if (file.size > MAX_PRODUCT_MEDIA_BYTES) {
      return { error: `File terlalu besar: ${file.name}` };
    }
  }

  const { data: existing } = await supabase
    .from("prompter_product_media")
    .select("position")
    .eq("product_id", productId)
    .order("position", { ascending: false })
    .limit(1);

  let nextPosition = (existing?.[0]?.position ?? -1) + 1;

  for (const file of files) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${session.tenantId}/${productId}/${Date.now()}-${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from("product-media")
      .upload(path, file, { contentType: file.type, upsert: false });

    if (uploadError) {
      return { error: `Gagal mengunggah ${file.name}: ${uploadError.message}` };
    }

    const { error: insertError } = await supabase.from("prompter_product_media").insert({
      tenant_id: session.tenantId,
      product_id: productId,
      storage_path: path,
      media_type: file.type.startsWith("video") ? "VIDEO" : "IMAGE",
      position: nextPosition,
    });

    if (insertError) {
      await supabase.storage.from("product-media").remove([path]);
      return { error: `Gagal menyimpan data media ${file.name}.` };
    }

    nextPosition += 1;
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

  // Every other mutation in this file scopes to the caller's own tenant
  // explicitly rather than relying on RLS alone (defense in depth) — this
  // action was missing that second layer.
  const session = await requireSessionContext();
  const supabase = await createClient();

  await supabase.storage.from("product-media").remove([storagePath]);
  await supabase
    .from("prompter_product_media")
    .delete()
    .eq("id", mediaId)
    .eq("product_id", productId)
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
