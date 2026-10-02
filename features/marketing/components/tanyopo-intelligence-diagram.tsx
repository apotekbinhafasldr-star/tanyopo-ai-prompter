import { Package, Brain, Target, FileText, Rocket, Sliders, BarChart3, type LucideIcon } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";
import { cn } from "@/lib/utils/cn";

/**
 * Tanyopo Intelligence diagram — revision 2 of the "final landing visual"
 * (PR #21). Founder rejected revision 1: core read as too small, the
 * energy flow was reduced to one short vertical bar, and the capability
 * cards looked like ordinary disconnected tiles. This revision keeps
 * revision 1's simple, symmetric 3-left/3-right shape (explicitly
 * requested, and still the thing that rules out the earlier V4
 * hub-and-spoke "complicated network") but fixes exactly those three
 * complaints:
 *   1. Core is substantially larger (desktop size-60 vs rev1's size-36)
 *      and uses a visible layered ring (deep-blue center, cyan inner
 *      glow, violet outer glow, thin bright outer ring) so it reads as
 *      the unmistakable centerpiece.
 *   2. The connection is now a real SVG overlay — one smooth curved,
 *      glow-filtered, cyan->blue->violet gradient path per card (six
 *      total, not two bars), with a gentle animated dash so the flow
 *      reads as alive without being distracting. Coordinates are
 *      percentages of the container (viewBox 0 0 100 100,
 *      preserveAspectRatio="none"), the same technique used for the
 *      (unmerged) V4 PR #20 diagram, so it's proven to stay responsive
 *      without any JS measurement — but with only 6 simple curves
 *      between two fixed groups, not a dense hub-and-spoke mesh.
 *   3. Cards keep a light translucent surface + glow icon, but now sit
 *      directly on top of their own incoming curve's endpoint, so each
 *      one visibly terminates a glowing line rather than floating free.
 * Mobile is a deliberately different, simpler composition (not a shrunk
 * desktop copy): a large core, one visible vertical "spine" SVG path
 * fanning out to all six cards stacked in a single column below it.
 *
 * tanyopo-intelligence.tsx (heading, supporting copy, the "Hasil
 * Nyata..." strip) is untouched — its heading already reads "Tanyopo
 * Intelligence di Balik Setiap Hasil Besar" verbatim, per founder brief.
 */
type Capability = { icon: LucideIcon; title: string; description: string };

const LEFT_CAPABILITIES: Capability[] = [
  { icon: Package, title: "Produk Anda", description: "Data produk, harga, stok, dan keunggulan." },
  { icon: Target, title: "Strategi Marketing", description: "Target, channel, dan peluang pasar." },
  { icon: BarChart3, title: "Analitik", description: "Hasil real-time, insight mudah dipahami." },
];

const RIGHT_CAPABILITIES: Capability[] = [
  { icon: FileText, title: "Konten & Copywriting", description: "Ide, caption, materi iklan, dan visual." },
  { icon: Rocket, title: "Campaign", description: "Eksekusi campaign ke channel relevan." },
  { icon: Sliders, title: "Optimasi", description: "Rekomendasi AI untuk hasil lebih baik." },
];

const ALL_CAPABILITIES = [...LEFT_CAPABILITIES, ...RIGHT_CAPABILITIES];

/** Small, translucent capability card — sits at a curve's endpoint, so it visibly reads as "powered by" the glowing line rather than a free-floating tile. */
function CapabilityCard({ icon: Icon, title, description }: Capability) {
  return (
    <div className="relative z-10 flex w-full max-w-xs items-start gap-3 rounded-[1.25rem] bg-white/80 p-3.5 text-left shadow-[0_10px_28px_-14px_rgba(37,99,235,0.45)] ring-1 ring-white/90 backdrop-blur-sm lg:max-w-[12rem] lg:p-3">
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-full text-white shadow-[0_0_18px_-2px_rgba(59,130,246,0.75)]"
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
 * The centerpiece. Founder correction: "substantially larger," with a
 * layered deep-blue/cyan/violet glow and a bright thin outer ring so it
 * immediately attracts the eye even before the connecting lines are read.
 */
function AiCore({ className }: { className?: string }) {
  return (
    <div className={cn("relative z-10 flex shrink-0 flex-col items-center gap-3", className)}>
      <div className="relative flex items-center justify-center">
        {/* Violet outer glow — widest, softest */}
        <div
          aria-hidden
          className="marketing-glow-pulse pointer-events-none absolute inset-0 -z-10 rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(139,92,246,0.55) 0%, transparent 72%)" }}
        />
        {/* Cyan inner glow — tighter, brighter */}
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-4 -z-10 rounded-full opacity-80 blur-xl"
          style={{ background: "radial-gradient(circle, rgba(34,211,238,0.6) 0%, transparent 70%)" }}
        />
        {/* Deep-blue center sphere with a thin bright outer ring */}
        <div
          className="flex size-40 items-center justify-center rounded-full text-white shadow-[0_0_90px_-12px_rgba(37,99,235,0.75)] ring-[3px] ring-[#a5f3fc]/80 sm:size-48 lg:size-60"
          style={{ background: "radial-gradient(circle at 32% 28%, #67e8f9 0%, #3b82f6 42%, #1d4ed8 78%, #4c1d95 100%)" }}
        >
          <Brain className="size-14 sm:size-16 lg:size-20" aria-hidden />
        </div>
      </div>
      <div className="flex flex-col items-center gap-1 px-2">
        <p className="text-xl font-bold text-foreground sm:text-2xl">Tanyopo Intelligence</p>
        <p className="text-xs font-semibold uppercase tracking-wide text-brand">AI Business Brain</p>
      </div>
    </div>
  );
}

