import { Package, Brain, Target, FileText, Rocket, Sliders, BarChart3, TrendingUp, type LucideIcon } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";
import { cn } from "@/lib/utils/cn";

/**
 * Tanyopo Intelligence diagram — revision 10 ("final visual
 * finishing — energy connections only") of the PR #21
 * final-landing-visual work. This round's brief said the core/cards
 * are now in approximately correct positions and must not move again;
 * the only outstanding item in this file is the energy connections'
 * taper (see `EnergyNetwork`'s own header comment for the de Casteljau
 * split used to make each ribbon visibly thicker near the core and
 * narrower at the card). The composition itself — left/core/right on
 * wider screens, three nodes per side, no below-core grid, no
 * standalone "Pertumbuhan Bisnis" node — is unchanged from revision 9,
 * whose three fixes remain valid and are summarized below:
 *
 *   1. The dark/grey band behind the section heading was coming from
 *      tanyopo-intelligence.tsx (the parent section), not this file —
 *      see that file's own header for the fix (removing the leftover
 *      Hero-ink top-fade div). Nothing to fix here, noted for context.
 *   2. The 3-column left/core/right composition only activated at the
 *      `lg` (1024px) breakpoint, so any tablet/landscape viewport
 *      narrower than that fell back to the "core above a 2x3 grid"
 *      mobile composition — which is what the founder was seeing and
 *      correctly rejected as "core floating above all six cards". Fixed
 *      by moving the breakpoint to `md` (768px): the left/core/right
 *      composition (where the core is geometrically centered among all
 *      six nodes, vertically aligned with the middle row) now covers
 *      desktop AND tablet/landscape; only phone-portrait widths below
 *      768px keep the stacked core-above-grid fallback. Core size also
 *      brought down to the founder's new spec: `size-[230px]` for the
 *      left/core/right composition (was 260px, founder's 210–240px
 *      spec), `size-[170px]` for the phone fallback (was 200px,
 *      founder's 150–180px spec).
 *   3. The six energy branches all previously started from the exact
 *      same point (dead center of the core), so their wide blurred
 *      glow layers overlapped right at the core and read as a solid
 *      ring/blob rather than six distinct connections. Fixed by
 *      starting each branch from a different point just inside the
 *      core's edge, in the direction of its own target node — the
 *      inner portion is hidden behind the core (which renders above the
 *      energy layer at `z-10`), so each branch now visibly emerges from
 *      behind the sphere already heading toward its own card, instead
 *      of all six bunching into one shape at the center.
 *
 * Desktop/tablet (`md:` and up): `grid-cols-[28fr_44fr_28fr]` —
 * explicit LeftNodes / Core / RightNodes zones in a 28/44/28 ratio.
 * `fr` rather than literal `%` on purpose: three `%` tracks summing to
 * 100% plus a non-zero `gap-x` overflow their container (gaps are added
 * on top of percentage tracks, not subtracted from them first), which
 * was silently throwing off exactly where each column's real edge
 * landed — part of why the energy streams' endpoints weren't lining up
 * with the cards. `fr` tracks share the space left over *after* gaps
 * are subtracted, so 28/44/28 stays an exact ratio with no overflow.
 * Core fixed at `size-[230px]`, each node capped at `max-w-[280px]`
 * with `min-h-[90px]` (the `lg:min-w-[240px]` floor only applies at
 * `lg`+, where the 28fr column is wide enough not to overflow). DOM
 * order mirrors the required
 * logical structure: EnergySVG, then LeftNodes, then Core, then
 * RightNodes — three nodes vertically surrounding the core on each
 * side, nothing below this row.
 *
 * Phone (below `md`): a centered core fixed at `size-[170px]` directly
 * above a true 2-column x 3-row grid of the same six nodes, with the
 * energy network fanning from the core straight into the grid — no
 * stacked single-column fallback, no extra divider bars between them.
 *
 * Energy network: `EnergyNetwork`, a decorative SVG overlay absolutely
 * positioned (`inset-0`, `pointer-events-none`) inside the already-
 * `relative` composition wrapper. It never participates in grid/flex
 * sizing — the surrounding grid/flex rules are what place the core and
 * cards; the SVG only draws six ribbon paths, each spread from its own
 * start point near the core's edge (see fix #3 above) to its own node,
 * as three stroke layers (broad translucent blurred glow, medium
 * colored energy layer, narrow bright center) plus a subtle magenta
 * highlight on two branches — still plain curved stroked paths, no
 * rings, no straight connector/bus lines, no spiderweb. It renders at
 * `z-0`, strictly behind the core/cards at `z-10`.
 *
 * A restrained ambient background field (soft cyan/blue/violet radial
 * glows, `AmbientField`) sits behind the whole composition at `-z-10` —
 * decorative only, does not affect layout, background stays light.
 *
 * tanyopo-intelligence.tsx — this round's brief said to keep the
 * "Hasil Nyata untuk Pertumbuhan Bisnis Anda" outcome strip exactly as
 * it is; only its top dark-band div changes (see that file's header).
 * Everything else in it and every other section of the landing page
 * remain untouched.
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
 * The centerpiece and visual hero of the section. `desktop` variant
 * (used for the left/core/right composition, `md` breakpoint and up): a
 * fixed `size-[230px]` (founder's 210–240px spec). `mobile` variant
 * (phone fallback below `md`): a fixed `size-[170px]` (founder's
 * 150–180px spec). Deep-blue -> electric blue -> violet radial core,
 * strong cyan outer ring, violet secondary glow, a wide soft ambient
 * halo, and a bright inner highlight so it reads as dominant against
 * every surrounding node — never a flat blue circle. All glow layers
 * are decorative, absolutely positioned within this already-relative
 * wrapper, and sit behind the core circle (`-z-10`), so none of them
 * affect the core's own size or surrounding layout.
 *
 * "Tanyopo Intelligence" / "AI Business Brain" render INSIDE the
 * sphere, centered both horizontally and vertically, stacked under the
 * brain icon — there is no separate text block below the circle.
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
          isDesktop ? "size-[230px]" : "size-[170px]",
        )}
        style={{ background: "radial-gradient(circle at 32% 28%, #67e8f9 0%, #3b82f6 42%, #1d4ed8 78%, #4c1d95 100%)" }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute -left-4 -top-6 size-28 rounded-full opacity-70 blur-xl"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.85) 0%, transparent 70%)" }}
        />
        <div
          className={cn(
            "relative z-10 flex flex-col items-center justify-center gap-1.5 text-center",
            isDesktop ? "px-5" : "px-4",
          )}
        >
          <Brain className={isDesktop ? "size-9" : "size-7"} aria-hidden />
          <p className={cn("font-bold leading-tight", isDesktop ? "text-base" : "text-sm")}>
            Tanyopo
            <br />
            Intelligence
          </p>
          <p className={cn("font-semibold uppercase tracking-wide text-cyan-100", isDesktop ? "text-[10px]" : "text-[9px]")}>
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
 * Revision 9 ("final visual finishing") reworked the taper: founder
 * feedback asked for ribbons that are visibly "thicker near the core"
 * and narrow down toward each card. Each branch's original single
 * cubic Bezier is now split into two segments at its exact midpoint
 * (de Casteljau split, so the tangent matches exactly at the seam —
 * no visible kink): a `near` segment (closest to the core) rendered
 * with wider stroke widths, and a `far` segment (closest to the card)
 * rendered with narrower stroke widths. Each segment still gets the
 * same three-layer ribbon treatment (broad blurred glow / medium
 * colored energy / narrow bright center) so the taper reads as one
 * continuous flowing ribbon, not two different lines glued together.
 * A subtle magenta highlight rides on top of both segments of two
 * branches, same as before, also tapering with the ribbon.
 *
 * Each branch still starts from its own point near the core's edge
 * (not all six from one dead-center point), already aimed at its own
 * target, so the six branches read as distinct connections rather
 * than overlapping into a ring/blob at the core. `desktop` fans out to
 * three anchor points on each side (matching the three stacked nodes
 * in each column). `mobile` fans from points near the core's bottom
 * edge down into all six grid cells (2 columns x 3 rows). Endpoints
 * stay at x=22/78 (desktop) — well inside each card's footprint — so
 * every stream visibly terminates behind its card's inner edge, never
 * stopping short in the gutter.
 */
