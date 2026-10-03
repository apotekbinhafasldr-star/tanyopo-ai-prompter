import { Package, Brain, Target, FileText, Rocket, Sliders, BarChart3, TrendingUp, type LucideIcon } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";
import { cn } from "@/lib/utils/cn";

/**
 * Tanyopo Intelligence diagram — revision 5 ("final visual pass") of the
 * PR #21 final-landing-visual work, layered on top of revision 4's
 * approved structure. Revision 4 fixed the mobile layout: a real
 * two-column CSS Grid (`grid-cols-2`) instead of the broken single-column
 * stack, with the exact row order the founder specified:
 *   row 1: Produk Anda          | Strategi Marketing
 *   row 2: Konten & Copywriting | Campaign
 *   row 3: Analitik             | Optimasi
 * plus the "Pertumbuhan Bisnis" outcome node centered below the six
 * capabilities on both breakpoints. NONE of that structure changes here —
 * same grid/flex flow, same card positions, same mobile 2x3 shape.
 *
 * What this revision adds, per explicit founder sign-off for a premium
 * finishing pass:
 *   1. A more luminous AiCore — an added inner highlight layer and a
 *      brighter/wider halo on top of the existing cyan/blue/violet glow.
 *   2. A visible branching "energy network" from the core out to all six
 *      capability cards (both sides on desktop, both columns on mobile),
 *      rendered as a decorative SVG overlay (`EnergyNetwork`) — each
 *      branch is a bright cyan->blue->violet line plus a wider blurred
 *      glow behind it. This supersedes the old "no SVG" guidance now that
 *      the founder has asked for a visible branching network specifically;
 *      it is purely decorative, absolutely positioned (`inset-0`,
 *      `pointer-events-none`) *inside an already-`relative` flow
 *      container*, so it never participates in grid/flex sizing and
 *      cannot reintroduce the old overflow/empty-column failure mode —
 *      the underlying grid/flex structure is unchanged and still drives
 *      all real layout. Energy lines render at the back (`z-0`); cards and
 *      the core stay in front at `z-10`.
 *   3. Cosmetic-only card polish: slightly stronger glass blur, a thin
 *      violet/blue edge illumination ring, and a brighter icon glow.
 *      No change to card markup structure, spacing, or position.
 *   4. The capability system still connects down to "Pertumbuhan Bisnis"
 *      via the existing cyan->violet->green `VerticalEnergyBar`, now with
 *      a slightly stronger glow to match the brighter core.
 *
 * tanyopo-intelligence.tsx (heading, supporting copy, bottom value
 * strip) is untouched, as is every other section of the landing page.
 */
type Capability = { icon: LucideIcon; title: string; description: string };

const PRODUK: Capability = { icon: Package, title: "Produk Anda", description: "Data produk, harga, stok, dan keunggulan." };
const STRATEGI: Capability = { icon: Target, title: "Strategi Marketing", description: "Target, channel, dan peluang pasar." };
const ANALITIK: Capability = { icon: BarChart3, title: "Analitik", description: "Hasil real-time, insight mudah dipahami." };
const KONTEN: Capability = { icon: FileText, title: "Konten & Copywriting", description: "Ide, caption, materi iklan, dan visual." };
const CAMPAIGN: Capability = { icon: Rocket, title: "Campaign", description: "Eksekusi campaign ke channel relevan." };
const OPTIMASI: Capability = { icon: Sliders, title: "Optimasi", description: "Rekomendasi AI untuk hasil lebih baik." };

const LEFT_CAPABILITIES: Capability[] = [PRODUK, STRATEGI, ANALITIK];
const RIGHT_CAPABILITIES: Capability[] = [KONTEN, CAMPAIGN, OPTIMASI];

// Exact row-major order the founder specified for the mobile 2-column grid.
const MOBILE_GRID_ORDER: Capability[] = [PRODUK, STRATEGI, KONTEN, CAMPAIGN, ANALITIK, OPTIMASI];

const GROWTH: Capability = {
  icon: TrendingUp,
  title: "Pertumbuhan Bisnis",
  description: "Hasil nyata dari seluruh sistem AI yang terhubung.",
};

