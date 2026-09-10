import type { SubscriptionPlan } from "@/types/database";

/**
 * Batch B8 — LINOE Pricing v1.0, the single source of truth for plan
 * pricing/limits/positioning. Presentation-layer only: nothing here
 * enforces a limit or activates a plan. Audited before writing this file
 * (grepped the whole app for `plan ===`/`.plan ==` — zero results) that no
 * feature is actually gated by plan tier today, so the feature-comparison
 * list below reflects that real state rather than inventing per-plan
 * differentiation that doesn't exist in code yet.
 *
 * The numeric `limits` below are the *product policy* baseline for
 * Pricing v1.0 — not a live, enforced cap. The only real, enforced AI-
 * usage caps today are TRIAL_DAILY_AI_JOB_LIMIT/TRIAL_MONTHLY_AI_JOB_LIMIT
 * in services/billing.ts, which this file deliberately leaves untouched
 * (changing an already-founder-tested trial's real enforcement mid-batch
 * is exactly the "sudden lockout" B8's brief forbids). Once a real
 * payment processor and a weighted AI-credit meter exist, that
 * enforcement can read these same numbers — this file is the readiness
 * layer for that, not the meter itself.
 */

export type PlanTierId = Exclude<SubscriptionPlan, "UMKMPRO_BUNDLE">;

export type PlanAvailability = "ACTIVE" | "COMING_SOON";

export interface PlanLimits {
  /** Product-policy AI usage allowance per period (per trial, or per month for paid plans) — not a live enforced cap. See file header. */
  aiUsageAllowance: number;
  /** null means "higher / not yet finalized" (Agency) — never invent an exact number the brief didn't give. */
  maxActiveProducts: number | null;
  maxActiveCampaigns: number | null;
  maxUsers: number | null;
}

export interface PlanTierConfig {
  id: PlanTierId;
  name: string;
  /** In IDR, whole rupiah. 0 for the free trial. */
  priceIDR: number;
  /** e.g. "/bulan" or "/14 hari" — how the price recurs. */
  pricePeriodLabel: string;
  /** Set only for Agency today — its price is a roadmap target, not a live rate. */
  isPriceTarget?: boolean;
  badge?: string;
  targetDescription: string;
  limits: PlanLimits;
  /** Short list for the pricing card body — full detail lives in the feature list below. */
  coreFeatures: string[];
  availability: PlanAvailability;
}