function EnergyNetwork({ variant }: { variant: "desktop" | "mobile" }) {
  // Each line is pre-split at its curve's exact midpoint (de Casteljau),
  // so `near` (core-side, wider strokes) and `far` (card-side, narrower
  // strokes) share one continuous tangent at the seam.
  const desktopLines = [
    { near: "M46,44 C42,41 37.5,37.5 33.3,34.1", far: "M33.3,34.1 C29,30.8 25,27.5 22,25", highlight: true },
    { near: "M44,50 C40,50 36,50 32.3,50", far: "M32.3,50 C28.5,50 25,50 22,50", highlight: false },
    { near: "M46,56 C42,59 37.5,62.5 33.3,65.9", far: "M33.3,65.9 C29,69.3 25,72.5 22,75", highlight: false },
    { near: "M54,44 C58,41 62.5,37.5 66.8,34.1", far: "M66.8,34.1 C71,30.8 75,27.5 78,25", highlight: false },
    { near: "M56,50 C60,50 64,50 67.8,50", far: "M67.8,50 C71.5,50 75,50 78,50", highlight: false },
    { near: "M54,56 C58,59 62.5,62.5 66.8,65.9", far: "M66.8,65.9 C71,69.3 75,72.5 78,75", highlight: true },
  ];
  const mobileLines = [
    { near: "M42,6 C39,7.5 35.5,9.25 32.4,11.1", far: "M32.4,11.1 C29.25,13 26.5,15 25,17", highlight: true },
    { near: "M58,6 C61,7.5 64.5,9.25 67.6,11.1", far: "M67.6,11.1 C70.75,13 73.5,15 75,17", highlight: false },
    { near: "M40,8 C36,12 32.5,18 29.9,25.3", far: "M29.9,25.3 C27.25,32.5 25.5,41 25,50", highlight: false },
    { near: "M60,8 C64,12 67.5,18 70.1,25.3", far: "M70.1,25.3 C72.75,32.5 74.5,41 75,50", highlight: false },
    { near: "M38,10 C33,17 29.5,29 27.4,42.4", far: "M27.4,42.4 C25.25,55.75 24.5,70.5 25,83", highlight: false },
    { near: "M62,10 C67,17 70.5,29 72.6,42.4", far: "M72.6,42.4 C74.75,55.75 75.5,70.5 75,83", highlight: true },
  ];
  const lines = variant === "desktop" ? desktopLines : mobileLines;
  const gradientId = `energy-gradient-${variant}`;
  const blurId = `energy-blur-${variant}`;

  // Ribbon layer widths/opacities, tapered: `near` (core-side) wider,
  // `far` (card-side) narrower — same three-layer treatment on both so
  // the seam reads as one continuous ribbon rather than two lines.
  const layers = [
    { key: "glow", near: 24, far: 13, opacity: 0.18, blur: true },
    { key: "medium", near: 13, far: 7, opacity: 0.5, blur: false },
    { key: "bright", near: 4, far: 2, opacity: 0.95, blur: false },
  ] as const;

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
          {layers.map((layer) => (
            <g key={layer.key}>
              {/* near (core-side) — wider */}
              <path
                d={line.near}
                stroke={`url(#${gradientId})`}
                strokeWidth={layer.near}
                strokeLinecap="round"
                fill="none"
                opacity={layer.opacity}
                filter={layer.blur ? `url(#${blurId})` : undefined}
                vectorEffect="non-scaling-stroke"
              />
              {/* far (card-side) — tapers narrower */}
              <path
                d={line.far}
                stroke={`url(#${gradientId})`}
                strokeWidth={layer.far}
                strokeLinecap="round"
                fill="none"
                opacity={layer.opacity}
                filter={layer.blur ? `url(#${blurId})` : undefined}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ))}
          {/* Subtle magenta highlight on select branches, tapering with the ribbon */}
          {line.highlight && (
            <>
              <path
                d={line.near}
                stroke="#f0abfc"
                strokeWidth={1.6}
                strokeLinecap="round"
                fill="none"
                opacity={0.4}
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={line.far}
                stroke="#f0abfc"
                strokeWidth={0.9}
                strokeLinecap="round"
                fill="none"
                opacity={0.4}
                vectorEffect="non-scaling-stroke"
              />
            </>
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
          DESKTOP/TABLET (md and up, 768px+) — one fixed visual
          composition, explicit LEFT 28fr / CENTER 44fr / RIGHT 28fr
          zones (`grid-cols-[28fr_44fr_28fr]` — `fr`, not `%`, so the
          28/44/28 ratio holds exactly even with a non-zero gap-x).
          Breakpoint moved from `lg`
          (1024px) to `md` (768px) per explicit founder correction: this
          composition — core geometrically centered among all six nodes,
          vertically aligned with the middle row — must cover desktop
          AND tablet/landscape, not just >=1024px. Logical structure:
            Diagram
             +-- EnergySVG
             +-- LeftNodes (Produk, Strategi, Analitik)
             +-- Core
             +-- RightNodes (Konten, Campaign, Optimasi)
          Three nodes vertically surround the core on each side. No
          capability cards, dividers, or outcome node below this row.
        */}
        <div className="relative hidden min-h-[480px] grid-cols-[28fr_44fr_28fr] items-center gap-x-6 md:grid md:gap-x-8 lg:min-h-[520px] xl:gap-x-12">
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
          PHONE ONLY (below md, <768px) — cannot reproduce the
          left/core/right composition at this width, so it fans
          vertically instead:
            MobileCore
            EnergySVG
            MobileNodes (2-column x 3-row grid)
          Large centered core directly above the grid, energy network
          fanning straight from the core into it. No single-column
          stack, no divider bars, no separate growth card.
        */}
        <div className="relative flex w-full flex-col items-center gap-2 md:hidden">
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
