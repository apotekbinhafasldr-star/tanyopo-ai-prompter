import { z } from "zod";
import { primaryGoals } from "@/schemas/onboarding";

export const contentPlatforms = [
  { value: "FACEBOOK", label: "Facebook" },
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "TIKTOK", label: "TikTok" },
  { value: "X", label: "X" },
  { value: "WEBSITE", label: "Website" },
] as const;

export const contentTypes = [
  { value: "CAPTION", label: "Caption" },
  { value: "AD_COPY", label: "Ad Copy" },
  { value: "BLOG", label: "Blog" },
  { value: "VIDEO_SCRIPT", label: "Video Script" },
] as const;

export const contentGeneratorSchema = z.object({
  productId: z.string().uuid("Pilih produk terlebih dahulu"),
  platform: z.enum(contentPlatforms.map((p) => p.value) as [string, ...string[]], {
    message: "Pilih platform",
  }),
  contentType: z.enum(contentTypes.map((c) => c.value) as [string, ...string[]], {
    message: "Pilih jenis konten",
  }),
  goal: z
    .enum(primaryGoals.map((g) => g.value) as [string, ...string[]])
    .optional()
    .or(z.literal("")),
  tone: z.string().trim().max(100).optional().or(z.literal("")),
  language: z.enum(["id", "en"]).default("id"),
});

export type ContentGeneratorInput = z.infer<typeof contentGeneratorSchema>;
