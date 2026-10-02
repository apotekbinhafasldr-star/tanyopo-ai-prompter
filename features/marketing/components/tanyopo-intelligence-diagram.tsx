import { Package, Brain, Target, FileText, Rocket, Sliders, BarChart3, type LucideIcon } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";
import { cn } from "@/lib/utils/cn";

/**
 * "LINOE final landing visual" — founder-approved simplification of the
 * Tanyopo Intelligence diagram. Supersedes V3 (numbered flowchart) and the
 * unmerged V4 hub-and-spoke network (PR #20, never landed on main) with a
 * deliberately simpler shape the founder asked for explicitly after
 * seeing V4: "no complicated network, no dozens of crossing lines, no
 * floating disconnected icons" — simple, symmetrical, premium, easy to
 * understand.
 *
 * Structure: one dominant central AI core, with exactly two energy
 * ribbons (left and right — reusing the same marketing-line-flow /
 * marketing-glow-pulse keyframes every prior version used, defined in
 * app/globals.css and untouched here) connecting the core to two
 * three-card capability groups. No per-card line, no crossing paths, no
 * SVG network — a plain flex/grid layout, so there is nothing to break on
 * narrow screens: mobile collapses to core -> one ribbon -> a simple
 * 2-column card grid, never a shrunk copy of the desktop diagram.
 *
 * Capability set/grouping matches the founder's explicit left/right
 * brief: Produk Anda, Strategi Marketing, Analitik on the left;
 * Konten & Copywriting, Campaign, Optimasi on the right. Card copy is
 * condensed to one short line each (not a bullet list) per "No huge
 * cards, no unnecessary technical details" — every capability named is
 * something LINOE already does today, nothing invented.
 *
 * tanyopo-intelligence.tsx (the section wrapper — heading, supporting
 * copy, and the "Hasil Nyata..." value strip) is untouched by this file;
 * its existing heading "Tanyopo Intelligence di Balik Setiap Hasil Besar"
 * already matches the founder's brief verbatim.
 */
type Capability = { icon: LucideIcon; title: string; description: string };

const LEFT_CAPABILITIES: Capability[] = [
  { icon: Package, title: "Produk Anda", description: "Data produk, harga, stok, dan keunggulan — siap dianalisis AI." },
  { icon: Target, title: "Strategi Marketing", description: "Target, channel, dan peluang pasar disusun otomatis." },
  { icon: BarChart3, title: "Analitik", description: "Hasil real-time dengan insight yang mudah dipahami." },
];

const RIGHT_CAPABILITIES: Capability[] = [
  { icon: FileText, title: "Konten & Copywriting", description: "Ide, caption, materi iklan, dan visual siap pakai." },
  { icon: Rocket, title: "Campaign", description: "Eksekusi campaign ke channel yang relevan." },
  { icon: Sliders, title: "Optimasi", description: "Rekomendasi AI untuk hasil yang lebih baik." },
];

/** Small, translucent capability card — no heavy border, large rounded corners, short copy only. */
function CapabilityCard({ icon: Icon, title, description }: Capability) {
  return (
    <div className="flex w-full max-w-xs items-start gap-3 rounded-[1.5rem] bg-white/70 p-4 text-left shadow-[0_8px_24px_-12px_rgba(59,130,246,0.35)] ring-1 ring-white/80 backdrop-blur-sm">
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-full text-white shadow-[0_0_16px_-2px_rgba(59,130,246,0.7)]"
        style={{ background: "linear-gradient(135deg, #22d3ee 0%, #3b82f6 55%, #8b5cf6 100%)" }}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="text-xs leading-relaxed text-muted-foreground">{description}</span>
      </div>
    </div>
  );
}

/**
 * The one dominant element on the page (founder: "BESAR, dominan,
 * bercahaya" — but elegant, controlled glow, not excessive neon). Sizes
 * and glow intensity are deliberately a notch below the earlier V3/V4
 * attempts so it reads as premium rather than sci-fi.
 */
function AiCore() {
  return (
    <div className="relative flex shrink-0 flex-col items-center gap-3">
      <div className="relative flex items-center justify-center">
        <div
          aria-hidden
          className="marketing-glow-pulse pointer-events-none absolute inset-0 -z-10 rounded-full blur-2xl"
          style={{ background: "radial-gradient(circle, rgba(34,211,238,0.5) 0%, rgba(139,92,246,0.45) 55%, transparent 75%)" }}
        />
        <div
          className="flex size-28 items-center justify-center rounded-full text-white shadow-[0_0_60px_-10px_rgba(99,102,241,0.6)] ring-4 ring-white/40 sm:size-32 lg:size-36"
          style={{ background: "radial-gradient(circle at 35% 30%, #67e8f9 0%, #3b82f6 45%, #8b5cf6 90%)" }}
        >
          <Brain className="size-10 sm:size-12 lg:size-14" aria-hidden />
        </div>
      </div>
      <div className="flex flex-col items-center gap-1 px-2">
        <p className="text-lg font-bold text-foreground sm:text-xl">Tanyopo Intelligence</p>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand">AI Business Brain</p>
      </div>
    </div>
  );
}

/** One simple, controlled-glow energy ribbon — reuses the existing marketing-line-flow keyframe (app/globals.css, unchanged). Desktop: horizontal, between the core and a card group. Mobile: a short vertical ribbon from the core down into the card grid. */
function EnergyRibbon({ orientation }: { orientation: "horizontal" | "vertical" }) {
  return (
    <div
      aria-hidden
      className={cn(
        "marketing-line-flow shrink-0 rounded-full shadow-[0_0_18px_-4px_rgba(59,130,246,0.6)]",
        orientation === "horizontal" ? "hidden h-2.5 min-w-8 flex-1 lg:block" : "h-8 w-2.5 sm:h-10",
      )}
      style={{ background: "linear-gradient(90deg, #22d3ee 0%, #3b82f6 50%, #8b5cf6 100%)" }}
    />
  );
}

export function TanyopoIntelligenceDiagram() {
  return (
    <div className="relative mx-auto max-w-5xl">
      <Reveal className="flex flex-col items-center gap-8 sm:gap-10">
        {/* Desktop/tablet — symmetric: [3 cards] — ribbon — core — ribbon — [3 cards]. Exactly two ribbons, no per-card lines, nothing crosses. */}
        <div className="hidden w-full items-center justify-center gap-4 lg:flex xl:gap-8">
          <div className="flex flex-col items-end gap-4">
            {LEFT_CAPABILITIES.map((item) => (
              <CapabilityCard key={item.title} {...item} />
            ))}
          </div>
          <EnergyRibbon orientation="horizontal" />
          <AiCore />
          <EnergyRibbon orientation="horizontal" />
          <div className="flex flex-col items-start gap-4">
            {RIGHT_CAPABILITIES.map((item) => (
              <CapabilityCard key={item.title} {...item} />
            ))}
          </div>
        </div>

        {/* Mobile/small tablet — core on top, one short ribbon, then a clean 2-column grid of all six cards. No desktop diagram squeezed down; a completely separate, simpler layout. */}
        <div className="flex w-full flex-col items-center gap-0 lg:hidden">
          <AiCore />
          <EnergyRibbon orientation="vertical" />
          <div className="mt-2 grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
            {[...LEFT_CAPABILITIES, ...RIGHT_CAPABILITIES].map((item) => (
              <CapabilityCard key={item.title} {...item} />
            ))}
          </div>
        </div>
      </Reveal>
    </div>
  );
}
