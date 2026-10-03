import { Package, Brain, Target, FileText, Rocket, Sliders, BarChart3, type LucideIcon } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";
import { cn } from "@/lib/utils/cn";

/**
 * Tanyopo Intelligence diagram — revision 3 ("deterministic UI") of the
 * PR #21 final-landing-visual work. Founder rejected revision 2 for still
 * being built on approximate absolute/percentage positioning instead of a
 * fixed, explicit structure. This revision rebuilds the composition on
 * exactly the architecture specified:
 *
 * DESKTOP: a real 3-column CSS Grid (`minmax(0,1fr) auto minmax(0,1fr)`)
 * — left column = 3 cards (normal flex flow, no absolute positioning, so
 * there is no overflow/clipping risk at any width), center column = the
 * core, right column = 3 cards. The core is vertically centered against
 * the row by the grid's own `items-center`. A single SVG layer sits
 * behind everything (six static, two-layer — wide soft glow + narrow
 * bright — gradient Bezier curves, no filter, no animation, per the
 * explicit "a beautiful static path beats a broken animation" guidance)
 * with approximate endpoints near each card; it only has to read as
 * "core connects to this card," not land on an exact pixel.
 *
 * MOBILE: core → a continuous CSS gradient "spine" bar → six stacked
 * cards, each with a short horizontal "branch" tick connecting it to the
 * spine. No SVG, no absolute-positioned cards at all on mobile — the
 * spine/ticks are the only absolutely-positioned elements, and they're
 * purely decorative accents layered behind normal-flow content, so there
 * is nothing that can cause horizontal overflow.
 *
 * tanyopo-intelligence.tsx (heading, supporting copy, bottom value strip)
 * is untouched — its heading already reads "Tanyopo Intelligence di
 * Balik Setiap Hasil Besar" verbatim, per founder brief.
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

/** Compact capability card — white/translucent, rounded, subtle border + blue shadow, icon + title + one short line. Always normal document flow (flex/grid), never absolutely positioned. */
function CapabilityCard({ icon: Icon, title, description }: Capability) {
  return (
    <div className="relative z-10 flex w-full max-w-xs items-start gap-3 rounded-2xl border border-sky-100 bg-white/85 p-3.5 text-left shadow-[0_10px_26px_-16px_rgba(37,99,235,0.5)] backdrop-blur-sm">
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-full text-white shadow-[0_0_16px_-2px_rgba(59,130,246,0.75)]"
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
 * The centerpiece. Desktop: 224–240px (size-56 / xl:size-60), within the
 * founder's 220–240px spec. Mobile: a fixed 160px (size-40), within the
 * 150–170px spec — set as a flat size per variant rather than a
 * cascading responsive class, so it can't drift out of range at any
 * width. Deep-blue center, cyan inner glow, violet outer glow, thin
 * bright outer ring.
 */
function AiCore({ variant }: { variant: "desktop" | "mobile" }) {
  return (
    <div className="relative z-10 flex shrink-0 flex-col items-center gap-3">
      <div className="relative flex items-center justify-center">
        <div
          aria-hidden
          className="marketing-glow-pulse pointer-events-none absolute inset-0 -z-10 rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(139,92,246,0.5) 0%, transparent 72%)" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-4 -z-10 rounded-full opacity-75 blur-xl"
          style={{ background: "radial-gradient(circle, rgba(34,211,238,0.6) 0%, transparent 70%)" }}
        />
        <div
          className={cn(
            "flex items-center justify-center rounded-full text-white shadow-[0_0_80px_-12px_rgba(37,99,235,0.7)] ring-[3px] ring-[#a5f3fc]/80",
            variant === "desktop" ? "size-56 xl:size-60" : "size-40",
          )}
          style={{ background: "radial-gradient(circle at 32% 28%, #67e8f9 0%, #3b82f6 42%, #1d4ed8 78%, #4c1d95 100%)" }}
        >
          <Brain className={variant === "desktop" ? "size-16 xl:size-20" : "size-12"} aria-hidden />
        </div>
      </div>
      <div className="flex flex-col items-center gap-1 px-2">
        <p className={cn("font-bold text-foreground", variant === "desktop" ? "text-2xl" : "text-lg")}>Tanyopo Intelligence</p>
        <p className="text-xs font-semibold uppercase tracking-wide text-brand">AI Business Brain</p>
      </div>
    </div>
  );
}

type Point = { x: number; y: number };

/**
 * Desktop energy layer — six static, two-layer Bezier curves (wide
 * low-opacity glow + narrow bright line, no filter, no animation) from
 * the core to each card's approximate position. Sits behind the grid
 * content (z-0) inside the same `relative` grid container, using
 * percentage coordinates (viewBox 0 0 100 100, preserveAspectRatio=
 * "none") that stretch to match the grid's own content-driven height —
 * exact to the grid's fluid 1fr columns isn't knowable without JS
 * measurement, so endpoints are deliberately placed just inside each
 * card group (not claiming a precise pixel), which is enough for the
 * line to visibly originate at the core and terminate near its card.
 */
function DesktopEnergyFlow() {
  const core: Point = { x: 50, y: 50 };
  const targets: Point[] = [
    { x: 34, y: 17 },
    { x: 34, y: 50 },
    { x: 34, y: 83 },
    { x: 66, y: 17 },
    { x: 66, y: 50 },
    { x: 66, y: 83 },
  ];
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="tiFlowGradientDesktop" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="50%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      {targets.map((t, i) => {
        const mx = (core.x + t.x) / 2;
        const my = (core.y + t.y) / 2 + (t.y - core.y) * 0.1;
        const d = `M ${core.x} ${core.y} Q ${mx} ${my} ${t.x} ${t.y}`;
        return (
          <g key={i}>
            {/* layer 1: wide, low-opacity glow */}
            <path d={d} fill="none" stroke="url(#tiFlowGradientDesktop)" strokeWidth={5} strokeLinecap="round" strokeOpacity={0.3} vectorEffect="non-scaling-stroke" />
            {/* layer 2: narrow, bright energy line */}
            <path d={d} fill="none" stroke="url(#tiFlowGradientDesktop)" strokeWidth={1.6} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </g>
        );
      })}
    </svg>
  );
}

