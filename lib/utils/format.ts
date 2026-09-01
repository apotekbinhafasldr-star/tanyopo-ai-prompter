import type { Locale } from "@/types/database";

/** Locale -> real Intl locale tag. Defaults preserve exactly the
 * pre-Global-Edition behavior (always "id-ID") for every call site that
 * doesn't pass a locale. */
function toIntlLocale(locale: Locale): string {
  return locale === "en" ? "en-US" : "id-ID";
}

export function formatCurrency(value: number | null | undefined, currency = "IDR", locale: Locale = "id") {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat(toIntlLocale(locale), {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

/** `timeZone` renders the timestamp in that IANA zone (e.g. the tenant's
 * prompter_brand_profiles.default_timezone) rather than the server
 * runtime's own zone — product spec §17 "render times in user locale" /
 * "avoid assuming Asia/Jakarta globally". Omitted (the pre-existing
 * behavior at every call site that doesn't pass it) leaves the runtime's
 * own default zone, unchanged from before. */
export function formatDate(
  value: string | null | undefined,
  options: { locale?: Locale; timeZone?: string } = {},
) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(toIntlLocale(options.locale ?? "id"), {
    dateStyle: "medium",
    timeZone: options.timeZone,
  }).format(new Date(value));
}

const PRODUCT_TYPE_LABEL: Record<string, string> = {
  PHYSICAL_PRODUCT: "Produk Fisik",
  SERVICE: "Jasa",
  APPLICATION: "Aplikasi",
  SUBSCRIPTION: "Langganan",
  DIGITAL_PRODUCT: "Produk Digital",
};

export function productTypeLabel(type: string) {
  return PRODUCT_TYPE_LABEL[type] ?? type;
}

const GOAL_LABEL: Record<string, string> = {
  INCREASE_SALES: "Tambah Penjualan",
  GET_LEADS: "Dapatkan Leads",
  INCREASE_FOLLOWERS: "Tambah Followers",
  BRAND_AWARENESS: "Kenalkan Brand",
  WEBSITE_TRAFFIC: "Trafik Website",
  PROMOTE_APP: "Promosikan Aplikasi",
};

export function goalLabel(goal: string) {
  return GOAL_LABEL[goal] ?? goal;
}

const CHANNEL_LABEL: Record<string, string> = {
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  TIKTOK: "TikTok",
  X: "X",
  SEO: "SEO",
  WEBSITE: "Website",
};

export function channelLabel(channel: string) {
  return CHANNEL_LABEL[channel] ?? channel;
}

const CAMPAIGN_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  AWAITING_APPROVAL: "Menunggu Persetujuan",
  SCHEDULED: "Terjadwal",
  ACTIVE: "Aktif",
  PAUSED: "Dijeda",
  COMPLETED: "Selesai",
  FAILED: "Gagal",
};

export function campaignStatusLabel(status: string) {
  return CAMPAIGN_STATUS_LABEL[status] ?? status;
}

const CAMPAIGN_STATUS_VARIANT: Record<
  string,
  "neutral" | "warning" | "brand" | "success" | "danger"
> = {
  DRAFT: "neutral",
  AWAITING_APPROVAL: "warning",
  SCHEDULED: "brand",
  ACTIVE: "success",
  PAUSED: "warning",
  COMPLETED: "success",
  FAILED: "danger",
};

export function campaignStatusVariant(status: string) {
  return CAMPAIGN_STATUS_VARIANT[status] ?? "neutral";
}
