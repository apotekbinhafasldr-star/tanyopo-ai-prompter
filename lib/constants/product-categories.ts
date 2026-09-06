import type { BusinessCategory } from "@/types/database";

/**
 * Suggested categories per product type — a starting point, not a closed
 * list. `category` on prompter_products stays free text (see
 * schemas/products.ts), so a user can always type a category that isn't
 * suggested here; nothing rejects an unlisted value.
 */
export const PRODUCT_CATEGORY_SUGGESTIONS: Record<BusinessCategory, readonly string[]> = {
  PHYSICAL_PRODUCT: [
    "Makanan & Minuman",
    "Kecantikan & Skincare",
    "Kesehatan",
    "Fashion",
    "Elektronik",
    "Rumah Tangga",
    "Otomotif",
    "ATK",
    "Bayi & Anak",
    "Pertanian",
    "Produk Lainnya",
  ],
  SERVICE: [
    "Jasa Kecantikan & Perawatan",
    "Jasa Kebersihan",
    "Jasa Perbaikan & Servis",
    "Jasa Desain & Kreatif",
    "Jasa Konsultasi",
    "Jasa Pendidikan & Kursus",
    "Jasa Event & Dekorasi",
    "Jasa Transportasi & Logistik",
    "Jasa Lainnya",
  ],
  APPLICATION: [
    "Produktivitas",
    "E-commerce & Marketplace",
    "Keuangan & Fintech",
    "Kesehatan & Kebugaran",
    "Pendidikan",
    "Hiburan & Media",
    "Sosial & Komunitas",
    "Aplikasi Lainnya",
  ],
  SUBSCRIPTION: [
    "Langganan Konten & Media",
    "Langganan Software (SaaS)",
    "Langganan Kotak Produk",
    "Langganan Kebugaran & Kesehatan",
    "Langganan Pendidikan",
    "Langganan Lainnya",
  ],
  DIGITAL_PRODUCT: [
    "E-book & Panduan",
    "Kursus Online",
    "Template & Desain",
    "Software & Plugin",
    "Musik & Audio",
    "Foto & Video",
    "Produk Digital Lainnya",
  ],
};

export function categorySuggestionsFor(productType: string | null | undefined): readonly string[] {
  if (productType && productType in PRODUCT_CATEGORY_SUGGESTIONS) {
    return PRODUCT_CATEGORY_SUGGESTIONS[productType as BusinessCategory];
  }
  return PRODUCT_CATEGORY_SUGGESTIONS.PHYSICAL_PRODUCT;
}
