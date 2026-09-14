import { Infinity as InfinityIcon, CheckCircle2 } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";
import { TanyopoIntelligenceDiagram } from "@/features/marketing/components/tanyopo-intelligence-diagram";

const INDICATORS = ["Lebih Efisien", "Hasil Terukur", "Mudah Digunakan", "Aman & Terpercaya"];

/**
 * "Bagaimana LINOE Bekerja" / Tanyopo Intelligence — Animated V4.
 * Rebuilt to strictly match the founder-supplied reference
 * (LINOE_TANYOPO_INTELLIGENCE_VISUAL_REFERENCE_FINAL.png, repo root):
 * a colorful ambient blue/cyan/violet mesh background (not flat white,
 * not a dark solid block) with soft drifting blobs, behind the dark
 * "island" card network built in
 * features/marketing/components/tanyopo-intelligence-diagram.tsx.
 *
 * Sits directly below the Hero (features/marketing/sections/hero.tsx,
 * untouched by this batch) and above AiTeam in app/(marketing)/page.tsx.
 * The Hero's own <section id="produk"> markup is not touched at all.
 *
 * "AI Bekerja 24/7 untuk Pertumbuhan Anda" below is the founder's exact
 * requested copy, now delivered via an actual finished reference design
 * (the explicit source of truth for this round) — read here as "always
 * available to help," a standard SaaS framing, not a claim that LINOE
 * executes unsupervised background actions around the clock (it doesn't;
 * automation still requires Owner approval — see
 * services/automation-settings.ts / toggleEmergencyStopAction).
 */
export function TanyopoIntelligence() {
  return (
    <section className="relative overflow-hidden bg-background py-16 sm:py-24">
      {/* Hero -> section transition: continues the Hero's own ink tone briefly */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-32 sm:h-44"
        style={{ background: "linear-gradient(180deg, var(--ink) 0%, transparent 100%)" }}
      />

      {/* Colorful ambient mesh background — light at the very top, opening into
          a genuinely colored blue/violet wash further down, per the reference
          (never flat white, never as dark/solid as the Hero). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 38%, rgba(58,99,251,0.32) 0%, transparent 70%), " +
            "radial-gradient(55% 55% at 12% 78%, rgba(139,92,246,0.22) 0%, transparent 70%), " +
            "radial-gradient(55% 55% at 90% 80%, rgba(34,211,238,0.2) 0%, transparent 70%), " +
            "linear-gradient(180deg, #eef2ff 0%, #dfe6fc 25%, #ccd8f8 60%, #c3d0f5 100%)",
        }}
      />
      <div
        aria-hidden
        className="tanyopo-ambient-drift pointer-events-none absolute -left-24 top-1/3 size-[26rem] rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(139,92,246,0.28) 0%, transparent 70%)" }}
      />
      <div
        aria-hidden
        className="tanyopo-ambient-drift-reverse pointer-events-none absolute -right-24 bottom-0 size-[28rem] rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(34,211,238,0.22) 0%, transparent 70%)" }}
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
          className="relative mx-auto mt-12 max-w-5xl overflow-hidden rounded-full border border-white/10 shadow-[0_16px_40px_-16px_rgba(15,23,60,0.55)] sm:mt-16"
          delayMs={150}
        >
          <div
            className="flex flex-col items-center gap-4 px-6 py-5 text-center sm:flex-row sm:justify-between sm:gap-6 sm:px-8 sm:text-left"
            style={{ background: "linear-gradient(120deg, #2e3a86 0%, #4c3fa8 100%)" }}
          >
            <div className="flex items-center gap-3">
              <span
                className="flex size-10 shrink-0 items-center justify-center rounded-full text-white sm:size-11"
                style={{ background: "linear-gradient(135deg, #22d3ee 0%, #8b5cf6 100%)" }}
              >
                <InfinityIcon className="size-5" aria-hidden />
              </span>
              <p className="text-sm font-bold text-white sm:text-base">
                AI Bekerja 24/7 untuk Pertumbuhan Anda
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 sm:justify-end">
              {INDICATORS.map((label) => (
                <span key={label} className="inline-flex items-center gap-1.5 text-xs font-medium text-white/85 sm:text-sm">
                  <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
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
