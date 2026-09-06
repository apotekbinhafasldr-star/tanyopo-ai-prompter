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
  // Free text ("pcs", "box", "kg", ...) — see lib/constants/stock-units.ts
  // for suggestions, but a custom unit is always accepted. Only meaningful
  // alongside `stock`; kept optional so services/apps with no stock concept
  // can leave both blank.
  stockUnit: z.string().trim().max(40).optional().or(z.literal("")),
  hpp: z.coerce.number().min(0, "HPP tidak boleh negatif").optional(),
  websiteUrl: z.string().trim().url("URL tidak valid").optional().or(z.literal("")),
  // Comma-separated ISO 3166-1 alpha-2 codes — produced by the searchable
  // multi-select picker in product-form.tsx (CountryMultiSelect), which
  // writes a hidden comma-joined input under this same field name so this
  // parsing/shape stays unchanged from the original free-text version.
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
