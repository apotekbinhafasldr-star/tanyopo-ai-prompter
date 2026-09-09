import { z } from "zod";

/**
 * Batch B5 — SEO & Discovery. `discoveryMode` defaults to "WEBSITE" so
 * every existing call site (and the pre-B5 test suite) that never passes
 * it keeps behaving exactly as before: websiteUrl required, validated as
 * a real URL. "NO_WEBSITE" is the new path — websiteUrl stays optional
 * there, since a UMKM with only Instagram/TikTok/WhatsApp genuinely has
 * no URL to give.
 *
 * `.nullish()` (not `.optional()`) on the optional fields below: the form
 * only renders the websiteUrl/productId/whatsappNumber inputs when
 * relevant, so `formData.get(...)` returns `null` — not `undefined` — for
 * whichever ones are absent. `.optional()` alone rejects `null`.
 */
export const seoProjectSchema = z
  .object({
    discoveryMode: z.enum(["WEBSITE", "NO_WEBSITE"]).default("WEBSITE"),
    websiteUrl: z.string().trim().url("URL tidak valid").nullish().or(z.literal("")),
    targetKeywords: z
      .string()
      .trim()
      .max(1000)
      .nullish()
      .or(z.literal(""))
      .transform((v) =>
        (v ?? "")
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean),
      ),
    // Context inheritance (Batch B5) — set when the project is opened from
    // a product/campaign, so a later visit/regenerate can re-derive
    // business context without asking again.
    productId: z.string().trim().uuid().nullish().or(z.literal("")),
    // Optional CTA/contact number for a NO_WEBSITE project. Never used to
    // send anything — see prompter_brand_profiles.whatsapp_number comment.
    whatsappNumber: z.string().trim().max(50).nullish().or(z.literal("")),
  })
  .superRefine((data, ctx) => {
    if (data.discoveryMode === "WEBSITE" && !data.websiteUrl) {
      ctx.addIssue({ code: "custom", message: "URL tidak valid", path: ["websiteUrl"] });
    }
  });

export type SeoProjectInput = z.infer<typeof seoProjectSchema>;
