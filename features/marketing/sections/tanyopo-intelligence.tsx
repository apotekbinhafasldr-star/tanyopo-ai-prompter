import { CheckCircle2 } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";
import { TanyopoIntelligenceDiagram } from "@/features/marketing/components/tanyopo-intelligence-diagram";

const INDICATORS = ["Lebih Efisien", "Hasil Terukur", "Mudah Digunakan", "Aman & Terpercaya"];

/**
 * "Bagaimana LINOE Bekerja" / Tanyopo Intelligence.
 * Sits directly below the Hero (features/marketing/sections/hero.tsx,
 * untouched by this batch) and above AiTeam in app/(marketing)/page.tsx —
 * same position this block has occupied since it was first extracted out
 * of hero.tsx. The Hero's own <section id="produk"> markup is not
 * touched at all by this or any prior round of this section's work.
 *
 * Visual V2 (founder-directed): moved from a dark "Command Center" glass
 * panel to a light section bathed in a soft cyan/blue/violet ambient
 * glow, with the AI core diagram itself (features/marketing/components/
 * tanyopo-intelligence-diagram.tsx) sitting directly on that glow rather
 * than inside a dark card. Background never gets as dark as the Hero —
 * only a short top fade continues the Hero's own ink tone before opening
 * into the light, glowing backdrop.
 *
 * "Tanyopo Intelligence Siap Kapan Saja..." in the bottom bar is a
 * deliberate rewrite of the founder's requested "AI Bekerja 24/7..." —
 * LINOE's automation still requires Owner approval before executing
 * anything (see services/automation-settings.ts /
 * toggleEmergencyStopAction), so it does not run autonomous background
 * jobs around the clock. This keeps the same "always available to help"
 * spirit without the unsupported 24/7-autonomous claim, consistent with
 * the honesty rule this same section's own prior brief established.
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
            "radial-gradient(45% 40% at 10% 10%, color-mix(in srgb, #22d3ee 14%, transparent), transparent 70%), " +
            "radial-gradient(50% 45% at 92% 20%, color-mix(in srgb, #8b5cf6 14%, transparent), transparent 70%), " +
            "radial-gradient(55% 40% at 50% 92%, color-mix(in srgb, #3b82f6 10%, transparent), transparent 70%)",
        }}
      />

      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal className="mb-10 text-center sm:mb-14">
          <span className="text-xs font-semibold uppercase tracking-wide text-brand">
            Bagaimana LINOE Bekerja
          </span>
          <h2 className="mx-auto mt-2 max-w-2xl text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Tanyopo Intelligence di Balik Setiap Hasil Besar
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
            Dari produk Anda hingga pertumbuhan bisnis, semua terhubung oleh AI. Satu platform. Banyak
            kemungkinan. Hasil nyata.
          </p>
        </Reveal>

        <TanyopoIntelligenceDiagram />

        <Reveal
          className="mx-auto mt-10 max-w-4xl overflow-hidden rounded-[var(--radius-lg)] border border-brand/15 shadow-[var(--shadow-md)] sm:mt-14"
          delayMs={100}
        >
          <div
            className="flex flex-col items-center gap-4 px-5 py-6 text-center sm:px-8 sm:py-7"
            style={{
              background:
                "linear-gradient(120deg, color-mix(in srgb, #22d3ee 9%, var(--surface)), color-mix(in srgb, #8b5cf6 9%, var(--surface)))",
            }}
          >
            <p className="text-base font-bold text-foreground sm:text-lg">
              Tanyopo Intelligence Siap Kapan Saja untuk Pertumbuhan Bisnis Anda
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
              {INDICATORS.map((label) => (
                <span key={label} className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground sm:text-sm">
                  <CheckCircle2 className="size-3.5 shrink-0 text-success" aria-hidden />
                  {label}
                </span>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
