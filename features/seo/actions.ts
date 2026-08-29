"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSessionContext } from "@/services/session";
import { seoProjectSchema } from "@/schemas/seo";
import { SeoRecommendationsSchema } from "@/schemas/ai/seo-recommendations";
import { getAIProvider } from "@/lib/ai/get-provider";
import { buildSystemPreamble, buildSeoRecommendationsPrompt } from "@/lib/ai/prompts";
import { runAiJob } from "@/services/ai-jobs";

export interface SeoActionState {
  error: string | null;
}

function requireWriteAccess(role: string): string | null {
  if (role !== "owner" && role !== "marketing") {
    return "Hanya Owner/Marketing yang dapat mengelola project SEO.";
  }
  return null;
}

export async function createSeoProjectAction(
  _prevState: SeoActionState,
  formData: FormData,
): Promise<SeoActionState> {
  const parsed = seoProjectSchema.safeParse({
    websiteUrl: formData.get("websiteUrl"),
    targetKeywords: formData.get("targetKeywords"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Data tidak valid" };
  }

  const session = await requireSessionContext();
  const permissionError = requireWriteAccess(session.role);
  if (permissionError) return { error: permissionError };

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("prompter_seo_projects")
    .insert({
      tenant_id: session.tenantId,
      website_url: parsed.data.websiteUrl,
      target_keywords: parsed.data.targetKeywords,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { error: "Gagal menyimpan project SEO. Silakan coba lagi." };
  }

  revalidatePath("/seo");
  redirect(`/seo/${data.id}`);
}

export async function generateSeoRecommendationsAction(projectId: string): Promise<SeoActionState> {
  const session = await requireSessionContext();
  const permissionError = requireWriteAccess(session.role);
  if (permissionError) return { error: permissionError };

  const supabase = await createClient();

  const provider = getAIProvider();
  if (!provider) {
    return { error: "AI belum dikonfigurasi. Tambahkan AI_PROVIDER_API_KEY untuk mengaktifkan fitur ini." };
  }

  const { data: project, error: projectError } = await supabase
    .from("prompter_seo_projects")
    .select("*")
    .eq("id", projectId)
    .eq("tenant_id", session.tenantId)
    .single();

  if (projectError || !project) {
    return { error: "Project SEO tidak ditemukan." };
  }

  const { data: brandProfile } = await supabase
    .from("prompter_brand_profiles")
    .select("*")
    .eq("tenant_id", session.tenantId)
    .maybeSingle();

  const result = await runAiJob({
    supabase,
    provider,
    tenantId: session.tenantId,
    jobType: "SEO_RECOMMENDATIONS",
    schema: SeoRecommendationsSchema,
    system: buildSystemPreamble(brandProfile),
    prompt: buildSeoRecommendationsPrompt({
      websiteUrl: project.website_url,
      targetKeywords: (project.target_keywords as string[]) ?? [],
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
      model: "claude-opus-5",
    },
    { onConflict: "project_id" },
  );

  if (upsertError) {
    return { error: "AI berhasil membuat rekomendasi tapi gagal menyimpannya. Silakan coba lagi." };
  }

  revalidatePath(`/seo/${projectId}`);
  return { error: null };
}
