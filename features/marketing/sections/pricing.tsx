import Link from "next/link";
import { Check, Clock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/features/marketing/components/reveal";
import { PLAN_TIERS } from "@/lib/billing/plans";

// LINOE — PR #21 pricing/navbar connection fix. Reads plan name, price and
// headline features directly from lib/billing/plans.ts (PLAN_TIERS), the
// same single source of truth the authenticated /billing page's
// PricingCards consumes — this section no longer hardcodes its own,
// drifted plan list. Values are never duplicated here; only read.
function formatPriceIDR(priceIDR: number): string {
  return priceIDR.toLocaleString("id-ID");
}

export function Pricing() {
  return (
    <section id="harga" className="scroll-mt-16 border-t border-border py-14 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 text-center sm:px-6">
        <Reveal>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Harga
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground sm:text-base">
            Pilih paket yang sesuai dengan skala bisnis Anda. Semua paket mencakup AI Marketing
            Team dalam satu platform.
          </p>
        </Reveal>

        <Reveal className="mt-8 grid grid-cols-1 gap-4 sm:mt-10 sm:grid-cols-2 lg:grid-cols-3">
          {PLAN_TIERS.map((tier) => {
            const isComingSoon = tier.availability === "COMING_SOON";
            return (
              <div
                key={tier.id}
                className="flex min-w-0 flex-col items-center gap-3 rounded-[var(--radius-lg)] border border-border bg-surface p-5 text-left shadow-[var(--shadow-sm)] sm:p-6"
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="size-4 shrink-0 text-brand" aria-hidden />
                    <p className="break-words text-sm font-semibold text-foreground">{tier.name}</p>
                  </div>
                  {tier.badge ? (
                    <span className="shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">
                      {tier.badge}
                    </span>
                  ) : null}
                  {isComingSoon ? (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      Segera Hadir
                    </span>
                  ) : null}
                </div>

                <div className="w-full">
                  <p className="break-words text-2xl font-semibold tracking-tight text-foreground">
                    {tier.priceIDR === 0 ? "Gratis" : `Rp${formatPriceIDR(tier.priceIDR)}`}
                    {tier.isPriceTarget ? <span className="text-sm font-normal text-muted-foreground"> (target)</span> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">{tier.pricePeriodLabel}</p>
                </div>

                <p className="break-words text-xs text-muted-foreground">{tier.targetDescription}</p>

                {tier.coreFeatures.length > 0 ? (
                  <ul className="flex w-full flex-col gap-1.5">
                    {tier.coreFeatures.map((feature) => (
                      <li key={feature} className="flex items-start gap-1.5 text-xs text-foreground/80">
                        <Check className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
                        <span className="break-words">{feature}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {tier.comingSoonFeatures.length > 0 ? (
                  <div className="w-full">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Segera hadir (belum tersedia)
                    </p>
                    <ul className="mt-1.5 flex w-full flex-col gap-1.5">
                      {tier.comingSoonFeatures.map((feature) => (
                        <li key={feature} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                          <span className="break-words">{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {isComingSoon ? (
                  <Button size="sm" variant="outline" disabled className="mt-auto w-full">
                    Segera Hadir
                  </Button>
                ) : (
                  <Button asChild size="sm" className="mt-auto w-full bg-gradient-to-r from-brand to-brand-2 hover:opacity-95">
                    <Link href="/register">Pilih Paket Ini</Link>
                  </Button>
                )}
              </div>
            );
          })}
        </Reveal>

        <p className="mx-auto mt-6 max-w-xl text-xs text-muted-foreground">
          Setiap workspace baru memulai dengan trial gratis 14 hari. Pembayaran online belum aktif dan masih dalam tahap
          uji coba; paket berbayar belum ditagihkan. Lihat{" "}
          <Link href="/refund" className="font-medium text-brand hover:underline">
            Kebijakan Refund
          </Link>
          .
        </p>

        <p className="mt-3 text-xs text-muted-foreground">
          Sudah punya akun?{" "}
          <Link href="/login" className="font-medium text-brand hover:underline">
            Masuk
          </Link>
        </p>
      </div>
    </section>
  );
}
