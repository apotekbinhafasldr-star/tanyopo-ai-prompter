import { Package, Brain, Target, FileText, Rocket, Sliders, BarChart3, TrendingUp, type LucideIcon } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";
import { cn } from "@/lib/utils/cn";

/**
 * Tanyopo Intelligence diagram — revision 6 ("strict mockup rebuild") of
 * the PR #21 final-landing-visual work. Founder rejected revision 5
 * (luminous core + branching network bolted onto the old "core -> 2x3
 * grid below -> growth node" structure): the composition itself was
 * wrong, not just the glow level. This revision replaces the composition
 * entirely to match the approved mockup:
 *
 *   LEFT NODES          CORE (true visual center)          RIGHT NODES
 *   Produk Anda                                        Konten & Copywriting
 *   Strategi Marketing                                  Campaign
 *   Analitik                                             Optimasi
 *
 * Removed for good (do not reintroduce without explicit founder sign-off):
 *   - the six-card 2x3 grid stacked BELOW the core on desktop
 *   - the horizontal/vertical divider bars leading to it
 *   - the standalone "Pertumbuhan Bisnis" outcome card — growth is already
 *     communicated by this section's own heading/copy and bottom bar in
 *     tanyopo-intelligence.tsx (untouched)
 *
 * Desktop: one 3-column composition (left column / core / right column),
 * three capability nodes vertically surrounding the core on each side —
 * this is the one piece of the old layout that was already structurally
 * correct, so its grid mechanics (`grid-cols-[1fr_auto_1fr]`) carry over.
 * The core itself now dominates (240–256px) with a wider halo.
 *
 * Mobile: a large centered core directly above a true 2-column x 3-row
 * grid of the same six nodes (same row order as before), with the energy
 * network fanning from the core straight into the grid — no stacked
 * single-column fallback, no extra divider bars between them.
 *
 * Energy network: `EnergyNetwork`, a decorative SVG overlay absolutely
 * positioned (`inset-0`, `pointer-events-none`) inside the already-
 * `relative` composition wrapper. It never participates in grid/flex
 * sizing — the surrounding grid/flex rules are what place the core and
 * cards; the SVG only draws six organic, blurred+bright cyan->blue->
 * violet (with a subtle magenta highlight on two branches) energy paths
 * between fixed percentage anchor points on top of that fixed layout. It
 * renders at `z-0`, strictly behind the core/cards at `z-10`.
 *
 * A restrained ambient background field (soft cyan/blue/violet radial
 * glows, `AmbientField`) sits behind the whole composition at `-z-10` —
 * decorative only, does not affect layout, background stays light.
 *
 * tanyopo-intelligence.tsx (heading, supporting copy, bottom value
 * strip) and every other section of the landing page are untouched.
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

/** Premium white-translucent glass node — rounded, subtle border, soft shadow, glowing icon container, cyan/blue/violet accents. Always normal grid/flex flow, never absolutely positioned; sized to feel embedded in the energy network without dominating the core. */
function CapabilityCard({ icon: Icon, title, description }: Capability) {
  return (
    <div
      className="relative z-10 flex h-full w-full items-start gap-3 rounded-2xl border border-sky-100/80 bg-white/80 p-3.5 text-left backdrop-blur-md"
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
 * The centerpiece and visual hero of the section. Desktop: 240–256px
 * (size-60 / xl:size-64), within the founder's 230–280px spec. Mobile: a
 * flat 208px (size-52), within the 170–210px spec. Deep-blue -> electric
 * blue -> violet radial core, strong cyan outer ring, violet secondary
 * glow, a wide soft ambient halo, and a bright inner highlight so it
 * reads as dominant against every surrounding node — never a flat blue
 * circle. All glow layers are decorative, absolutely positioned within
 * this already-relative wrapper, and sit behind the core circle
 * (`-z-10`), so none of them affect the core's own size or surrounding
 * layout.
 */
function AiCore({ variant }: { variant: "desktop" | "mobile" }) {
  return (
    <div className="relative z-10 flex shrink-0 flex-col items-center gap-3">
      <div className="relative flex items-center justify-center">
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
            variant === "desktop" ? "size-60 xl:size-64" : "size-52",
          )}
          style={{ background: "radial-gradient(circle at 32% 28%, #67e8f9 0%, #3b82f6 42%, #1d4ed8 78%, #4c1d95 100%)" }}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute -left-4 -top-6 size-28 rounded-full opacity-70 blur-xl"
            style={{ background: "radial-gradient(circle, rgba(255,255,255,0.85) 0%, transparent 70%)" }}
          />
          <Brain className={cn("relative z-10", variant === "desktop" ? "size-16 xl:size-20" : "size-16")} aria-hidden />
        </div>
      </div>
      <div className="flex flex-col items-center gap-1 px-2">
        <p className={cn("font-bold text-foreground", variant === "desktop" ? "text-2xl" : "text-xl")}>Tanyopo Intelligence</p>
        <p className="text-xs font-semibold uppercase tracking-wide text-brand">AI Business Brain</p>
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
 * Six clearly visible luminous energy streams from the core out to each
 * capability node — the visual feature the mockup calls out as most
 * important. Rendered as a decorative SVG overlay, absolutely positioned
 * (`inset-0`, `pointer-events-none`) *inside the already-`relative`
 * composition wrapper*. It never sizes or shifts that wrapper — the
 * grid/flex rules already in place are what place the core and cards;
 * this only draws organic curved paths between fixed percentage anchor
 * points on top of that fixed layout. Each branch is a wide blurred glow
 * path plus a bright narrower path on top (cyan -> blue -> violet), and
 * two branches add a subtle magenta highlight pass for variety. The
 * whole SVG is `z-0`, strictly behind the core/cards at `z-10`, so
 * streams read as flowing *behind* them, never over them.
 *
 * `desktop` fans from the core's center to three organic anchor points
 * on each side (matching the three stacked nodes in each column).
 * `mobile` fans from the point directly below the core down into all six
 * grid cells (2 columns x 3 rows).
 */
function EnergyNetwork({ variant }: { variant: "desktop" | "mobile" }) {
  const desktopLines = [
    { d: "M50,50 C40,44 32,30 34,16", highlight: true },
    { d: "M50,50 C42,50 38,50 32,50", highlight: false },
    { d: "M50,50 C40,56 32,70 34,84", highlight: false },
    { d: "M50,50 C60,44 68,30 66,16", highlight: false },
    { d: "M50,50 C58,50 62,50 68,50", highlight: false },
    { d: "M50,50 C60,56 68,70 66,84", highlight: true },
  ];
  const mobileLines = [
    { d: "M50,2 C34,6 26,10 25,17", highlight: true },
    { d: "M50,2 C66,6 74,10 75,17", highlight: false },
    { d: "M50,2 C26,18 24,36 25,50", highlight: false },
    { d: "M50,2 C74,18 76,36 75,50", highlight: false },
    { d: "M50,2 C20,24 22,62 25,83", highlight: false },
    { d: "M50,2 C80,24 78,62 75,83", highlight: true },
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
        <filter id={blurId} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>
      {lines.map((line, index) => (
        <g key={index}>
          {/* A. blurred wide glow path */}
          <path
            d={line.d}
            stroke={`url(#${gradientId})`}
            strokeWidth={4.5}
            strokeLinecap="round"
            fill="none"
            opacity={0.55}
            filter={`url(#${blurId})`}
            vectorEffect="non-scaling-stroke"
          />
          {/* B. bright narrower main path */}
          <path
            d={line.d}
            stroke={`url(#${gradientId})`}
            strokeWidth={1.4}
            strokeLinecap="round"
            fill="none"
            opacity={0.95}
            vectorEffect="non-scaling-stroke"
          />
          {/* Subtle magenta highlight on select branches for organic variety */}
          {line.highlight && (
            <path
              d={line.d}
              stroke="#e879f9"
              strokeWidth={0.6}
              strokeLinecap="round"
              fill="none"
              opacity={0.5}
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
        {/* DESKTOP/TABLET — deterministic 3-column composition: left capability column, core as true visual center, right capability column. Three nodes per side vertically surround the core. No content below this row. */}
        <div className="relative hidden grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-8 lg:grid xl:gap-x-12">
          <AmbientField />
          <EnergyNetwork variant="desktop" />
          <div className="relative z-10 flex flex-col items-end justify-center gap-7">
            {LEFT_CAPABILITIES.map((item) => (
              <CapabilityCard key={item.title} {...item} />
            ))}
          </div>
          <div className="relative z-10 flex items-center justify-center px-2">
            <AiCore variant="desktop" />
          </div>
          <div className="relative z-10 flex flex-col items-start justify-center gap-7">
            {RIGHT_CAPABILITIES.map((item) => (
              <CapabilityCard key={item.title} {...item} />
            ))}
          </div>
        </div>

        {/* MOBILE/TABLET — large centered core directly above a true 2-column x 3-row grid, with the energy network fanning straight from the core into the grid. No single-column stack, no extra divider bars. */}
        <div className="relative flex w-full flex-col items-center gap-3 lg:hidden">
          <AmbientField />
          <AiCore variant="mobile" />
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
