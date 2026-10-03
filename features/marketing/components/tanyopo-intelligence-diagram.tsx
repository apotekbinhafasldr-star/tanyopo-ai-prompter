import { Package, Brain, Target, FileText, Rocket, Sliders, BarChart3, TrendingUp, type LucideIcon } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";
import { cn } from "@/lib/utils/cn";

/**
 * Tanyopo Intelligence diagram — revision 8 ("ribbon energy + in-sphere
 * title") of the PR #21 final-landing-visual work, on top of revision
 * 7's left/core/right composition (unchanged: `grid-cols-[28%_44%_28%]`
 * on desktop, three nodes per side, centered core, no below-core grid,
 * no standalone "Pertumbuhan Bisnis" node). This round's founder
 * feedback targeted two specific things, both addressed here:
 *
 *   1. "Tanyopo Intelligence" / "AI Business Brain" now render INSIDE
 *      the core sphere (stacked under the brain icon), not underneath
 *      it — `AiCore` no longer renders a separate text block below the
 *      circle.
 *   2. The energy connections now read as luminous flowing ribbons
 *      rather than thin wires: each of the six `EnergyNetwork` branches
 *      is three stroke layers — a broad translucent glow (blurred), a
 *      medium colored energy layer, and a narrow bright center — plus a
 *      subtle magenta highlight on two branches. Still plain curved SVG
 *      paths (no rings, no straight connector/bus lines, no spiderweb).
 *
 * Also tightened per "reduce unnecessary vertical whitespace":
 * `min-h-[560px]`→`min-h-[480px]` (desktop), card gap `gap-7`→`gap-5`.
 *
 * Desktop: `grid-cols-[28%_44%_28%]` — explicit LeftNodes / Core /
 * RightNodes zones, `min-h-[480px] lg:min-h-[520px]`, core fixed at
 * `size-[260px]`, each node capped at `max-w-[280px]` with
 * `min-h-[90px]`. DOM order mirrors the required logical structure:
 * EnergySVG, then LeftNodes, then Core, then RightNodes — three nodes
 * vertically surrounding the core on each side, nothing below this row.
 *
 * Mobile: a centered core fixed at `size-[200px]` directly above a true
 * 2-column x 3-row grid of the same six nodes, with the energy network
 * fanning from the core straight into the grid — no stacked
 * single-column fallback, no extra divider bars between them.
 *
 * Energy network: `EnergyNetwork`, a decorative SVG overlay absolutely
 * positioned (`inset-0`, `pointer-events-none`) inside the already-
 * `relative` composition wrapper. It never participates in grid/flex
 * sizing — the surrounding grid/flex rules are what place the core and
 * cards; the SVG only draws six organic ribbon paths between fixed
 * percentage anchor points on top of that fixed layout. It renders at
 * `z-0`, strictly behind the core/cards at `z-10`.
 *
 * A restrained ambient background field (soft cyan/blue/violet radial
 * glows, `AmbientField`) sits behind the whole composition at `-z-10` —
 * decorative only, does not affect layout, background stays light.
 *
 * tanyopo-intelligence.tsx — this round's founder brief also asked for
 * new copy on that file's bottom outcome strip ("Hasil Nyata untuk
 * Pertumbuhan Bisnis Anda" + 4 emoji items), so unlike prior revisions
 * that file is NOT fully untouched this round; see its own file header
 * for exactly what changed there. Everything else in it (heading,
 * supporting copy) and every other section of the landing page remain
 * untouched.
 */
type Capability = { icon: LucideIcon; title: string; description: string };

const PRODUK: Capability = { icon: Package, title: "Produk Anda", description: "Data produk, harga, stok, dan keunggulan." };
const STRATEGI: Capability = {
  icon: Target,
  title: "Strategi Marketing",
  description: "Menentukan target, channel, dan peluang pasar.",
};
const ANALITIK: Capability = {
  icon: BarChart3,
  title: "Analitik",
  description: "Hasil real-time dan insight yang mudah dipahami.",
};
const KONTEN: Capability = {
  icon: FileText,
  title: "Konten & Copywriting",
  description: "Ide, caption, materi iklan, dan visual yang menarik.",
};
const CAMPAIGN: Capability = { icon: Rocket, title: "Campaign", description: "Eksekusi campaign ke channel yang relevan." };
const OPTIMASI: Capability = { icon: Sliders, title: "Optimasi", description: "Rekomendasi AI untuk hasil yang lebih baik." };

