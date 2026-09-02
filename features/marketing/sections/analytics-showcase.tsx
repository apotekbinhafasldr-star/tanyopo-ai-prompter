import { Target, MousePointerClick, Percent, TrendingUp } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";

function Bars({ values }: { values: number[] }) {
  const max = Math.max(...values);
  return (
    <div className="flex h-16 items-end gap-1.5">
      {values.map((v, i) => (
        <div
          key={i}
          className="w-full rounded-t-[4px] bg-gradient-to-t from-brand to-brand-2"
          style={{ height: `${(v / max) * 100}%`, opacity: 0.5 + (i / values.length) * 0.5 }}
        />
      ))}
    </div>
  );
}

const CARDS = [
  { icon: Target, label: "ROAS", value: "4.2x", accent: "text-brand" },
  { icon: MousePointerClick, label: "Konversi", value: "312", accent: "text-brand" },
  { icon: Percent, label: "CTR", value: "3.8%", accent: "text-brand" },
  { icon: TrendingUp, label: "Growth Trend", value: "+22%", accent: "text-success" },
];

export function AnalyticsShowcase() {
  return (
    <section id="analitik" className="scroll-mt-16 border-t border-border bg-surface-muted/40 py-14 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal className="mb-8 flex flex-col items-center gap-2 text-center sm:mb-12">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Analitik yang Bisa Dipercaya
          </h2>
          <p className="max-w-xl text-sm text-muted-foreground sm:text-base">
            Metrik dari data sungguhan yang tersambung ke akun Anda — bila belum ada data nyata,
            ditandai jelas sebagai contoh.
          </p>
          <span className="mt-1 rounded-full border border-border bg-surface px-3 py-1 text-[11px] font-medium text-muted-foreground">
            Contoh tampilan — data ilustratif
          </span>
        </Reveal>

        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {CARDS.map((c) => (
            <div
              key={c.label}
              className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-border bg-surface p-4 shadow-[var(--shadow-sm)] sm:p-5"
            >
              <div className="flex items-center gap-2">
                <c.icon className={`size-4 ${c.accent}`} aria-hidden />
                <span className="text-xs font-medium text-muted-foreground">{c.label}</span>
              </div>
              <span className="text-2xl font-semibold tracking-tight text-foreground">{c.value}</span>
              <Bars values={[3, 5, 4, 6, 7, 6, 8, 9]} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
