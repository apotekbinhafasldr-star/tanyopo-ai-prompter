import { Package, Brain, Target, FileText, Rocket, Search, BarChart3, Sliders, TrendingUp, type LucideIcon } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";
import { cn } from "@/lib/utils/cn";

/**
 * Batch: Tanyopo Intelligence visual V3 — founder-approved reference
 * match. Keeps V2's light "AI Core" structure (Produk Anda left ->
 * Tanyopo Intelligence large glowing core, center -> Pertumbuhan Bisnis
 * right on desktop; vertical Produk -> Core -> capabilities -> Growth on
 * mobile) and adds three things the founder's actual reference image
 * called for that no prior version had:
 *   1. Numbered flow badges (1 Produk -> 2-7 capabilities -> 8
 *      Pertumbuhan) on every node, so the end-to-end sequence reads at a
 *      glance — this reverses V2's "capability-based, not numbers"
 *      choice, which was made without ever seeing the real reference.
 *   2. Visibly thicker, brighter connecting "energy" lines (both
 *      Horizontal/VerticalConnector) so the Produk -> Core -> Growth
 *      flow reads as alive, not decorative hairlines.
 *   3. A larger, more dominant AiCore so Tanyopo Intelligence is
 *      unambiguously the visual center of the section.
 * Bottom-bar copy ("Tanyopo Intelligence Siap Kapan Saja...") is
 * deliberately NOT reverted to the reference's literal "AI Bekerja
 * 24/7" wording — re-confirmed by the founder: LINOE's automation still
 * requires Owner approval before executing anything (see
 * services/automation-settings.ts / toggleEmergencyStopAction), so an
 * unqualified "24/7 autonomous" claim stays out. That copy lives in
 * features/marketing/sections/tanyopo-intelligence.tsx and is untouched
 * by this batch. Every capability listed is something LINOE already
 * does today — nothing invented.
 */
const CAPABILITIES: { icon: LucideIcon; title: string; description: string }[] = [
  { icon: Target, title: "Strategi Marketing", description: "AI menyusun arah pemasaran sesuai produk dan target pasar." },
  { icon: FileText, title: "Konten & Copywriting", description: "Membantu membuat ide, headline, caption, dan materi pemasaran." },
  { icon: Rocket, title: "Campaign", description: "Menyusun channel, audience, budget, dan eksekusi campaign." },
  { icon: Search, title: "SEO & Discovery", description: "Membantu bisnis lebih mudah ditemukan." },
  { icon: BarChart3, title: "Analitik", description: "Membaca hasil dan performa pemasaran." },
  { icon: Sliders, title: "Optimasi", description: "Memberikan rekomendasi langkah berikutnya." },
];

/** Small numbered badge marking a node's position in the Produk -> ... -> Growth sequence. */
function NumberBadge({ value, accent }: { value: number; accent: "brand" | "core" | "success" }) {
  const background =
    accent === "brand"
      ? "linear-gradient(135deg, #22d3ee 0%, #3b82f6 100%)"
      : accent === "success"
        ? "linear-gradient(135deg, #3b82f6 0%, #22c55e 100%)"
        : "linear-gradient(135deg, #22d3ee 0%, #3b82f6 50%, #8b5cf6 100%)";
  return (
    <span
      aria-hidden
      className="absolute -right-1 -top-1 flex size-6 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-[0_0_10px_-1px_rgba(59,130,246,0.8)] ring-2 ring-background sm:size-7 sm:text-xs"
      style={{ background }}
    >
      {value}
    </span>
  );
}

function EndpointNode({
  icon: Icon,
  label,
  accent,
  number,
}: {
  icon: LucideIcon;
  label: string;
  accent: "brand" | "success";
  number: number;
}) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-2">
      <div className="relative">
        <div
          className={cn(
            "flex size-14 items-center justify-center rounded-full border bg-surface shadow-[var(--shadow-md)] sm:size-16",
            accent === "brand" ? "border-brand/30 text-brand" : "border-success/30 text-success",
          )}
        >
          <Icon className="size-6 sm:size-7" aria-hidden />
        </div>
        <NumberBadge value={number} accent={accent} />
      </div>
      <span className="text-center text-sm font-semibold text-foreground sm:text-base">{label}</span>
    </div>
  );
}

/**
 * Energy-flow connectors — visibly thicker/brighter than V2 (founder
 * feedback: the "arus" must read as alive, not a thin decorative line).
 * Height/width roughly tripled from V2's h-1/w-1, with a stronger glow
 * shadow; the existing marketing-line-flow keyframe (app/globals.css,
 * unchanged) still drives the flowing animation.
 */
function HorizontalConnector({ toGreen }: { toGreen?: boolean }) {
  return (
    <div
      aria-hidden
      className="marketing-line-flow hidden h-3 min-w-10 flex-1 rounded-full shadow-[0_0_24px_-2px_rgba(59,130,246,0.85)] lg:block"
      style={{
        background: toGreen
          ? "linear-gradient(90deg, #8b5cf6 0%, #22c55e 100%)"
          : "linear-gradient(90deg, #22d3ee 0%, #3b82f6 50%, #8b5cf6 100%)",
      }}
    />
  );
}

