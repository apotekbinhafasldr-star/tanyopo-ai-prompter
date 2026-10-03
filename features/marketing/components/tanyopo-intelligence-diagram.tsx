import { Package, Brain, Target, FileText, Rocket, Sliders, BarChart3, TrendingUp, type LucideIcon } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";
import { cn } from "@/lib/utils/cn";

/**
 * Tanyopo Intelligence diagram — revision 4 ("mobile rebuild") of the
 * PR #21 final-landing-visual work. Founder rejected revision 3's
 * mobile output: it used a single flex-col stack, which rendered all six
 * capability cards in one left-aligned column with the right half of the
 * screen empty — a real bug, not a matter of taste. This revision
 * replaces that with an actual two-column CSS Grid on mobile
 * (`grid-cols-2`), matching the exact row order the founder specified:
 *   row 1: Produk Anda          | Strategi Marketing
 *   row 2: Konten & Copywriting | Campaign
 *   row 3: Analitik             | Optimasi
 * plus a new "Pertumbuhan Bisnis" outcome node centered below the six
 * capabilities on both breakpoints (previously dropped when revision 1
 * folded Produk Anda into the capability set — founder has now asked for
 * it back explicitly).
 *
 * Energy connections are intentionally the simplest reliable shape per
 * explicit founder guidance ("no complex experimental SVG geometry if
 * normal CSS/grid can achieve a more reliable result... prioritize
 * deterministic responsive layout over fancy animation"): plain CSS
 * gradient bars, not SVG. Desktop keeps its working 3-column grid
 * (left 3 cards / core / right 3 cards, untouched from the last
 * approved pass) and adds one vertical bar down to the new growth node.
 * Mobile: core -> vertical bar -> horizontal distribution bar spanning
 * the grid -> the 2x3 card grid -> vertical bar -> growth node. Nothing
 * here is absolutely positioned; every element is normal grid/flex flow,
 * so there is no overflow/clipping/empty-column failure mode possible.
 *
 * tanyopo-intelligence.tsx (heading, supporting copy, bottom value
 * strip) is untouched.
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

/** Compact capability card — white/translucent, rounded, subtle border + blue shadow, icon + title + one short line. Always normal grid/flex flow, never absolutely positioned. `accent="success"` is used only for the Pertumbuhan Bisnis outcome node, to read as the destination rather than one of the six inputs. */
function CapabilityCard({ icon: Icon, title, description, accent = "brand" }: Capability & { accent?: "brand" | "success" }) {
  return (
    <div className="relative z-10 flex h-full w-full items-start gap-3 rounded-2xl border border-sky-100 bg-white/85 p-3.5 text-left shadow-[0_10px_26px_-16px_rgba(37,99,235,0.5)] backdrop-blur-sm">
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-full text-white shadow-[0_0_16px_-2px_rgba(59,130,246,0.75)]"
        style={{
          background:
            accent === "success"
              ? "linear-gradient(135deg, #3b82f6 0%, #22c55e 100%)"
              : "linear-gradient(135deg, #22d3ee 0%, #3b82f6 55%, #8b5cf6 100%)",
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
 * thin bright outer ring.
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
            variant === "desktop" ? "size-56 xl:size-60" : "size-48",
          )}
          style={{ background: "radial-gradient(circle at 32% 28%, #67e8f9 0%, #3b82f6 42%, #1d4ed8 78%, #4c1d95 100%)" }}
        >
          <Brain className={variant === "desktop" ? "size-16 xl:size-20" : "size-14"} aria-hidden />
        </div>
      </div>
      <div className="flex flex-col items-center gap-1 px-2">
        <p className={cn("font-bold text-foreground", variant === "desktop" ? "text-2xl" : "text-xl")}>Tanyopo Intelligence</p>
        <p className="text-xs font-semibold uppercase tracking-wide text-brand">AI Business Brain</p>
      </div>
    </div>
  );
}

/** Simple vertical cyan->blue->violet gradient connector — plain CSS, no SVG. */
function VerticalEnergyBar({ className, toGreen }: { className?: string; toGreen?: boolean }) {
  return (
    <div
      aria-hidden
      className={cn("w-1.5 shrink-0 rounded-full shadow-[0_0_16px_-2px_rgba(59,130,246,0.6)]", className)}
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

export function TanyopoIntelligenceDiagram() {
  return (
    <div className="relative mx-auto max-w-5xl">
      <Reveal className="w-full">
        {/* DESKTOP/TABLET — core centered, 3 cards left / 3 cards right (unchanged, working layout), growth node centered below with a vertical connector down from the core. */}
        <div className="hidden lg:flex lg:flex-col lg:items-center">
          <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-6 xl:gap-x-10">
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
          <div className="mt-4 grid w-full grid-cols-2 gap-3 sm:gap-4">
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
