"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSessionContext } from "@/services/session";
import { contentGeneratorSchema } from "@/schemas/content";
import { ContentGenerationSchema } from "@/schemas/ai/content-generation";
import { buildSystemPreamble, buildContentPrompt } from "@/lib/ai/prompts";
import { runAiJob } from "@/services/ai-jobs";
import { parseLocalDateTimeInZone } from "@/lib/scheduling/recommend-time";
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
    tenantId: session.tenantId,
    actorUserId: session.userId,
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

/**
 * Sets or clears a content item's schedule (Phase 5 content calendar;
 * upgraded for Batch B3 — Smart Scheduling to carry a real time-of-day,
 * not just a date). A DRAFT item moving to a scheduled time becomes
 * SCHEDULED; clearing it on a SCHEDULED item reverts to DRAFT rather than
 * leaving a "scheduled with no date" state. APPROVED/PUBLISHED/FAILED
 * items keep their status as-is — scheduling is metadata about *when*,
 * not a re-approval.
 *
 * `scheduledAt` arrives as a naive `datetime-local` wall-clock string
 * ("YYYY-MM-DDTHH:mm") — the browser has no idea what timezone that's
 * meant to represent, so it's interpreted as the TENANT's own configured
 * timezone (prompter_brand_profiles.default_timezone), never the
 * server's or a hardcoded one, before being converted to the real UTC
 * instant actually stored.
 */
export async function scheduleContentAction(
  contentItemId: string,
  _prevState: ContentActionState,
  formData: FormData,
): Promise<ContentActionState> {
  const scheduledAtRaw = formData.get("scheduledAt");
  const localValue = typeof scheduledAtRaw === "string" ? scheduledAtRaw.trim() : "";

  const session = await requireSessionContext();
  const supabase = await createClient();

  const { data: item, error: itemError } = await supabase
    .from("prompter_content_items")
    .select("id, status")
    .eq("id", contentItemId)
    .eq("tenant_id", session.tenantId)
    .single();

  if (itemError || !item) {
    return { error: "Konten tidak ditemukan." };
  }

  let scheduledAt: string | null = null;
  if (localValue) {
    const { data: brandProfile } = await supabase
      .from("prompter_brand_profiles")
      .select("default_timezone")
      .eq("tenant_id", session.tenantId)
      .maybeSingle();
    const timeZone = brandProfile?.default_timezone ?? "Asia/Jakarta";

    const parsed = parseLocalDateTimeInZone(localValue, timeZone);
    if (!parsed) {
      return { error: "Format tanggal/jam tidak valid." };
    }
    scheduledAt = parsed.toISOString();
  }

  let nextStatus = item.status;
  if (scheduledAt && item.status === "DRAFT") {
    nextStatus = "SCHEDULED";
  } else if (!scheduledAt && item.status === "SCHEDULED") {
    nextStatus = "DRAFT";
  }

  const { error } = await supabase
    .from("prompter_content_items")
    .update({ scheduled_at: scheduledAt, status: nextStatus })
    .eq("id", contentItemId);

  if (error) {
    return { error: "Gagal menyimpan jadwal konten." };
  }

  revalidatePath("/content");
  return { error: null };
}