/** Mobile energy spine — one continuous vertical gradient bar running behind the stacked cards (each card adds its own short horizontal "branch" tick alongside it). Pure CSS (no SVG, no absolute-positioned cards). */
function MobileEnergySpine() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute bottom-0 left-4 top-0 w-1 rounded-full"
      style={{ background: "linear-gradient(180deg, #22d3ee 0%, #3b82f6 50%, #8b5cf6 100%)" }}
    />
  );
}

export function TanyopoIntelligenceDiagram() {
  return (
    <div className="relative mx-auto max-w-5xl">
      <Reveal className="w-full">
        {/* DESKTOP/TABLET: 3 cards | CORE | 3 cards — explicit 3-column grid, core vertically centered against the card columns, six static energy curves behind everything. */}
        <div className="relative hidden lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center lg:gap-x-6 xl:gap-x-10">
          <DesktopEnergyFlow />
          <div className="relative z-10 flex flex-col items-end justify-center gap-6">
            {LEFT_CAPABILITIES.map((item) => (
              <CapabilityCard key={item.title} {...item} />
            ))}
          </div>
          <div className="relative z-10 flex items-center justify-center px-2">
            <AiCore variant="desktop" />
          </div>
          <div className="relative z-10 flex flex-col items-start justify-center gap-6">
            {RIGHT_CAPABILITIES.map((item) => (
              <CapabilityCard key={item.title} {...item} />
            ))}
          </div>
        </div>

        {/* MOBILE: CORE -> vertical energy spine -> six stacked cards, each with a short branch tick. Completely different composition from desktop, not a shrunk copy. */}
        <div className="flex w-full flex-col items-center gap-0 lg:hidden">
          <AiCore variant="mobile" />
          {/* short connector bridging the core down to the top of the spine */}
          <div
            aria-hidden
            className="h-6 w-1 shrink-0 rounded-full"
            style={{ background: "linear-gradient(180deg, #22d3ee 0%, #3b82f6 100%)" }}
          />
          <div className="relative flex w-full flex-col items-stretch gap-5 py-1 pl-9 pr-1">
            <MobileEnergySpine />
            {ALL_CAPABILITIES.map((item) => (
              <div key={item.title} className="relative">
                <div
                  aria-hidden
                  className="pointer-events-none absolute -left-5 top-1/2 h-0.5 w-5 -translate-y-1/2"
                  style={{ background: "linear-gradient(90deg, #3b82f6 0%, #8b5cf6 100%)" }}
                />
                <CapabilityCard {...item} />
              </div>
            ))}
          </div>
        </div>
      </Reveal>
    </div>
  );
}
