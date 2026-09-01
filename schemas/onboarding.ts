import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@/schemas/global-preferences";

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

const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "Kode negara harus 2 huruf (ISO 3166-1 alpha-2).");

export const onboardingSchema = z.object({
  brandName: z.string().trim().min(2, "Nama bisnis minimal 2 karakter").max(120),
  // Business home market (product spec §6 items 3-6) — standalone
  // international users set this themselves; UMKMpro-linked tenants get
  // it defaulted to ID and can change it here like anyone else.
  countryCode: countryCodeSchema,
  language: z.enum(["id", "en"], { message: "Pilih bahasa" }),
  timezone: z.string().trim().min(1, "Pilih zona waktu"),
  currency: z.enum(SUPPORTED_CURRENCIES, { message: "Pilih mata uang" }),
  businessCategory: z.enum(
    businessCategories.map((c) => c.value) as [string, ...string[]],
    { message: "Pilih jenis bisnis" },
  ),
  whatDoYouSell: z.string().trim().min(3, "Ceritakan sedikit tentang produk/jasa Anda").max(500),
  primaryGoal: z.enum(primaryGoals.map((g) => g.value) as [string, ...string[]], {
    message: "Pilih tujuan utama",
  }),
  // Campaign target market (product spec §6 item 9, §8) — optional and
  // independent of countryCode above. Blank means "same as home market".
  targetMarketCountryCode: z.union([countryCodeSchema, z.literal("")]).optional(),
});

export type OnboardingInput = z.infer<typeof onboardingSchema>;
