import { z } from "zod";
import { primaryGoals } from "@/schemas/onboarding";

export const channelOptions = [
  { value: "FACEBOOK", label: "Facebook" },
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "TIKTOK", label: "TikTok" },
  { value: "X", label: "X" },
  { value: "SEO", label: "SEO" },
] as const;

export const promoteWizardSchema = z.object({
  productId: z.string().uuid("Pilih produk terlebih dahulu"),
  objective: z.enum(primaryGoals.map((g) => g.value) as [string, ...string[]], {
    message: "Pilih tujuan campaign",
  }),
  channels: z
    .array(z.enum(channelOptions.map((c) => c.value) as [string, ...string[]]))
    .min(1, "Pilih minimal satu channel"),
  targetCountry: z.string().trim().max(100).optional().or(z.literal("")),
  targetRegion: z.string().trim().max(100).optional().or(z.literal("")),
  targetCity: z.string().trim().max(100).optional().or(z.literal("")),
  audienceNotes: z.string().trim().max(1000).optional().or(z.literal("")),
  dailyBudget: z.coerce.number().min(0).optional(),
  totalBudget: z.coerce.number().min(0).optional(),
  durationDays: z.coerce.number().int().min(1).max(365).optional(),
  startDate: z.string().trim().optional().or(z.literal("")),
});

export type PromoteWizardInput = z.infer<typeof promoteWizardSchema>;