/** Compact capability card — white/translucent glass, rounded, thin violet/blue edge illumination + blue shadow, icon + title + one short line. Always normal grid/flex flow, never absolutely positioned (the edge illumination is a layered box-shadow, not a border-breaking overlay, so card geometry/spacing is unchanged from the approved layout). `accent="success"` is used only for the Pertumbuhan Bisnis outcome node, to read as the destination rather than one of the six inputs. */
function CapabilityCard({ icon: Icon, title, description, accent = "brand" }: Capability & { accent?: "brand" | "success" }) {
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
          background:
            accent === "success"
              ? "linear-gradient(135deg, #3b82f6 0%, #22c55e 100%)"
              : "linear-gradient(135deg, #22d3ee 0%, #3b82f6 55%, #8b5cf6 100%)",
          boxShadow:
            accent === "success"
              ? "0 0 20px -2px rgba(34,197,94,0.8)"
              : "0 0 20px -2px rgba(59,130,246,0.85)",
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
 * The centerpiece. Desktop: 224–240px (size-56 / xl:size-60), within the
 * 220–240px spec. Mobile: a flat 192px (size-48), within this round's
 * 170–200px spec. Deep-blue center, cyan inner glow, violet outer glow,
 * thin bright outer ring, plus (final visual pass) a brighter/wider outer
 * halo layer and a soft inner highlight for a more luminous read. All
 * glow layers are decorative, absolutely positioned within this
 * already-relative wrapper, and sit behind the core circle (`-z-10`), so
 * none of them affect the core's own size or the surrounding layout.
 */
function AiCore({ variant }: { variant: "desktop" | "mobile" }) {
  return (
    <div className="relative z-10 flex shrink-0 flex-col items-center gap-3">
      <div className="relative flex items-center justify-center">
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-10 -z-10 rounded-full opacity-70 blur-3xl"
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
            "relative flex items-center justify-center overflow-hidden rounded-full text-white shadow-[0_0_90px_-10px_rgba(37,99,235,0.8)] ring-[3px] ring-[#a5f3fc]/90",
            variant === "desktop" ? "size-56 xl:size-60" : "size-48",
          )}
          style={{ background: "radial-gradient(circle at 32% 28%, #67e8f9 0%, #3b82f6 42%, #1d4ed8 78%, #4c1d95 100%)" }}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute -left-4 -top-6 size-24 rounded-full opacity-70 blur-xl"
            style={{ background: "radial-gradient(circle, rgba(255,255,255,0.85) 0%, transparent 70%)" }}
          />
          <Brain className={cn("relative z-10", variant === "desktop" ? "size-16 xl:size-20" : "size-14")} aria-hidden />
        </div>
      </div>
      <div className="flex flex-col items-center gap-1 px-2">
        <p className={cn("font-bold text-foreground", variant === "desktop" ? "text-2xl" : "text-xl")}>Tanyopo Intelligence</p>
        <p className="text-xs font-semibold uppercase tracking-wide text-brand">AI Business Brain</p>
      </div>
    </div>
  );
}

/** Simple vertical cyan->blue->violet (or violet->green) gradient connector — plain CSS, no SVG. Used for the one connection that is naturally a single straight line: core-to-grid entry, and capability-system-to-growth-node. */
function VerticalEnergyBar({ className, toGreen }: { className?: string; toGreen?: boolean }) {
  return (
    <div
      aria-hidden
      className={cn("w-1.5 shrink-0 rounded-full shadow-[0_0_20px_-2px_rgba(59,130,246,0.75)]", className)}
      style={{
        background: toGreen
          ? "linear-gradient(180deg, #8b5cf6 0%, #22c55e 100%)"
          : "linear-gradient(180deg, #22d3ee 0%, #3b82f6 50%, #8b5cf6 100%)",
      }}
    />
  );
}

/** Horizontal distribution bar above the mobile grid — reads as "energy entering the whole capability system" without needing a line per card. */
function HorizontalEnergyBar() {
  return (
    <div
      aria-hidden
      className="h-1.5 w-full max-w-xs rounded-full shadow-[0_0_16px_-2px_rgba(59,130,246,0.6)]"
      style={{ background: "linear-gradient(90deg, #22d3ee 0%, #3b82f6 50%, #8b5cf6 100%)" }}
    />
  );
}

