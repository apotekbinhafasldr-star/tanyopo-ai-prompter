import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import { formatCurrency } from "@/lib/utils/format";
import { PLAN_TIERS, type PlanTierConfig } from "@/lib/billing/plans";
import type { SubscriptionPlan } from "@/types/database";

/**
 * Batch B8 — pricing cards. No "Bayar"/"Checkout"/"Langganan Sekarang"
 * button anywhere: a payment processor isn't configured yet (see
 * services/billing.ts / lib/billing/get-payment-provider.ts), so every
 * paid card's action area is informational only ("Pembayaran online
 * segera tersedia"). The one real, working action on this page — picking
 * a reference-only plan via PlanForm — lives in the existing collapsed
 * disclosure on app/(app)/billing/page.tsx (Batch B7), reused as-is.
 */
export function PricingCards({ currentPlan }: { currentPlan: SubscriptionPlan }) {
  const activeTiers = PLAN_TIERS.filter((t) => t.availability === "ACTIVE");
  const comingSoonTiers = PLAN_TIERS.filter((t) => t.availability === "COMING_SOON");

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {activeTiers.map((tier) => (
          <PricingCard key={tier.id} tier={tier} isCurrent={tier.id === currentPlan} />
        ))}
      </div>

      {comingSoonTiers.length > 0 ? (
        <div className="flex flex-col gap-2">
          {comingSoonTiers.map((tier) => (
            <Card key={tier.id} className="border-dashed">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{tier.name}</p>
                    <Badge variant="outline">Segera Hadir</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{tier.targetDescription}</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Target harga {formatCurrency(tier.priceIDR)}
                  {tier.pricePeriodLabel} — belum dapat dibeli.
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PricingCard({ tier, isCurrent }: { tier: PlanTierConfig; isCurrent: boolean }) {
  return (
    <Card className={cn("flex flex-col", tier.badge ? "border-brand" : undefined)}>
      <CardHeader className="flex flex-col gap-2 space-y-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">{tier.name}</p>
          {tier.badge ? <Badge variant="brand">{tier.badge}</Badge> : null}
        </div>
        <div>
          <span className="text-2xl font-semibold text-foreground">
            {tier.priceIDR === 0 ? "Gratis" : formatCurrency(tier.priceIDR)}
          </span>
          <span className="text-xs text-muted-foreground">{tier.priceIDR === 0 ? "" : tier.pricePeriodLabel}</span>
        </div>
        <p className="text-xs text-muted-foreground">{tier.targetDescription}</p>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 pt-4">
        <ul className="flex flex-1 flex-col gap-1.5">
          {tier.coreFeatures.map((feature) => (
            <li key={feature} className="flex items-start gap-2 text-xs text-foreground">
              <Check className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
        <ul className="flex flex-col gap-0.5 border-t border-border pt-3 text-xs text-muted-foreground">
          <li>{tier.limits.aiUsageAllowance.toLocaleString("id-ID")} penggunaan AI</li>
          <li>Maks. {tier.limits.maxActiveProducts ?? "—"} produk aktif</li>
          <li>Maks. {tier.limits.maxActiveCampaigns ?? "—"} campaign aktif</li>
          <li>{tier.limits.maxUsers ?? "—"} user</li>
        </ul>
        <div className="mt-auto pt-2">
          {isCurrent ? (
            <Badge variant="success">Paket Anda Saat Ini</Badge>
          ) : tier.priceIDR === 0 ? (
            <p className="text-xs text-muted-foreground">Aktif otomatis untuk tenant baru.</p>
          ) : (
            <p className="text-xs text-muted-foreground">Pembayaran online segera tersedia.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