function VerticalConnector({ toGreen, className }: { toGreen?: boolean; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "marketing-line-flow h-10 w-3 shrink-0 rounded-full shadow-[0_0_24px_-2px_rgba(139,92,246,0.75)] sm:h-12",
        className,
      )}
      style={{
        background: toGreen
          ? "linear-gradient(180deg, #8b5cf6 0%, #22c55e 100%)"
          : "linear-gradient(180deg, #22d3ee 0%, #3b82f6 45%, #8b5cf6 100%)",
      }}
    />
  );
}

/**
 * Dominant central core (founder feedback: must be unambiguously the
 * visual center — "BESAR, dominan, bercahaya"). Sizes bumped up from
 * V2 (size-28/32/40 -> size-32/40/48) with a wider, stronger glow halo
 * (blur-2xl -> blur-3xl, higher stop opacities) and an added static
 * outer glow ring on top of the existing marketing-glow-pulse animated
 * halo, so the core reads as powerful even on a static (non-hovered,
 * reduced-motion) render.
 */
function AiCore() {
  return (
    <div className="relative flex shrink-0 flex-col items-center gap-3">
      <div className="relative flex items-center justify-center">
        <div
          aria-hidden
          className="marketing-glow-pulse pointer-events-none absolute inset-0 -z-10 rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(34,211,238,0.7) 0%, rgba(139,92,246,0.65) 55%, transparent 75%)" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-3 -z-10 rounded-full opacity-70 blur-xl"
          style={{ background: "radial-gradient(circle, rgba(99,102,241,0.45) 0%, transparent 70%)" }}
        />
        <div
          className="flex size-32 items-center justify-center rounded-full text-white shadow-[0_0_100px_-8px_rgba(99,102,241,0.85)] ring-4 ring-white/20 sm:size-40 lg:size-48"
          style={{ background: "radial-gradient(circle at 35% 30%, #67e8f9 0%, #3b82f6 45%, #8b5cf6 90%)" }}
        >
          <Brain className="size-12 sm:size-16 lg:size-20" aria-hidden />
        </div>
      </div>
      <div className="flex flex-col items-center gap-1 px-2">
        <p className="text-lg font-bold text-foreground sm:text-xl">Tanyopo Intelligence</p>
        <p className="max-w-60 text-center text-xs leading-relaxed text-muted-foreground sm:max-w-xs sm:text-sm">
          AI yang menganalisis, menyusun strategi, dan menggerakkan proses pemasaran Anda.
        </p>
      </div>
    </div>
  );
}

// Flow sequence: 1 Produk Anda -> 2-7 capabilities (in CAPABILITIES order)
// -> 8 Pertumbuhan Bisnis, matching the founder reference's numbered nodes.
const PRODUCT_NUMBER = 1;
const GROWTH_NUMBER = CAPABILITIES.length + 2; // 8

export function TanyopoIntelligenceDiagram() {
  return (
    <div className="relative mx-auto max-w-5xl">
      <Reveal className="flex flex-col items-center gap-8 sm:gap-10">
        {/* Mobile / tablet — vertical flow: Produk -> Core */}
        <div className="flex flex-col items-center gap-3 lg:hidden">
          <EndpointNode icon={Package} label="Produk Anda" accent="brand" number={PRODUCT_NUMBER} />
          <VerticalConnector />
          <AiCore />
        </div>

        {/* Desktop — Produk (left) -> Core (center) -> Growth (right) */}
        <div className="hidden w-full items-center justify-center gap-4 lg:flex xl:gap-8">
          <EndpointNode icon={Package} label="Produk Anda" accent="brand" number={PRODUCT_NUMBER} />
          <HorizontalConnector />
          <AiCore />
          <HorizontalConnector toGreen />
          <EndpointNode icon={TrendingUp} label="Pertumbuhan Bisnis" accent="success" number={GROWTH_NUMBER} />
        </div>

        <VerticalConnector />

        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((item, i) => (
            <div
              key={item.title}
              className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-border bg-surface p-4 text-left shadow-[var(--shadow-sm)] transition-shadow hover:shadow-[var(--shadow-md)]"
            >
              <span className="relative flex size-10 items-center justify-center">
                <span
                  className="flex size-10 items-center justify-center rounded-full text-white"
                  style={{ background: "linear-gradient(135deg, #22d3ee 0%, #3b82f6 50%, #8b5cf6 100%)" }}
                >
                  <item.icon className="size-4" aria-hidden />
                </span>
                <NumberBadge value={i + 2} accent="core" />
              </span>
              <span className="text-sm font-semibold text-foreground">{item.title}</span>
              <span className="text-xs leading-relaxed text-muted-foreground">{item.description}</span>
            </div>
          ))}
        </div>

        {/* Mobile-only: Growth comes after the capability cards in the linear read-down */}
        <div className="flex flex-col items-center gap-3 lg:hidden">
          <VerticalConnector toGreen />
          <EndpointNode icon={TrendingUp} label="Pertumbuhan Bisnis" accent="success" number={GROWTH_NUMBER} />
        </div>
      </Reveal>
    </div>
  );
}
