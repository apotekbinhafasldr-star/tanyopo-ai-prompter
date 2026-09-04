import { Target, MousePointerClick, Percent, TrendingUp } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";

const CARDS = [
  { icon: Target, label: "ROAS", desc: "Return per rupiah budget iklan, per channel." },
  { icon: MousePointerClick, label: "Konversi", desc: "Lead, checkout, dan pembelian yang tercatat." },
  { icon: Percent, label: "CTR", desc: "Seberapa menarik setiap iklan dan konten." },
  { icon: TrendingUp, label: "Growth Trend", desc: "Arah pertumbuhan dari waktu ke waktu." },
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
            Metrik dari data sungguhan yang tersambung ke akun Anda — tidak pernah menampilkan
            angka performa yang belum benar-benar terjadi.
          </p>
        </Reveal>

        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {CARDS.map((c) => (
            <div
              key={c.label}
              className="flex flex-col gap-2.5 rounded-[var(--radius-lg)] border border-border bg-surface p-4 shadow-[var(--shadow-sm)] sm:p-5"
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-brand-muted text-brand">
                <c.icon className="size-4" aria-hidden />
              </span>
              <span className="text-sm font-semibold text-foreground">{c.label}</span>
              <p className="text-xs leading-relaxed text-muted-foreground">{c.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
