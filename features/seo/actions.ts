"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSessionContext } from "@/services/session";
import { seoProjectSchema } from "@/schemas/seo";
import { SeoRecommendationsSchema } from "@/schemas/ai/seo-recommendations";
import { DiscoveryRecommendationsSchema } from "@/schemas/ai/discovery-recommendations";
import { buildSystemPreamble, buildSeoRecommendationsPrompt, buildDiscoveryRecommendationsPrompt } from "@/lib/ai/prompts";
import { runAiJob } from "@/services/ai-jobs";

export interface SeoActionState {
  error: string | null;
}

function requireWriteAccess(role: string): string | null {
  if (role !== "owner" && role !== "marketing") {
    return "Hanya Owner/Marketing yang dapat mengelola project SEO & Discovery.";
  }
  return null;
}

/**
 * Batch B5 — handles both discovery modes on the same project row
 * (prompter_seo_projects.discovery_mode). WEBSITE keeps requiring a real
 * URL (enforced by schemas/seo.ts's superRefine, unchanged for anyone not
 * passing discoveryMode); NO_WEBSITE never requires or fabricates one.
 * A WhatsApp number entered here is saved onto the tenant's brand profile
 * (only if one isn't already on file) so it's reused automatically next
 * time, instead of being asked for again.
 */
export async function createSeoProjectAction(
  _prevState: SeoActionState,
  formData: FormData,
): Promise<SeoActionState> {
  const parsed = seoProjectSchema.safeParse({
    discoveryMode: formData.get("discoveryMode") || undefined,
    websiteUrl: formData.get("websiteUrl"),
    targetKeywords: formData.get("targetKeywords"),
    productId: formData.get("productId"),
    whatsappNumber: formData.get("whatsappNumber"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data tidak valid" };
  }

  const session = await requireSessionContext();
  const permissionError = requireWriteAccess(session.role);
  if (permissionError) return { error: permissionError };

  const supabase = await createClient();

  const { data: brandProfile } = await supabase
    .from("prompter_brand_profiles")
    .select("country_code, default_language, whatsapp_number")
    .eq("tenant_id", session.tenantId)
    .maybeSingle();

  if (parsed.data.whatsappNumber && !brandProfile?.whatsapp_number) {
    await supabase
      .from("prompter_brand_profiles")
      .update({ whatsapp_number: parsed.data.whatsappNumber })
      .eq("tenant_id", session.tenantId);
  }

  const { data, error } = await supabase
    .from("prompter_seo_projects")
    .insert({
      tenant_id: session.tenantId,
      discovery_mode: parsed.data.discoveryMode,
      website_url: parsed.data.discoveryMode === "WEBSITE" ? parsed.data.websiteUrl || null : null,
      target_keywords: parsed.data.targetKeywords,
      country_code: brandProfile?.country_code ?? null,
      language: brandProfile?.default_language ?? null,
      product_id: parsed.data.productId || null,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { error: "Gagal menyimpan project. Silakan coba lagi." };
  }

  revalidatePath("/seo");
  redirect(`/seo/${data.id}`);
}

export async function generateSeoRecommendationsAction(projectId: string): Promise<SeoActionState> {
  const session = await requireSessionContext();
  const permissionError = requireWriteAccess(session.role);
  if (permissionError) return { error: permissionError };

  const supabase = await createClient();

  const { data: project, error: projectError } = await supabase
    .from("prompter_seo_projects")
    .select("*")
    .eq("id", projectId)
    .eq("tenant_id", session.tenantId)
    .single();

  if (projectError || !project) {
    return { error: "Project tidak ditemukan." };
  }

  const { data: brandProfile } = await supabase
    .from("prompter_brand_profiles")
    .select("*")
    .eq("tenant_id", session.tenantId)
    .maybeSingle();

  if (project.discovery_mode === "NO_WEBSITE") {
    const { data: product } = project.product_id
      ? await supabase
          .from("prompter_products")
          .select("name, description, category, target_countries, language")
          .eq("id", project.product_id)
          .eq("tenant_id", session.tenantId)
          .maybeSingle()
      : { data: null };

    // Batch B2/B3 context, reused rather than re-asked: the most recent
    // campaign for this same product, if any, supplies an objective and
    // an already-recommended channel set as extra hints for the model.
    const { data: recentCampaign } = project.product_id
      ? await supabase
          .from("prompter_master_campaigns")
          .select("objective, channels")
          .eq("product_id", project.product_id)
          .eq("tenant_id", session.tenantId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null };

    const result = await runAiJob({
      supabase,
      tenantId: session.tenantId,
      actorUserId: session.userId,
      jobType: "SEO_RECOMMENDATIONS",
      schema: DiscoveryRecommendationsSchema,
      system: buildSystemPreamble(brandProfile),
      prompt: buildDiscoveryRecommendationsPrompt({
        businessName: brandProfile?.brand_name,
        productName: product?.name,
        productDescription: product?.description,
        productCategory: product?.category,
        targetCountries: (product?.target_countries as string[] | undefined) ?? [],
        language: product?.language ?? brandProfile?.default_language,
        campaignObjective: recentCampaign?.objective ?? null,
        existingChannels: recentCampaign?.channels ?? [],
        whatsappNumber: brandProfile?.whatsapp_number,
      }),
      inputReference: { seo_project_id: projectId },
    });

    if (!result.ok) {
      return { error: result.error };
    }

    const { error: upsertError } = await supabase.from("prompter_seo_recommendations").upsert(
      {
        tenant_id: session.tenantId,
        project_id: projectId,
        discovery_recommendations: result.data,
        ai_job_id: result.jobId,
        model: result.model,
      },
      { onConflict: "project_id" },
    );

    if (upsertError) {
      return { error: "AI berhasil membuat rekomendasi tapi gagal menyimpannya. Silakan coba lagi." };
    }

    revalidatePath(`/seo/${projectId}`);
    return { error: null };
  }

  const result = await runAiJob({
    supabase,
    tenantId: session.tenantId,
    actorUserId: session.userId,
    jobType: "SEO_RECOMMENDATIONS",
    schema: SeoRecommendationsSchema,
    system: buildSystemPreamble(brandProfile),
    prompt: buildSeoRecommendationsPrompt({
      websiteUrl: project.website_url ?? "",
      targetKeywords: (project.target_keywords as string[]) ?? [],
      countryCode: project.country_code,
      language: project.language,
    }),
    inputReference: { seo_project_id: projectId },
  });

  if (!result.ok) {
    return { error: result.error };
  }

  const { error: upsertError } = await supabase.from("prompter_seo_recommendations").upsert(
    {
      tenant_id: session.tenantId,
      project_id: projectId,
      summary: result.data.summary,
      target_keywords: result.data.target_keywords,
      on_page_recommendations: result.data.on_page_recommendations,
      content_plan: result.data.content_plan,
      ai_job_id: result.jobId,
      model: result.model,
    },
    { onConflict: "project_id" },
  );

  if (upsertError) {
    return { error: "AI berhasil membuat rekomendasi tapi gagal menyimpannya. Silakan coba lagi." };
  }

  revalidatePath(`/seo/${projectId}`);
  return { error: null };
}
