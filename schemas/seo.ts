import { z } from "zod";

export const seoProjectSchema = z.object({
  websiteUrl: z.string().trim().url("URL tidak valid"),
  targetKeywords: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .or(z.literal(""))
    .transform((v) =>
      (v ?? "")
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
    ),
});
export type SeoProjectInput = z.infer<typeof seoProjectSchema>;
