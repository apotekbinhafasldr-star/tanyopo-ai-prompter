export function formatCurrency(value: number | null | undefined, currency = "IDR") {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(new Date(value));
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