/**
 * Branching "energy network" from the core out to all six capability
 * cards — the final-visual-pass addition the founder asked for. Rendered
 * as a decorative SVG overlay, absolutely positioned (`inset-0`,
 * `pointer-events-none`) *inside the already-`relative` grid/flex
 * container that lays the cards out*. It never sizes or shifts that
 * container — the grid/flex rules already in place are what place the
 * cards; this only draws lines between approximate anchor points on top
 * of that fixed layout. Each branch is a wide, blurred glow line plus a
 * thin bright line on top (cyan -> blue -> violet), and the whole SVG is
 * `z-0`, strictly behind the cards and core at `z-10`, so lines read as
 * running *behind* the cards and text, never over them.
 *
 * `desktop` fans out from the core's center to three anchor points on
 * each side (matching the three stacked cards in each column). `mobile`
 * fans out from the point directly below the core (where the vertical +
 * horizontal bars already feed in) down to all six grid cells (2
 * columns x 3 rows).
 */
function EnergyNetwork({ variant }: { variant: "desktop" | "mobile" }) {
  const desktopLines = [
    "M50,50 Q42,34 34,18",
    "M50,50 L34,50",
    "M50,50 Q42,66 34,82",
    "M50,50 Q58,34 66,18",
    "M50,50 L66,50",
    "M50,50 Q58,66 66,82",
  ];
  const mobileLines = [
    "M50,0 Q30,8 25,17",
    "M50,0 Q70,8 75,17",
    "M50,0 Q22,28 25,50",
    "M50,0 Q78,28 75,50",
    "M50,0 Q18,55 25,83",
    "M50,0 Q82,55 75,83",
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
        <filter id={blurId} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>
      {lines.map((d, index) => (
        <g key={index}>
          <path
            d={d}
            stroke={`url(#${gradientId})`}
            strokeWidth={3.5}
            strokeLinecap="round"
            fill="none"
            opacity={0.45}
            filter={`url(#${blurId})`}
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={d}
            stroke={`url(#${gradientId})`}
            strokeWidth={1}
            strokeLinecap="round"
            fill="none"
            opacity={0.9}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      ))}
    </svg>
  );
}

export function TanyopoIntelligenceDiagram() {
  return (
    <div className="relative mx-auto max-w-5xl">
      <Reveal className="w-full">
        {/* DESKTOP/TABLET — core centered, 3 cards left / 3 cards right (unchanged, working layout), growth node centered below with a vertical connector down from the core. */}
        <div className="hidden lg:flex lg:flex-col lg:items-center">
          <div className="relative grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-6 xl:gap-x-10">
            <EnergyNetwork variant="desktop" />
            <div className="flex flex-col items-end justify-center gap-6">
              {LEFT_CAPABILITIES.map((item) => (
                <CapabilityCard key={item.title} {...item} />
              ))}
            </div>
            <div className="flex items-center justify-center px-2">
              <AiCore variant="desktop" />
            </div>
            <div className="flex flex-col items-start justify-center gap-6">
              {RIGHT_CAPABILITIES.map((item) => (
                <CapabilityCard key={item.title} {...item} />
              ))}
            </div>
          </div>
          <VerticalEnergyBar className="h-10" toGreen />
          <div className="w-full max-w-xs">
            <CapabilityCard {...GROWTH} accent="success" />
          </div>
        </div>

        {/* MOBILE/TABLET — core on top, then a real 2-column x 3-row grid (never a single stacked column), growth node centered below. */}
        <div className="flex w-full flex-col items-center gap-0 lg:hidden">
          <AiCore variant="mobile" />
          <VerticalEnergyBar className="h-8" />
          <HorizontalEnergyBar />
          <div className="relative mt-4 grid w-full grid-cols-2 gap-3 sm:gap-4">
            <EnergyNetwork variant="mobile" />
            {MOBILE_GRID_ORDER.map((item) => (
              <CapabilityCard key={item.title} {...item} />
            ))}
          </div>
          <VerticalEnergyBar className="mt-4 h-8" toGreen />
          <div className="w-full max-w-xs">
            <CapabilityCard {...GROWTH} accent="success" />
          </div>
        </div>
      </Reveal>
    </div>
  );
}
