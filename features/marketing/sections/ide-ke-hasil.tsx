import Link from "next/link";
import { ArrowRight, Plug2, Brain, Rocket, TrendingUp, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "@/features/marketing/components/reveal";
import { cn } from "@/lib/utils/cn";

/**
 * "Dari Ide ke Hasil" — new dark workflow section, PR #21 round 9
 * ("final visual finishing"). This section did not exist before this
 * round; it is inserted directly below the Tanyopo Intelligence
 * section's "Hasil Nyata untuk Pertumbuhan Bisnis Anda" outcome strip
 * and directly above the Device Showcase section's "Semua yang Anda
 * Butuhkan dalam Satu Platform." — see the import/JSX order in
 * app/(marketing)/page.tsx and the export order in
 * features/marketing/sections/index.tsx. No other section file was
 * touched to make room for this one.
 *
 * Deliberately NOT given `id="cara-kerja"` even though its small label
 * reads "CARA KERJA" — that id already belongs to the separate,
 * existing, untouched 8-step `HowItWorks` section
 * (features/marketing/sections/how-it-works.tsx). Reusing it here
 * would be a duplicate-DOM-id bug, and that section is explicitly out
 * of scope this round. This section has no anchor id of its own.
 *
 * Layout: two-column on desktop (`md:grid-cols-2`) — left side is the
 * label/heading/supporting-copy/CTA stack, right side is the 4-step
 * workflow.
 *
 * Round 9 ("final finishing") removed the tall bordered card each step
 * used to sit inside — founder feedback called that "too rigid". Each
 * step is now a bare node (glowing circular icon + numbered badge +
 * title + description, no box/border around it), connected by a short
 * glowing gradient line with an arrowhead (`StepConnector`) instead of
 * a plain icon, so the connection itself reads as energy flowing
 * between nodes — matching the Tanyopo Intelligence energy network's
 * visual language above this section. At `sm:` and up the four nodes
 * sit in one horizontal row ("DESKTOP/TABLET: four nodes arranged
 * horizontally" per the brief). Below `sm`, where a single row of four
 * full nodes would be cramped, it switches to an explicit 2x2 grid
 * (1-2 top row, 3-4 bottom row) with its own connectors — a right
 * arrow between 1->2 and 3->4, a down arrow bridging the two rows —
 * plus the numbered badges on every icon, so the 1 -> 2 -> 3 -> 4
 * sequence stays obvious however it wraps. Background is a deep
 * navy/near-black (`bg-ink`, the same token Hero already uses for its
 * own dark section) with a restrained cyan/blue/violet ambient glow,
 * consistent with the house style used throughout this visual pass.
 */
type Step = { icon: LucideIcon; title: string; description: string };

const STEPS: Step[] = [
  {
    icon: Plug2,
    title: "Hubungkan Produk Anda",
    description: "Masukkan data produk, harga, dan target pasar Anda.",
  },
  {
    icon: Brain,
    title: "AI Analisis dan Susun Strategi",
    description: "Tanyopo Intelligence menyusun strategi yang paling relevan.",
  },
  {
    icon: Rocket,
    title: "Buat & Jalankan Campaign",
    description: "Konten dan campaign dieksekusi otomatis ke channel yang tepat.",
  },
  {
    icon: TrendingUp,
    title: "Pantau Hasil dan Optimasi",
    description: "Hasil dipantau real-time dan terus dioptimasi oleh AI.",
  },
];

/** Glowing circular step icon + step number badge. Pure CSS, consistent cyan/blue/violet gradient used everywhere else in this visual pass. */
function StepIcon({ icon: Icon, index }: { icon: LucideIcon; index: number }) {
  return (
    <div className="relative flex shrink-0 items-center justify-center">
      <span
        aria-hidden
        className="pointer-events-none absolute -inset-3 rounded-full opacity-70 blur-lg"
        style={{ background: "radial-gradient(circle, rgba(34,211,238,0.5) 0%, rgba(139,92,246,0.35) 60%, transparent 78%)" }}
      />
      <span
        className="relative flex size-14 items-center justify-center rounded-full text-white ring-1 ring-white/20 sm:size-16"
        style={{
          background: "linear-gradient(135deg, #22d3ee 0%, #3b82f6 55%, #8b5cf6 100%)",
          boxShadow: "0 0 24px -2px rgba(59,130,246,0.9)",
        }}
      >
        <Icon className="size-6 sm:size-7" aria-hidden />
      </span>
      <span className="absolute -right-1 -top-1 flex size-6 items-center justify-center rounded-full bg-ink text-[11px] font-bold text-cyan-200 ring-1 ring-cyan-200/60">
        {index + 1}
      </span>
    </div>
  );
}

/** A bare workflow node — glowing icon + numbered badge + title + description. No border/box around it (round 9: "do not place each step inside a large box"). */
function StepNode({ step, index }: { step: Step; index: number }) {
  return (
    <div className="flex w-full flex-col items-center gap-3 px-2 text-center">
      <StepIcon icon={step.icon} index={index} />
      <span className="text-sm font-semibold text-white">{step.title}</span>
      <span className="text-xs leading-relaxed text-white/60">{step.description}</span>
    </div>
  );
}

/**
 * Connecting arrow/energy-flow between two steps. A short gradient
 * "ribbon" line (same cyan -> blue -> violet language as the Tanyopo
 * Intelligence energy network above this section) with a glowing
 * arrowhead, rather than a plain icon — so the connection itself reads
 * as energy flowing from node to node, not just a UI affordance.
 * `direction` picks the line's orientation: `right` (desktop/tablet
 * horizontal row) or `down` (mobile 2x2's row-to-row wrap).
 */
function StepConnector({ direction }: { direction: "right" | "down" }) {
  const isDown = direction === "down";
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center gap-1 opacity-80",
        isDown ? "h-6 w-full flex-col" : "h-full w-8 flex-row sm:w-12",
      )}
    >
      <span
        aria-hidden
        className={cn("rounded-full", isDown ? "h-3 w-[2px]" : "h-[2px] w-full")}
        style={{
          background: "linear-gradient(90deg, #22d3ee, #8b5cf6)",
          boxShadow: "0 0 8px 1px rgba(99,102,241,0.6)",
        }}
      />
      <ArrowRight
        className={cn("size-3.5 shrink-0 text-cyan-300/80", isDown && "rotate-90")}
        style={{ filter: "drop-shadow(0 0 4px rgba(34,211,238,0.8))" }}
        aria-hidden
      />
    </div>
  );
}