const LEFT_CAPABILITIES: Capability[] = [PRODUK, STRATEGI, ANALITIK];
const RIGHT_CAPABILITIES: Capability[] = [KONTEN, CAMPAIGN, OPTIMASI];

// Row-major order for the mobile 2-column grid — unchanged from the
// approved mobile row order (row 1: Produk/Strategi, row 2: Konten/
// Campaign, row 3: Analitik/Optimasi).
const MOBILE_GRID_ORDER: Capability[] = [PRODUK, STRATEGI, KONTEN, CAMPAIGN, ANALITIK, OPTIMASI];

/** Premium white-translucent glass node — rounded, subtle border, soft shadow, glowing icon container, cyan/blue/violet accents. Always normal grid/flex flow, never absolutely positioned. Capped at the founder's 240–280px width / 90px min-height spec so it feels embedded in the energy network without dominating the core; node glow (icon shadow below) is deliberately weaker than the core's. */
function CapabilityCard({ icon: Icon, title, description }: Capability) {
  return (
    <div
      className="relative z-10 flex min-h-[90px] w-full max-w-[280px] items-start gap-3 rounded-2xl border border-sky-100/80 bg-white/80 p-3.5 text-left backdrop-blur-md lg:min-w-[240px]"
      style={{
        boxShadow:
          "0 14px 30px -16px rgba(37,99,235,0.55), 0 0 0 1px rgba(139,92,246,0.14), inset 0 1px 0 0 rgba(255,255,255,0.6)",
      }}
    >
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-full text-white"
        style={{
          background: "linear-gradient(135deg, #22d3ee 0%, #3b82f6 55%, #8b5cf6 100%)",
          boxShadow: "0 0 20px -2px rgba(59,130,246,0.85)",
        }}
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
 * The centerpiece and visual hero of the section. Desktop: a fixed
 * `size-[260px]`. Mobile: a fixed `size-[200px]`. Deep-blue -> electric
 * blue -> violet radial core, strong cyan outer ring, violet secondary
 * glow, a wide soft ambient halo, and a bright inner highlight so it
 * reads as dominant against every surrounding node — never a flat blue
 * circle. All glow layers are decorative, absolutely positioned within
 * this already-relative wrapper, and sit behind the core circle
 * (`-z-10`), so none of them affect the core's own size or surrounding
 * layout.
 *
 * Per explicit founder correction: "Tanyopo Intelligence" / "AI Business
 * Brain" render INSIDE the sphere, stacked under the brain icon — there
 * is no separate text block below the circle anymore.
 */
function AiCore({ variant }: { variant: "desktop" | "mobile" }) {
  const isDesktop = variant === "desktop";
  return (
    <div className="relative z-10 flex shrink-0 items-center justify-center">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-12 -z-10 rounded-full opacity-70 blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(34,211,238,0.45) 0%, rgba(139,92,246,0.3) 55%, transparent 78%)" }}
      />
      <div
        aria-hidden
        className="marketing-glow-pulse pointer-events-none absolute inset-0 -z-10 rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(139,92,246,0.55) 0%, transparent 72%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-4 -z-10 rounded-full opacity-80 blur-xl"
        style={{ background: "radial-gradient(circle, rgba(34,211,238,0.65) 0%, transparent 70%)" }}
      />
      <div
        className={cn(
          "relative flex items-center justify-center overflow-hidden rounded-full text-white shadow-[0_0_100px_-12px_rgba(37,99,235,0.85)] ring-[3px] ring-[#a5f3fc]/90",
          isDesktop ? "size-[260px]" : "size-[200px]",
        )}
        style={{ background: "radial-gradient(circle at 32% 28%, #67e8f9 0%, #3b82f6 42%, #1d4ed8 78%, #4c1d95 100%)" }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute -left-4 -top-6 size-28 rounded-full opacity-70 blur-xl"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.85) 0%, transparent 70%)" }}
        />
        <div className="relative z-10 flex flex-col items-center gap-1.5 px-5 text-center">
          <Brain className={isDesktop ? "size-10" : "size-8"} aria-hidden />
          <p className={cn("font-bold leading-tight", isDesktop ? "text-lg" : "text-base")}>
            Tanyopo
            <br />
            Intelligence
          </p>
          <p className={cn("font-semibold uppercase tracking-wide text-cyan-100", isDesktop ? "text-[11px]" : "text-[10px]")}>
            AI Business Brain
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Restrained ambient energy field behind the whole composition — soft
 * cyan/blue/violet radial glows only, no dark section, background stays
 * primarily light. Purely decorative: absolutely positioned (`inset-0`,
 * `-z-10`, `pointer-events-none`) inside the composition's own
 * `relative` wrapper, so it never affects sizing or layout.
 */
function AmbientField() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute -inset-x-6 -inset-y-10 -z-10 opacity-80 sm:-inset-x-10"
      style={{
        background:
          "radial-gradient(38% 46% at 8% 30%, rgba(34,211,238,0.16) 0%, transparent 72%), " +
          "radial-gradient(42% 50% at 92% 70%, rgba(139,92,246,0.16) 0%, transparent 72%), " +
          "radial-gradient(60% 38% at 50% 0%, rgba(59,130,246,0.12) 0%, transparent 75%)",
      }}
    />
  );
}

