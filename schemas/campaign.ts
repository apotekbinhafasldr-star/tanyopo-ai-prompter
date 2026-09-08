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

/**
 * Quick Promote's own, smaller input contract — kept separate from
 * promoteWizardSchema (the full Advanced wizard) so loosening what's
 * required here can never change validation for that existing flow.
 * Only product + objective + a budget are required; channels and audience
 * targeting are optional "Advanced" fields — leaving them empty is the
 * Quick Promote default ("biarkan LINOE AI memilih strategi terbaik"),
 * not an error.
 */
export const quickPromoteSchema = z
  .object({
    productId: z.string().uuid("Pilih produk terlebih dahulu"),
    objective: z.enum(primaryGoals.map((g) => g.value) as [string, ...string[]], {
      message: "Pilih tujuan promosi",
    }),
    // Every remaining field below gets its own explicit Indonesian message
    // (rather than relying on Zod's default text) so a real validation
    // failure never surfaces a raw technical string like "Invalid input" —
    // only genuinely-required fields above can still fail with a generic
    // shape, and those already have clear messages too.
    dailyBudget: z.coerce
      .number({ message: "Budget harian harus berupa angka" })
      .min(0, "Budget harian tidak boleh negatif")
      .optional(),
    totalBudget: z.coerce
      .number({ message: "Budget total harus berupa angka" })
      .min(0, "Budget total tidak boleh negatif")
      .optional(),
    channels: z
      .array(z.enum(channelOptions.map((c) => c.value) as [string, ...string[]], { message: "Channel tidak dikenali" }))
      .optional(),
    targetCountry: z.string().trim().max(100, "Nama negara terlalu panjang").optional().or(z.literal("")),
    targetRegion: z.string().trim().max(100, "Nama provinsi terlalu panjang").optional().or(z.literal("")),
    targetCity: z.string().trim().max(100, "Nama kota terlalu panjang").optional().or(z.literal("")),
    audienceNotes: z.string().trim().max(1000, "Catatan audiens maksimal 1000 karakter").optional().or(z.literal("")),
    durationDays: z.coerce
      .number({ message: "Durasi harus berupa angka" })
      .int("Durasi harus bilangan bulat")
      .min(1, "Durasi minimal 1 hari")
      .max(365, "Durasi maksimal 365 hari")
      .optional(),
    startDate: z.string().trim().optional().or(z.literal("")),
  })
  .refine((data) => (data.dailyBudget ?? 0) > 0 || (data.totalBudget ?? 0) > 0, {
    message: "Masukkan budget harian atau budget total",
    path: ["dailyBudget"],
  });

export type QuickPromoteInput = z.infer<typeof quickPromoteSchema>;
