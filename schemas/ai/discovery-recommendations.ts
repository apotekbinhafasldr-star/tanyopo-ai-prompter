import { z } from "zod";

/**
 * Batch B5 — structured output for a tenant with no website (SEO &
 * Discovery, NO_WEBSITE mode). Same discipline as SeoRecommendationsSchema
 * (schemas/ai/seo-recommendations.ts): a set of suggestions to review, not
 * anything this app applies automatically — there is no social-profile-
 * editing, posting, or WhatsApp-sending integration behind this. The
 * prompt (lib/ai/prompts.ts#buildDiscoveryRecommendationsPrompt) instructs
 * the model never to promise a specific ranking, follower count, view
 * count, or sales figure; recommended_channels is deliberately never
 * WHATSAPP — WhatsApp is the contact/CTA destination this recommends
 * driving people to, not a place people discover a business by searching.
 */
export const DiscoveryRecommendationsSchema = z.object({
  primary_keywords: z
    .array(z.string())
    .min(1)
    .max(8)
    .describe("Kata kunci utama yang paling menggambarkan bisnis/produk ini"),
  supporting_keywords: z
    .array(z.string())
    .max(15)
    .describe("Kata kunci pendukung/variasi — boleh kosong jika primary_keywords sudah cukup"),
  profile_name_tip: z.string().describe("Saran singkat untuk nama/username profil agar lebih mudah ditemukan"),
  bio_recommendation: z.string().describe("Saran bio/deskripsi singkat untuk profil bisnis"),
  content_ideas: z
    .array(
      z.object({
        title: z.string().describe("Ide judul/topik konten atau caption"),
        angle: z.string().describe("Alasan singkat kenapa topik ini relevan/dicari target pelanggan"),
      }),
    )
    .min(1)
    .max(8),
  hashtags: z
    .array(z.string())
    .max(15)
    .describe("Hashtag relevan bila sesuai — array kosong jika tidak relevan untuk bisnis ini"),
  cta_recommendation: z
    .string()
    .describe("Saran CTA yang mengarahkan ke WhatsApp/kontak/link produk — bukan janji hasil penjualan"),
  recommended_channels: z
    .array(
      z.object({
        channel: z.enum(["INSTAGRAM", "FACEBOOK", "TIKTOK", "MARKETPLACE"]),
        reason: z.string().describe("Alasan sederhana, non-teknis, berdasarkan jenis bisnis dan target audiens"),
      }),
    )
    .min(1)
    .max(4),
});

export type DiscoveryRecommendations = z.infer<typeof DiscoveryRecommendationsSchema>;
