import { CheckCircle2 } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";
import { TanyopoIntelligenceDiagram } from "@/features/marketing/components/tanyopo-intelligence-diagram";

const INDICATORS = ["Lebih Efisien", "Hasil Lebih Terukur", "Mudah Digunakan", "Tetap Dalam Kontrol Anda"];

/**
 * "Bagaimana LINOE Bekerja" / Tanyopo Intelligence — Command Center.
 * Sits directly below the Hero (features/marketing/sections/hero.tsx,
 * untouched by this batch) and above AiTeam in app/(marketing)/page.tsx —
 * same position this block occupied when it lived inside hero.tsx, just
 * extracted into its own section file (the codebase's normal convention;
 * every other marketing section is its own file). The Hero's own
 * <section id="produk"> markup was not touched at all.
 *
 * Background: stays on the page's normal light surface (never as dark as
 * the Hero, so it never reads as "merging into" it) but opens with a
 * short dark-to-light fade continuing the Hero's own ink tone, plus two
 * very soft brand-colored ambient blobs — replacing the previous flat
 * bg-background with a premium, non-empty-feeling backdrop without
 * darkening the whole section.
 */
export function TanyopoIntelligence() {
  return (
    <section className="relative overflow-hidden bg-background py-16 sm:py-24">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-40 sm:h-56"
        style={{ background: "linear-gradient(180deg, var(--ink) 0%, transparent 100%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(40% 35% at 8% 15%, color-mix(in srgb, #22d3ee 8%, transparent), transparent 70%), radial-gradient(45% 40% at 95% 25%, color-mix(in srgb, #8b5cf6 9%, transparent), transparent 70%)",
        }}
      />

      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal className="mb-10 text-center sm:mb-14">
          <span className="text-xs font-semibold uppercase tracking-wide text-brand">
            Bagaimana LINOE Bekerja
          </span>
          <h2 className="mx-auto mt-2 max-w-2xl text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Tanyopo Intelligence di Balik Setiap Pertumbuhan
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
            Dari produk Anda hingga pertumbuhan bisnis, Tanyopo Intelligence menghubungkan strategi,
            konten, campaign, analitik, dan optimasi dalam satu alur kerja AI.
          </p>
        </Reveal>

        <TanyopoIntelligenceDiagram />

        <Reveal
          className="mx-auto mt-10 flex max-w-3xl flex-col items-center gap-4 rounded-[var(--radius-lg)] border border-border bg-surface px-5 py-5 text-center shadow-[var(--shadow-sm)] sm:mt-14 sm:flex-row sm:justify-between sm:gap-6 sm:text-left"
          delayMs={100}
        >
          <p className="text-sm font-medium text-foreground sm:text-base">
            Tanyopo Intelligence bekerja untuk membantu pemasaran Anda
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 sm:justify-end">
            {INDICATORS.map((label) => (
              <span key={label} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground sm:text-sm">
                <CheckCircle2 className="size-3.5 shrink-0 text-success" aria-hidden />
                {label}
              </span>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
