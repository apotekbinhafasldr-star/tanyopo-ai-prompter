import { Minus, Equal } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";

const TERMS = [
  { label: "Revenue Atribusi", op: null },
  { label: "COGS / HPP", op: "minus" },
  { label: "Ad Spend", op: "minus" },
  { label: "Biaya Marketing Atribusi", op: "minus" },
];

export function ProfitAware() {
  return (
    <section className="border-t border-border py-14 sm:py-20">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <Reveal className="mb-8 text-center sm:mb-12">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Marketing yang Sadar Untung
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground sm:text-base">
            Tanyopo menggabungkan performa marketing dengan data bisnis Anda — bukan cuma ROAS,
            tapi kontribusi nyata terhadap bisnis.
          </p>
        </Reveal>

        <Reveal className="overflow-hidden rounded-[var(--radius-xl)] border border-border bg-surface shadow-[var(--shadow-md)]">
          <div className="flex flex-col divide-y divide-border sm:flex-row sm:divide-x sm:divide-y-0">
            {TERMS.map((t) => (
              <div key={t.label} className="flex flex-1 items-center gap-3 p-4 sm:flex-col sm:gap-2 sm:p-5 sm:text-center">
                {t.op === "minus" ? (
                  <Minus className="size-4 shrink-0 text-muted-foreground sm:hidden" aria-hidden />
                ) : (
                  <span className="w-4 shrink-0 sm:hidden" aria-hidden />
                )}
                <span className="text-sm font-medium text-foreground">{t.label}</span>
              </div>
            ))}
            <div className="flex flex-1 items-center gap-3 bg-brand-muted p-4 sm:flex-col sm:gap-2 sm:p-5 sm:text-center">
              <Equal className="size-4 shrink-0 text-brand sm:hidden" aria-hidden />
              <span className="text-sm font-semibold text-brand">Estimasi Kontribusi Marketing</span>
            </div>
          </div>
        </Reveal>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Ini adalah estimasi kontribusi marketing terhadap bisnis — bukan laba bersih akuntansi,
          karena belum memperhitungkan biaya operasional lain.
        </p>
      </div>
    </section>
  );
}
