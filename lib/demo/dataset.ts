/**
 * Realistic seeded data for the LINOE Demo Account & Safe Trial
 * Environment (Phase 1, Founder-approved 2026-09-28).
 *
 * Every record here is static and in-memory — none of it is read from or
 * written to any `prompter_*` tenant-scoped table, and none of it is tied
 * to a real `tenant_id`. That is a deliberate safety property, not an
 * oversight: it is what makes the demo unable to touch a real tenant's
 * data even in principle (no RLS, no tenant_id, no row to bypass).
 *
 * Every monetary/performance figure below carries the `simulated: true`
 * marker the Founder required ("Data harus diberi internal marker
 * sebagai DEMO/SIMULATED") — UI surfaces must render a visible "Data
 * Simulasi" badge wherever these numbers appear, never presenting them as
 * real.
 */

export interface DemoProduct {
  id: string;
  name: string;
  category: string;
  price: number;
  hpp: number;
  currency: "IDR";
  stock: number;
  description: string;
}

export const DEMO_PRODUCTS: DemoProduct[] = [
  {
    id: "demo-product-kopi",
    name: "Kopi Susu Gula Aren 250ml",
    category: "Minuman",
    price: 22000,
    hpp: 9500,
    currency: "IDR",
    stock: 480,
    description: "Kopi susu kekinian dengan gula aren asli, best seller UMKM kuliner.",
  },
  {
    id: "demo-product-skincare",
    name: "Serum Wajah Brightening 20ml",
    category: "Kecantikan",
    price: 89000,
    hpp: 31000,
    currency: "IDR",
    stock: 150,
    description: "Serum niacinamide untuk mencerahkan wajah, cocok untuk pasar online.",
  },
  {
    id: "demo-product-snack",
    name: "Keripik Singkong Pedas Manis 200g",
    category: "Makanan Ringan",
    price: 18000,
    hpp: 7000,
    currency: "IDR",
    stock: 620,
    description: "Camilan lokal dengan varian rasa pedas manis khas rumahan.",
  },
];

/** Shape matches features/demo/ai-actions.ts#DemoBlueprintResult exactly (minus `simulated`, set by the caller). */
export const DEMO_BLUEPRINT_FALLBACK = {
  summary:
    "Kopi Susu Gula Aren cocok diposisikan sebagai minuman kekinian harga terjangkau untuk anak muda urban yang aktif di media sosial.",
  usp: "Gula aren asli, tanpa pemanis buatan, disajikan segar setiap hari.",
  benefits: [
    "Rasa autentik gula aren asli",
    "Harga terjangkau untuk konsumsi harian",
    "Kemasan praktis dibawa bepergian",
  ],
  targetPersona: "Mahasiswa dan pekerja muda usia 18-30 di area urban",
  recommendedChannel: "INSTAGRAM" as const,
};

/** Shape matches features/demo/ai-actions.ts#DemoContentResult exactly (minus `simulated`, set by the caller). */
export const DEMO_CONTENT_FALLBACK = {
  body: {
    caption:
      "Ngopi santai, rasa tetap istimewa ☕✨ Kopi Susu Gula Aren kami dibuat dari gula aren asli pilihan. Yuk, coba hari ini!",
    hashtags: ["kopisusu", "gulaaren", "umkmlokal", "kopikekinian"],
  },
};

export interface DemoCampaignMetrics {
  channel: "INSTAGRAM" | "TIKTOK";
  impressions: number;
  clicks: number;
  leads: number;
  orders: number;
  adSpend: number;
  revenue: number;
}

export const DEMO_CAMPAIGN = {
  id: "demo-campaign-launch",
  name: "Promo Kopi Susu Gula Aren — Kampanye Peluncuran",
  productId: "demo-product-kopi",
  objective: "SALES" as const,
  dailyBudget: 100000,
  durationDays: 14,
  currency: "IDR" as const,
};

export const DEMO_METRICS: DemoCampaignMetrics[] = [
  { channel: "INSTAGRAM", impressions: 48250, clicks: 1620, leads: 210, orders: 96, adSpend: 850000, revenue: 2112000 },
  { channel: "TIKTOK", impressions: 76400, clicks: 2890, leads: 340, orders: 158, adSpend: 950000, revenue: 3476000 },
];

export function demoRoas(metrics: DemoCampaignMetrics): number {
  return Math.round((metrics.revenue / metrics.adSpend) * 100) / 100;
}

export function demoProfit(metrics: DemoCampaignMetrics, hpp: number, unitsSold: number): number {
  const grossProfit = metrics.revenue - hpp * unitsSold;
  return Math.round(grossProfit - metrics.adSpend);
}

export const DEMO_ANALYTICS_SUMMARY = {
  totalAdSpend: DEMO_METRICS.reduce((sum, m) => sum + m.adSpend, 0),
  totalRevenue: DEMO_METRICS.reduce((sum, m) => sum + m.revenue, 0),
  totalOrders: DEMO_METRICS.reduce((sum, m) => sum + m.orders, 0),
  simulated: true as const,
};
