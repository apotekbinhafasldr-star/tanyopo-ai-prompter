import { z } from "zod";

/**
 * AI Search Readiness (SEO & Discovery, Tahap 1) — AEO + GEO planning output.
 *
 * AEO: pertanyaan nyata calon pelanggan + jawaban ringkas yang HANYA boleh
 * bersandar pada fakta terverifikasi milik tenant (lihat
 * lib/seo/ai-search-readiness.ts#buildVerifiedFacts).
 * GEO: konteks entitas (siapa/apa bisnis ini) dan rekomendasi konten.
 *
 * Ini rencana konten untuk ditinjau pemilik bisnis. LINOE tidak mengukur,
 * tidak menjamin, dan tidak mengklaim kemunculan di ChatGPT/Gemini/Perplexity/
 * Google AI Overviews.
 *
 * Strict structured outputs: setiap properti wajib ada; nilai opsional memakai
 * .nullable(), bukan .optional() (lihat tests/unit/schemas/ai-discovery-recommendations.test.ts).
 */
export const AiSearchReadinessSchema = z.object({
  customer_questions: z
    .array(
      z.object({
        question: z.string().describe("Pertanyaan yang wajar ditanyakan calon pelanggan"),
        short_answer: z
          .string()
          .nullable()
          .describe("Jawaban 1-2 kalimat HANYA dari fakta terverifikasi; null jika fakta belum cukup"),
        owner_input_needed: z
          .string()
          .nullable()
          .describe("Data yang perlu dilengkapi pemilik bila short_answer null; null jika tidak perlu"),
      }),
    )
    .min(3)
    .max(8),
  entity_context: z
    .string()
    .describe("1-3 kalimat: siapa/apa bisnis & produk ini, hanya dari fakta terverifikasi"),
  content_recommendations: z
    .array(
      z.object({
        title: z.string(),
        format: z.enum(["FAQ", "ARTICLE", "PRODUCT_PAGE", "SOCIAL_POST", "PROFILE_BIO"]),
        reason: z.string().describe("Kenapa konten ini membantu pertanyaan pelanggan terjawab jelas"),
      }),
    )
    .min(1)
    .max(5),
  missing_facts: z
    .array(z.string())
    .max(8)
    .describe("Fakta yang sebaiknya dilengkapi pemilik agar jawaban akurat; array kosong bila lengkap"),
});

export type AiSearchReadinessAi = z.infer<typeof AiSearchReadinessSchema>;
