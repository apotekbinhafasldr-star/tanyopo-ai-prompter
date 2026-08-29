"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSessionContext } from "@/services/session";
import { contentGeneratorSchema } from "@/schemas/content";
import { ContentGenerationSchema } from "@/schemas/ai/content-generation";
import { getAIProvider } from "@/lib/ai/get-provider";
import { buildSystemPreamble, buildContentPrompt } from "@/lib/ai/prompts";
import { runAiJob } from "@/services/ai-jobs";
import type { ContentPlatform, ContentType, PrimaryGoal } from "@/types/database";

export interface ContentActionState {
  error: string | null;
}

export async function generateContentAction(
  _prevState: ContentActionState,
  formData: FormData,
): Promise<ContentActionState> {
  const parsed = contentGeneratorSchema.safeParse({
    productId: formData.get("productId"),
    platform: formData.get("platform"),
    contentType: formData.get("contentType"),
    goal: formData.get("goal") || undefined,
    tone: formData.get("tone"),
    language: formData.get("language") || "id",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data tidak valid" };
  }

  const session = await requireSessionContext();
  const supabase = await createClient();

  const provider = getAIProvider();
  if (!provider) {
    return { error: "AI belum dikonfigurasi. Tambahkan AI_PROVIDER_API_KEY untuk mengaktifkan fitur ini." };
  }

  const { data: product, error: productError } = await supabase
    .from("prompter_products")
    .select("*")
    .eq("id", parsed.data.productId)
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

  const inputs = {
    platform: parsed.data.platform,
    contentType: parsed.data.contentType,
    goal: parsed.data.goal || null,
    tone: parsed.data.tone || null,
    language: parsed.data.language,
  };

  const result = await runAiJob({
    supabase,
    provider,
    tenantId: session.tenantId,
    jobType: "CONTENT_GENERATION",
    schema: ContentGenerationSchema,
    system: buildSystemPreamble(brandProfile),
    prompt: buildContentPrompt(product, inputs),
    inputReference: { product_id: product.id, ...inputs },
  });

  if (!result.ok) {
    return { error: result.error };
  }

  const { error: insertError } = await supabase.from("prompter_content_items").insert({
    tenant_id: session.tenantId,
    product_id: product.id,
    platform: parsed.data.platform as ContentPlatform,
    content_type: parsed.data.contentType as ContentType,
    goal: (parsed.data.goal || null) as PrimaryGoal | null,
    tone: parsed.data.tone || null,
    language: parsed.data.language,
    body: result.data,
    ai_job_id: result.jobId,
  });

  if (insertError) {
    return { error: "AI berhasil membuat konten tapi gagal menyimpannya. Silakan coba lagi." };
  }

  revalidatePath("/content");
  revalidatePath(`/products/${product.id}`);
  return { error: null };
}