export const PLAN_TIERS: PlanTierConfig[] = [
  {
    id: "FREE",
    name: "Free Trial",
    priceIDR: 0,
    pricePeriodLabel: "14 hari",
    targetDescription: "Calon pengguna yang ingin mencoba LINOE.",
    limits: { aiUsageAllowance: 30, maxActiveProducts: 3, maxActiveCampaigns: 2, maxUsers: 1 },
    coreFeatures: [
      "Quick Promote & Marketing Blueprint",
      "Hook / Headline / Caption / CTA",
      "Content Studio & Campaign planning dasar",
      "SEO & Discovery, Growth, Analytics dasar",
    ],
    availability: "ACTIVE",
  },
  {
    id: "STARTER",
    name: "Starter",
    priceIDR: 99_000,
    pricePeriodLabel: "/bulan",
    targetDescription: "UMKM kecil / seller / bisnis yang baru mulai promosi rutin.",
    limits: { aiUsageAllowance: 150, maxActiveProducts: 10, maxActiveCampaigns: 5, maxUsers: 1 },
    coreFeatures: [
      "Quick Promote & AI Marketing Blueprint",
      "Content Studio & Campaign planning",
      "Smart Scheduling",
      "SEO & Discovery, Growth",
    ],
    availability: "ACTIVE",
  },
  {
    id: "GROWTH",
    name: "Growth",
    priceIDR: 199_000,
    pricePeriodLabel: "/bulan",
    badge: "PALING POPULER",
    targetDescription: "UMKM yang rutin menjalankan pemasaran dan ingin bertumbuh.",
    limits: { aiUsageAllowance: 500, maxActiveProducts: 50, maxActiveCampaigns: 20, maxUsers: 3 },
    coreFeatures: [
      "Semua fitur Starter",
      "Rekomendasi channel & budget lebih lanjut",
      "Growth recommendation",
      "Analytics lebih lengkap",
    ],
    availability: "ACTIVE",
  },
  {
    id: "PRO",
    name: "Pro",
    priceIDR: 399_000,
    pricePeriodLabel: "/bulan",
    targetDescription: "Bisnis yang mulai melakukan pemasaran secara lebih agresif.",
    limits: { aiUsageAllowance: 1_500, maxActiveProducts: 200, maxActiveCampaigns: 75, maxUsers: 5 },
    coreFeatures: [
      "Semua fitur Growth",
      "Advanced analytics & attribution (segera tersedia)",
      "A/B testing & retargeting (segera tersedia)",
      "Reporting/export (segera tersedia)",
    ],
    availability: "ACTIVE",
  },
  {
    id: "BUSINESS",
    name: "Business",
    priceIDR: 799_000,
    pricePeriodLabel: "/bulan",
    targetDescription: "Brand / bisnis dengan tim marketing dan volume lebih besar.",
    limits: { aiUsageAllowance: 4_000, maxActiveProducts: 500, maxActiveCampaigns: 200, maxUsers: 10 },
    coreFeatures: [
      "Semua fitur Pro",
      "Team workflow & multi-user approval (segera tersedia)",
      "Advanced reporting & automation (segera tersedia)",
      "Priority support (segera tersedia)",
    ],
    availability: "ACTIVE",
  },
  {
    id: "AGENCY",
    name: "Agency",
    priceIDR: 1_499_000,
    pricePeriodLabel: "/bulan",
    isPriceTarget: true,
    targetDescription: "Agency atau operator yang menangani banyak brand/client.",
    limits: { aiUsageAllowance: 10_000, maxActiveProducts: null, maxActiveCampaigns: null, maxUsers: 20 },
    coreFeatures: [
      "Multi-client workspace (segera hadir)",
      "Client separation & report per client (segera hadir)",
      "Team permission tingkat lanjut (segera hadir)",
    ],
    // Multi-client workspace/client separation don't exist in the codebase
    // yet (audited: no such table/route/component) — never sell this as
    // an active plan until that's real. See B8 brief's explicit rule.
    availability: "COMING_SOON",
  },
];

export type FeatureAvailability = "AVAILABLE" | "LIMITED" | "COMING_SOON";

export interface FeatureCategoryStatus {
  category: string;
  status: FeatureAvailability;
  /** Optional clarifying note — used to be honest about partial capability without a fake per-plan matrix (see file header: nothing is plan-gated in code today, so one status per category, not per plan, is the honest representation). */
  note?: string;
}

/**
 * One row per category, not per (category, plan) cell — audited that no
 * category here is actually restricted by plan tier in code today, so a
 * full plan x category grid would just repeat the same status six times
 * and risk implying a distinction that doesn't exist. Numeric limits
 * (AI usage/products/campaigns/users) are the real per-plan
 * differentiator today and live on each PlanTierConfig instead.
 */
export const FEATURE_CATEGORIES: FeatureCategoryStatus[] = [
  { category: "AI Marketing", status: "AVAILABLE" },
  { category: "Produk", status: "AVAILABLE", note: "Batas jumlah produk aktif berbeda per paket — lihat kartu paket." },
  { category: "Campaign", status: "AVAILABLE", note: "Batas jumlah campaign aktif berbeda per paket — lihat kartu paket." },
  { category: "Content", status: "AVAILABLE" },
  { category: "Scheduling", status: "AVAILABLE" },
  { category: "SEO & Discovery", status: "AVAILABLE" },
  { category: "Growth", status: "AVAILABLE" },
  { category: "Analytics", status: "AVAILABLE", note: "Atribusi, A/B testing, dan retargeting: segera tersedia." },
  { category: "Team", status: "COMING_SOON", note: "Undang anggota tim & approval multi-user sedang disiapkan." },
  {
    category: "Automation",
    status: "AVAILABLE",
    note: "Mode otomasi dasar (manual/AI-assist/autopilot) tersedia di Settings. Otomasi lanjutan: segera tersedia.",
  },
  {
    category: "Creative",
    status: "AVAILABLE",
    note: "Upload foto/video sendiri. AdPersona bersifat opsional dan terpisah dari paket LINOE.",
  },
  { category: "Support", status: "COMING_SOON", note: "Prioritas dukungan per paket sedang disiapkan." },
];

export function findPlanTier(plan: SubscriptionPlan): PlanTierConfig | undefined {
  return PLAN_TIERS.find((tier) => tier.id === plan);
}