export function IdeToResult() {
  return (
    <section className="relative overflow-hidden bg-ink py-16 sm:py-24">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(42% 50% at 10% 15%, rgba(34,211,238,0.16) 0%, transparent 72%), " +
            "radial-gradient(46% 55% at 90% 85%, rgba(139,92,246,0.18) 0%, transparent 72%)",
        }}
      />

      <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 sm:px-6 md:grid-cols-2 md:gap-14">
        <Reveal className="flex flex-col items-start gap-4 text-left">
          <span className="text-xs font-semibold uppercase tracking-wide text-cyan-300">CARA KERJA</span>
          <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Dari Ide ke Hasil.
            <br />
            Semua Dipandu AI.
          </h2>
          <p className="max-w-md text-sm leading-relaxed text-white/70 sm:text-base">
            Tanyopo Intelligence bekerja langkah demi langkah untuk membantu bisnis Anda tumbuh lebih
            cepat dan konsisten.
          </p>
          <Button
            asChild
            size="lg"
            className="mt-2 bg-gradient-to-r from-brand to-brand-2 shadow-[var(--shadow-glow)] hover:opacity-95"
          >
            <Link href="/api/demo/start">
              Lihat Demo
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
        </Reveal>

        <Reveal className="w-full" delayMs={100}>
          {/* Below sm: compact 2x2 grid (1-2 top row, 3-4 bottom row) with its own connectors. */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-y-5 sm:hidden">
            <StepNode step={STEPS[0]} index={0} />
            <StepConnector direction="right" />
            <StepNode step={STEPS[1]} index={1} />
            <div className="col-span-3 flex justify-center">
              <StepConnector direction="down" />
            </div>
            <StepNode step={STEPS[2]} index={2} />
            <StepConnector direction="right" />
            <StepNode step={STEPS[3]} index={3} />
          </div>

          {/* sm and up: one horizontal row, left -> right. */}
          <div className="hidden items-start sm:flex">
            {STEPS.map((step, index) => (
              <div key={step.title} className="flex flex-1 items-start">
                <StepNode step={step} index={index} />
                {index < STEPS.length - 1 && <StepConnector direction="right" />}
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
