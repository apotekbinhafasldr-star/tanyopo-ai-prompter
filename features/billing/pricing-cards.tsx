import { ChevronRight, Send, Store, TrendingUp, Crown, Building2, Users, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import { formatCurrency } from "@/lib/utils/format";
import { PLAN_TIERS, type PlanTierConfig, type PlanTierId } from "@/lib/billing/plans";
import { PlanSelectConfirm } from "@/features/billing/plan-select-confirm";
import type { SubscriptionPlan } from "@/types/database";

/**
 * Batch B8 visual hotfix — founder-directed layout: one full-width card
 * per plan, stacked in a single vertical column (Free Trial -> Starter ->
 * Growth -> Pro -> Business -> Agency), never a grid/carousel. Visual only
 * — reads PLAN_TIERS (lib/billing/plans.ts) exactly as B8 built it, no
 * price/limit/entitlement value lives in this file. No "Bayar"/
 * "Checkout"/"Upgrade Sekarang" button anywhere: a payment processor
 * isn't configured (see services/billing.ts).
 *
 * Batch B8 final hotfix — each non-current, purchasable card's "Lihat
 * Detail" now also surfaces "Pilih Paket Ini" (features/billing/
 * plan-select-confirm.tsx), which requires an explicit second
 * confirmation step before calling the existing changePlanAction/
 * changePlan() — the exact same reference-only mechanism B7's separate
 * "Pilih paket referensi (opsional)" disclosure already used (still
 * present on app/(app)/billing/page.tsx, untouched). Agency (COMING_SOON)
 * never gets this control — its disclosure stays informational only, per
 * the hard rule that it can't be selected until multi-client workspace
 * actually exists.
 */
interface TierVisual {
  icon: LucideIcon;
  card: string;
  icon_bg: string;
  heading: string;
  subtext: string;
  price: string;
  actionBar: string;
  badge?: string;
}

const TIER_VISUALS: Record<PlanTierId, TierVisual> = {
  FREE: {
    icon: Send,
    card: "border-sky-200 bg-sky-50",
    icon_bg: "bg-sky-500",
    heading: "text-foreground",
    subtext: "text-muted-foreground",
    price: "text-foreground",
    actionBar: "bg-sky-100 text-sky-700",
  },
  STARTER: {
    icon: Store,
    card: "border-blue-200 bg-blue-50",
    icon_bg: "bg-blue-500",
    heading: "text-foreground",
    subtext: "text-muted-foreground",
    price: "text-foreground",
    actionBar: "bg-blue-100 text-blue-700",
  },
  GROWTH: {
    icon: TrendingUp,
    card: "border-0 bg-gradient-to-br from-blue-600 to-fuchsia-600 shadow-lg shadow-fuchsia-500/25",
    icon_bg: "bg-white/20",
    heading: "text-white",
    subtext: "text-white/80",
    price: "text-white",
    actionBar: "bg-white/15 text-white",
    badge: "bg-amber-400 text-amber-950",
  },
  PRO: {
    icon: Crown,
    card: "border-orange-200 bg-orange-50",
    icon_bg: "bg-orange-500",
    heading: "text-foreground",
    subtext: "text-muted-foreground",
    price: "text-foreground",
    actionBar: "bg-orange-100 text-orange-700",
  },
  BUSINESS: {
    icon: Building2,
    card: "border-emerald-200 bg-emerald-50",
    icon_bg: "bg-emerald-500",
    heading: "text-foreground",
    subtext: "text-muted-foreground",
    price: "text-foreground",
    actionBar: "bg-emerald-100 text-emerald-700",
  },
  AGENCY: {
    icon: Users,
    card: "border-violet-200 bg-violet-50",
    icon_bg: "bg-violet-500",
    heading: "text-foreground",
    subtext: "text-muted-foreground",
    price: "text-foreground",
    actionBar: "bg-violet-100 text-violet-700",
    badge: "bg-violet-600 text-white",
  },
};

export function PricingCards({
  currentPlan,
  readOnly,
}: {
  currentPlan: SubscriptionPlan;
  readOnly: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {PLAN_TIERS.map((tier) => (
        <PricingCard key={tier.id} tier={tier} isCurrent={tier.id === currentPlan} readOnly={readOnly} />
      ))}
    </div>
  );
}

function PricingCard({ tier, isCurrent, readOnly }: { tier: PlanTierConfig; isCurrent: boolean; readOnly: boolean }) {
  const visual = TIER_VISUALS[tier.id];
  const Icon = visual.icon;
  const isComingSoon = tier.availability === "COMING_SOON";

  return (
    <Card className={cn("overflow-hidden p-0", visual.card)}>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", visual.icon_bg)}>
            <Icon className="size-5 text-white" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className={cn("text-base font-semibold", visual.heading)}>{tier.name}</p>
              {tier.badge ? <Badge className={cn("shrink-0", visual.badge)}>{tier.badge}</Badge> : null}
              {isComingSoon ? <Badge className={cn("shrink-0", visual.badge)}>Segera Hadir</Badge> : null}
            </div>
            <p className={cn("text-xs", visual.subtext)}>{tier.targetDescription}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <span className={cn("text-2xl font-bold", visual.price)}>{formatCurrency(tier.priceIDR)}</span>
          <span className={cn("text-xs", visual.subtext)}>
            {tier.pricePeriodLabel}
            {tier.isPriceTarget ? " (target)" : ""}
          </span>
        </div>

        <ul className={cn("flex flex-col gap-1 text-xs", visual.heading)}>
          <li>{tier.limits.aiUsageAllowance.toLocaleString("id-ID")} penggunaan AI</li>
          <li>Maks. {tier.limits.maxActiveProducts ?? "—"} produk aktif</li>
          <li>Maks. {tier.limits.maxActiveCampaigns ?? "—"} campaign aktif</li>
          <li>{tier.limits.maxUsers ?? "—"} user</li>
        </ul>

        {isCurrent ? (
          <div className={cn("rounded-full px-4 py-2.5 text-center text-sm font-medium", visual.actionBar)}>
            Paket Anda Saat Ini
          </div>
        ) : (
          <details className="group">
            <summary
              className={cn(
                "flex min-h-11 cursor-pointer list-none items-center justify-between rounded-full px-4 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden",
                visual.actionBar,
              )}
            >
              <span>{isComingSoon ? "Info Lebih Lanjut" : "Lihat Detail"}</span>
              <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
            </summary>
            <div className="pt-3">
              <ul className={cn("flex flex-col gap-1.5 text-xs", visual.heading)}>
                {tier.coreFeatures.map((feature) => (
                  <li key={feature}>• {feature}</li>
                ))}
              </ul>
              {isComingSoon ? (
                <p className={cn("mt-2 text-xs", visual.subtext)}>
                  Belum dapat dibeli — harga di atas adalah target, bukan tarif aktif.
                </p>
              ) : (
                <>
                  <p className={cn("mt-2 text-xs", visual.subtext)}>Pembayaran online segera tersedia.</p>
                  <div className="mt-3">
                    <PlanSelectConfirm
                      planId={tier.id}
                      planName={tier.name}
                      priceIDR={tier.priceIDR}
                      pricePeriodLabel={tier.pricePeriodLabel}
                      actionBarClassName={visual.actionBar}
                      mutedTextClassName={visual.subtext}
                      readOnly={readOnly}
                    />
                  </div>
                </>
              )}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