/**
 * Six luminous flowing energy ribbons from the core out to each
 * capability node. Rendered as a decorative SVG overlay, absolutely
 * positioned (`inset-0`, `pointer-events-none`) *inside the already-
 * `relative` composition wrapper*. It never sizes or shifts that
 * wrapper — the grid/flex rules already in place are what place the
 * core and cards; this only draws organic curved paths between fixed
 * percentage anchor points on top of that fixed layout.
 *
 * Per explicit founder correction, each branch is three stroke layers
 * (not two) so it reads as a flowing ribbon rather than a wire: a broad
 * translucent glow (blurred), a medium colored energy layer, and a
 * narrow bright center — plus a subtle magenta highlight on two
 * branches. Still a plain curved stroked path (no rings, no straight
 * connector/bus lines, no spiderweb). The whole SVG is `z-0`, strictly
 * behind the core/cards at `z-10`, so ribbons read as flowing *behind*
 * them, never over them.
 *
 * `desktop` fans from the core's center to three anchor points on each
 * side (matching the three stacked nodes in each column). `mobile` fans
 * from the point directly below the core down into all six grid cells
 * (2 columns x 3 rows).
 */
function EnergyNetwork({ variant }: { variant: "desktop" | "mobile" }) {
  const desktopLines = [
    { d: "M50,50 C40,44 34,34 30,25", highlight: true },
    { d: "M50,50 C42,50 36,50 30,50", highlight: false },
    { d: "M50,50 C40,56 34,66 30,75", highlight: false },
    { d: "M50,50 C60,44 66,34 70,25", highlight: false },
    { d: "M50,50 C58,50 64,50 70,50", highlight: false },
    { d: "M50,50 C60,56 66,66 70,75", highlight: true },
  ];
  const mobileLines = [
    { d: "M50,3 C34,8 26,12 25,17", highlight: true },
    { d: "M50,3 C66,8 74,12 75,17", highlight: false },
    { d: "M50,3 C26,22 24,38 25,50", highlight: false },
    { d: "M50,3 C74,22 76,38 75,50", highlight: false },
    { d: "M50,3 C20,30 22,65 25,83", highlight: false },
    { d: "M50,3 C80,30 78,65 75,83", highlight: true },
  ];
  const lines = variant === "desktop" ? desktopLines : mobileLines;
  const gradientId = `energy-gradient-${variant}`;
  const blurId = `energy-blur-${variant}`;

  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="50%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
        <filter id={blurId} x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>
      {lines.map((line, index) => (
        <g key={index}>
          {/* 1. broad translucent glow layer */}
          <path
            d={line.d}
            stroke={`url(#${gradientId})`}
            strokeWidth={30}
            strokeLinecap="round"
            fill="none"
            opacity={0.18}
            filter={`url(#${blurId})`}
            vectorEffect="non-scaling-stroke"
          />
          {/* 2. medium colored energy layer */}
          <path
            d={line.d}
            stroke={`url(#${gradientId})`}
            strokeWidth={11}
            strokeLinecap="round"
            fill="none"
            opacity={0.5}
            vectorEffect="non-scaling-stroke"
          />
          {/* 3. narrow bright center layer */}
          <path
            d={line.d}
            stroke={`url(#${gradientId})`}
            strokeWidth={3.2}
            strokeLinecap="round"
            fill="none"
            opacity={0.95}
            vectorEffect="non-scaling-stroke"
          />
          {/* Subtle magenta highlight on select branches */}
          {line.highlight && (
            <path
              d={line.d}
              stroke="#f0abfc"
              strokeWidth={1.2}
              strokeLinecap="round"
              fill="none"
              opacity={0.4}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </g>
      ))}
    </svg>
  );
}

export function TanyopoIntelligenceDiagram() {
  return (
    <div className="relative mx-auto max-w-5xl">
      <Reveal className="w-full">
        {/*
          DESKTOP/TABLET — one fixed visual composition, explicit LEFT
          28% / CENTER 44% / RIGHT 28% zones (`grid-cols-[28%_44%_28%]`,
          not 1fr/auto, so the split is exact regardless of content).
          Tightened per founder follow-up ("reduce unnecessary vertical
          whitespace"). Logical structure:
            Diagram
             +-- EnergySVG
             +-- LeftNodes (Produk, Strategi, Analitik)
             +-- Core
             +-- RightNodes (Konten, Campaign, Optimasi)
          Three nodes vertically surround the core on each side. No
          capability cards, dividers, or outcome node below this row.
        */}
        <div className="relative hidden min-h-[480px] grid-cols-[28%_44%_28%] items-center gap-x-8 lg:grid lg:min-h-[520px] xl:gap-x-12">
          <AmbientField />
          {/* EnergySVG */}
          <EnergyNetwork variant="desktop" />
          {/* LeftNodes */}
          <div className="relative z-10 flex flex-col items-end justify-center gap-5">
            {LEFT_CAPABILITIES.map((item) => (
              <CapabilityCard key={item.title} {...item} />
            ))}
          </div>
          {/* Core */}
          <div className="relative z-10 flex items-center justify-center px-2">
            <AiCore variant="desktop" />
          </div>
          {/* RightNodes */}
          <div className="relative z-10 flex flex-col items-start justify-center gap-5">
            {RIGHT_CAPABILITIES.map((item) => (
              <CapabilityCard key={item.title} {...item} />
            ))}
          </div>
        </div>

        {/*
          MOBILE/TABLET — cannot reproduce the desktop 3-column
          composition at this width, so it fans vertically instead:
            MobileCore
            EnergySVG
            MobileNodes (2-column x 3-row grid)
          Large centered core directly above the grid, energy network
          fanning straight from the core into it. No single-column
          stack, no divider bars, no separate growth card.
        */}
        <div className="relative flex w-full flex-col items-center gap-2 lg:hidden">
          <AmbientField />
          {/* MobileCore */}
          <AiCore variant="mobile" />
          {/* EnergySVG + MobileNodes */}
          <div className="relative grid w-full grid-cols-2 gap-3 sm:gap-4">
            <EnergyNetwork variant="mobile" />
            {MOBILE_GRID_ORDER.map((item) => (
              <CapabilityCard key={item.title} {...item} />
            ))}
          </div>
        </div>
      </Reveal>
    </div>
  );
}
