import { Package, Brain, Target, Sparkles, Rocket, BarChart3, Sliders, TrendingUp } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";

const STEPS = [
  { icon: Package, title: "Produk", desc: "Unggah produk, jasa, atau aplikasi Anda." },
  { icon: Brain, title: "AI Memahami", desc: "Blueprint marketing disusun dari data produk." },
  { icon: Target, title: "Strategi", desc: "Positioning, USP, dan audiens target." },
  { icon: Sparkles, title: "Buat Konten", desc: "Copy, hook, dan creative untuk tiap channel." },
  { icon: Rocket, title: "Luncurkan", desc: "Tayang setelah lolos budget & persetujuan Anda." },
  { icon: BarChart3, title: "Ukur", desc: "Performa nyata dipantau secara berkelanjutan." },
  { icon: Sliders, title: "Optimasi", desc: "AI menyarankan perbaikan berbasis data." },
  { icon: TrendingUp, title: "Tumbuh", desc: "Siklus berulang — makin lama makin tajam." },
];

export function HowItWorks() {
  return (
    <section id="cara-kerja" className="scroll-mt-16 border-t border-border py-14 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal className="mb-8 text-center sm:mb-12">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Cara Kerjanya
          </h2>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">
            Delapan langkah, satu alur — dari produk sampai pertumbuhan yang terukur.
          </p>
        </Reveal>

        {/* Mobile/tablet: horizontal snap-scroll, so the whole workflow is a swipe away
            instead of a long vertical stack. Desktop: full grid, all visible at once. */}
        <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 no-scrollbar sm:mx-0 sm:gap-4 sm:px-0 lg:grid lg:grid-cols-4 lg:overflow-visible">
          {STEPS.map((step, i) => (
            <div
              key={step.title}
              className="flex w-40 shrink-0 snap-start flex-col gap-2.5 rounded-[var(--radius-lg)] border border-border bg-surface p-4 shadow-[var(--shadow-sm)] transition-shadow hover:shadow-[var(--shadow-md)] sm:w-44 lg:w-auto"
            >
              <div className="flex items-center justify-between">
                <div className="flex size-9 items-center justify-center rounded-[var(--radius-md)] bg-gradient-to-br from-brand-muted to-surface-muted">
                  <step.icon className="size-4 text-brand" aria-hidden />
                </div>
                <span className="text-[11px] font-semibold text-muted-foreground">
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <p className="text-sm font-semibold text-foreground">{step.title}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">{step.desc}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-center text-xs text-muted-foreground lg:hidden">
          Geser untuk melihat langkah selanjutnya →
        </p>
      </div>
    </section>
  );
}
