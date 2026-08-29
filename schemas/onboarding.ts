import { z } from "zod";

export const businessCategories = [
  { value: "PHYSICAL_PRODUCT", label: "Produk Fisik" },
  { value: "SERVICE", label: "Jasa" },
  { value: "APPLICATION", label: "Aplikasi" },
  { value: "SUBSCRIPTION", label: "Langganan" },
  { value: "DIGITAL_PRODUCT", label: "Produk Digital" },
] as const;

export const primaryGoals = [
  { value: "INCREASE_SALES", label: "Tambah Penjualan" },
  { value: "GET_LEADS", label: "Dapatkan Leads" },
  { value: "INCREASE_FOLLOWERS", label: "Tambah Followers" },
  { value: "BRAND_AWARENESS", label: "Kenalkan Brand" },
  { value: "WEBSITE_TRAFFIC", label: "Trafik Website" },
  { value: "PROMOTE_APP", label: "Promosikan Aplikasi" },
] as const;

export const onboardingSchema = z.object({
  brandName: z.string().trim().min(2, "Nama bisnis minimal 2 karakter").max(120),
  businessCategory: z.enum(
    businessCategories.map((c) => c.value) as [string, ...string[]],
    { message: "Pilih jenis bisnis" },
  ),
  whatDoYouSell: z.string().trim().min(3, "Ceritakan sedikit tentang produk/jasa Anda").max(500),
  primaryGoal: z.enum(primaryGoals.map((g) => g.value) as [string, ...string[]], {
    message: "Pilih tujuan utama",
  }),
});

export type OnboardingInput = z.infer<typeof onboardingSchema>;
