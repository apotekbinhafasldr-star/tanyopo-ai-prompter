import { z } from "zod";
import { businessCategories } from "@/schemas/onboarding";
import { SUPPORTED_CURRENCIES } from "@/schemas/global-preferences";

export const productSchema = z.object({
  name: z.string().trim().min(2, "Nama produk minimal 2 karakter").max(200),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  productType: z.enum(
    businessCategories.map((c) => c.value) as [string, ...string[]],
    { message: "Pilih jenis produk" },
  ),
  category: z.string().trim().max(100).optional().or(z.literal("")),
  price: z.coerce.number().min(0, "Harga tidak boleh negatif").optional(),
  currency: z.enum(SUPPORTED_CURRENCIES).optional(),
  stock: z.coerce.number().int().min(0, "Stok tidak boleh negatif").optional(),
  hpp: z.coerce.number().min(0, "HPP tidak boleh negatif").optional(),
  websiteUrl: z.string().trim().url("URL tidak valid").optional().or(z.literal("")),
  // Comma-separated ISO 3166-1 alpha-2 codes from a plain text input —
  // see product-form.tsx. Kept as free text rather than a multi-select
  // component to stay within this pass's scope; still validated shape
  // per code below.
  targetCountries: z.string().trim().max(500).optional().or(z.literal("")),
  language: z.enum(["id", "en"]).optional(),
});

export type ProductInput = z.infer<typeof productSchema>;

export const MAX_PRODUCT_MEDIA_BYTES = 100 * 1024 * 1024;
export const ALLOWED_PRODUCT_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
];