type Point = { x: number; y: number };

/**
 * Six glow-filtered, animated-dash SVG curves from the core to every
 * capability card — the actual fix for "the AI energy flow is almost
 * invisible." Percentage coordinates (viewBox 0 0 100 100,
 * preserveAspectRatio="none") line up with the HTML nodes positioned the
 * same way, so this stays responsive without JS measurement.
 */
function EnergyFlow({ core, targets }: { core: Point; targets: Point[] }) {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="tiFlowGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="50%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
        <filter id="tiFlowGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="1.8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {targets.map((t, i) => {
        // Gentle curve: control point offset perpendicular-ish toward the
        // midpoint, so left/right groups fan out smoothly with no two
        // lines crossing.
        const mx = (core.x + t.x) / 2;
        const my = (core.y + t.y) / 2 + (t.y - core.y) * 0.08;
        return (
          <path
            key={i}
            d={`M ${core.x} ${core.y} Q ${mx} ${my} ${t.x} ${t.y}`}
            fill="none"
            stroke="url(#tiFlowGradient)"
            strokeWidth={1.4}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            filter="url(#tiFlowGlow)"
            className="ti-flow-path"
          />
        );
      })}
    </svg>
  );
}

// Desktop: core centered at (50, 50); 3 left cards at x=10, 3 right cards
// at x=90, evenly spaced in y so curves fan out without crossing.
const DESKTOP_CORE: Point = { x: 50, y: 50 };
const DESKTOP_TARGETS: Point[] = [
  { x: 22, y: 18 },
  { x: 22, y: 50 },
  { x: 22, y: 82 },
  { x: 78, y: 18 },
  { x: 78, y: 50 },
  { x: 78, y: 82 },
];

// Mobile: core near the top at (50, 14); all 6 cards stacked in one
// column below it, each with its own curve from the core (a visible
// "spine fanning into branches", not one short vertical bar).
const MOBILE_CORE: Point = { x: 50, y: 16 };
const MOBILE_TARGETS: Point[] = [
  { x: 50, y: 24 },
  { x: 50, y: 38 },
  { x: 50, y: 52 },
  { x: 50, y: 66 },
  { x: 50, y: 80 },
  { x: 50, y: 94 },
];

export function TanyopoIntelligenceDiagram() {
  return (
    <div className="relative mx-auto max-w-5xl">
      {/* Gentle animated flow-dash for the SVG paths — scoped class/keyframe names; respects prefers-reduced-motion. */}
      <style>{`
        .ti-flow-path { stroke-dasharray: 5 4; animation: ti-flow-dash 2.8s linear infinite; }
        @keyframes ti-flow-dash { to { stroke-dashoffset: -36; } }
        @media (prefers-reduced-motion: reduce) {
          .ti-flow-path { animation: none; }
        }
      `}</style>
      <Reveal className="w-full">
        {/* Desktop/tablet — core centered, 3 cards left / 3 cards right, six individually-curved energy paths (no two crossing). */}
        <div className="relative hidden h-[560px] w-full lg:block xl:h-[600px]">
          <EnergyFlow core={DESKTOP_CORE} targets={DESKTOP_TARGETS} />
          {DESKTOP_TARGETS.map((pos, i) => (
            <div
              key={ALL_CAPABILITIES[i].title}
              className="absolute"
              style={{
                left: `${pos.x}%`,
                top: `${pos.y}%`,
                transform: i < 3 ? "translate(-100%, -50%)" : "translate(0%, -50%)",
              }}
            >
              <CapabilityCard {...ALL_CAPABILITIES[i]} />
            </div>
          ))}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <AiCore />
          </div>
        </div>

        {/* Mobile/small tablet — large core up top, a visible fanning spine down to all six cards stacked in one column. Not a shrunk desktop layout. */}
        <div className="relative flex w-full flex-col items-center lg:hidden">
          <div className="relative w-full" style={{ minHeight: "clamp(760px, 190vw, 880px)" }}>
            <EnergyFlow core={MOBILE_CORE} targets={MOBILE_TARGETS} />
            <div className="absolute left-1/2" style={{ top: `${MOBILE_CORE.y}%`, transform: "translate(-50%, -50%)" }}>
              <AiCore />
            </div>
            {MOBILE_TARGETS.map((pos, i) => (
              <div
                key={ALL_CAPABILITIES[i].title}
                className="absolute w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
              >
                <CapabilityCard {...ALL_CAPABILITIES[i]} />
              </div>
            ))}
          </div>
        </div>
      </Reveal>
    </div>
  );
}
