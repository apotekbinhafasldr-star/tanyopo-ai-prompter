import { Package, Brain, Target, FileText, Megaphone, Search, BarChart3, Settings, TrendingUp, type LucideIcon } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";

/**
 * Tanyopo Intelligence — Animated V4. Rebuilt to strictly match the
 * founder-supplied reference
 * (LINOE_TANYOPO_INTELLIGENCE_VISUAL_REFERENCE_FINAL.png, root of the
 * repo): dark "island" cards (Produk Anda, six capability cards,
 * Pertumbuhan Bisnis) floating on a lighter ambient section background,
 * a large glowing AI core with its title/subtitle set inside the orb,
 * numbered badges walking the whole flow 1-8, and curved neon connector
 * lines fanning from the core. Capability-based, not numbers — no
 * illustrative metric/result ever belongs here, since this diagram
 * explains how the system works, not a customer's results (product spec
 * §3/§7). Every capability listed is something LINOE already does
 * today — nothing invented. Every animation is CSS transform/opacity/
 * background-position/SVG stroke-dashoffset only (see the
 * `tanyopo-*`/`marketing-*` utility classes in app/globals.css), no
 * canvas/WebGL/animation library, and all disabled under
 * prefers-reduced-motion.
 *
 * The reference image numbers its 6 capability cards 2,3,4,5,6,6 and
 * its Growth card 7 — an evident off-by-one slip in the source asset
 * (7 numbered stops for what is actually an 8-stop journey: Produk +
 * 6 capabilities + Growth). Corrected here to a consistent 1-8 sequence.
 */
const CAPABILITIES: { icon: LucideIcon; title: string; description: string }[] = [
  { icon: Target, title: "Strategi Marketing", description: "AI menyusun strategi sesuai target pasar dan tujuan bisnis Anda." },
  { icon: FileText, title: "Konten & Copywriting", description: "Membuat ide, headline, caption, dan creative yang menarik." },
  { icon: Megaphone, title: "Campaign", description: "Menentukan channel, audiens, budget, dan eksekusi kampanye." },
  { icon: Search, title: "SEO & Discovery", description: "Meningkatkan visibilitas di Google dan platform lainnya." },
  { icon: BarChart3, title: "Analitik", description: "Memantau hasil dan performa secara real-time." },
  { icon: Settings, title: "Optimasi", description: "Memberikan rekomendasi otomatis untuk hasil lebih baik." },
];

const CARD_BG = "linear-gradient(160deg, #16224d 0%, #0c1631 100%)";
const ICON_BADGE_BG = "linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)";

function NumberBadge({ n }: { n: number }) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-cyan-300/60 text-[10px] font-bold text-cyan-300">
      {n}
    </span>
  );
}

function EndpointCard({
  number,
  icon: Icon,
  label,
  description,
}: {
  number: number;
  icon: LucideIcon;
  label: string;
  description: string;
}) {
  return (
    <div
      className="tanyopo-card-sheen relative flex w-full max-w-xs items-start gap-3 overflow-hidden rounded-2xl border border-white/10 p-4 shadow-[0_12px_32px_-12px_rgba(15,23,60,0.6)] sm:p-5 lg:max-w-[15rem]"
      style={{
        background: `${CARD_BG}, linear-gradient(90deg, transparent 0%, rgba(103,232,249,0.35) 50%, transparent 100%)`,
        backgroundBlendMode: "normal, overlay",
      }}
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-xl text-white sm:size-14" style={{ background: ICON_BADGE_BG }}>
        <Icon className="size-6 sm:size-7" aria-hidden />
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <NumberBadge n={number} />
          <p className="text-sm font-bold text-white sm:text-base">{label}</p>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-white/65 sm:text-sm">{description}</p>
      </div>
    </div>
  );
}

function CapabilityCard({
  number,
  icon: Icon,
  title,
  description,
  delayMs,
}: {
  number: number;
  icon: LucideIcon;
  title: string;
  description: string;
  delayMs: number;
}) {
  return (
    <Reveal delayMs={delayMs}>
      <div
        className="tanyopo-card-sheen relative flex h-full flex-col gap-1.5 overflow-hidden rounded-xl border border-white/10 p-2.5 shadow-[0_12px_32px_-12px_rgba(15,23,60,0.6)] transition-transform duration-300 hover:-translate-y-1 active:scale-[0.98] lg:gap-2 lg:rounded-2xl lg:p-3 xl:p-3.5"
        style={{
          background: `${CARD_BG}, linear-gradient(90deg, transparent 0%, rgba(103,232,249,0.3) 50%, transparent 100%)`,
          backgroundBlendMode: "normal, overlay",
        }}
      >
        <span className="flex size-7 items-center justify-center rounded-full text-white lg:size-8" style={{ background: ICON_BADGE_BG }}>
          <Icon className="size-3.5 lg:size-4" aria-hidden />
        </span>
        <div className="flex items-center gap-1.5 lg:gap-2">
          <NumberBadge n={number} />
          <p className="text-xs font-bold text-white lg:text-sm">{title}</p>
        </div>
        <p className="text-[11px] leading-snug text-white/65 lg:text-xs lg:leading-relaxed">{description}</p>
      </div>
    </Reveal>
  );
}

function AiCore() {
  return (
    <Reveal className="tanyopo-core-reveal relative mx-auto flex shrink-0">
      <div
        aria-hidden
        className="marketing-glow-pulse pointer-events-none absolute inset-[-2.5rem] -z-10 rounded-full blur-2xl"
        style={{ background: "radial-gradient(circle, rgba(59,99,251,0.55) 0%, rgba(139,92,246,0.4) 55%, transparent 75%)" }}
      />
      <div
        className="flex size-56 flex-col items-center justify-center gap-2 rounded-full px-6 text-center sm:size-64 lg:size-72"
        style={{
          background: "radial-gradient(circle at 50% 35%, #4c56d6 0%, #2c2f8f 45%, #181a54 75%, #10112f 100%)",
          boxShadow:
            "0 0 0 3px rgba(255,255,255,0.9), 0 0 0 8px rgba(103,232,249,0.25), 0 0 60px 10px rgba(59,99,251,0.65), 0 0 130px 36px rgba(139,92,246,0.35)",
        }}
      >
        <Brain className="size-9 text-violet-200 sm:size-10 lg:size-11" strokeWidth={1.5} aria-hidden />
        <p className="text-lg font-bold leading-tight text-white sm:text-xl lg:text-2xl">
          Tanyopo
          <br />
          Intelligence
        </p>
        <p className="max-w-[13rem] text-xs leading-relaxed text-blue-100/80 sm:max-w-[14rem] sm:text-sm">
          Menganalisis, menyusun strategi, dan menggerakkan seluruh proses pemasaran dengan AI.
        </p>
      </div>
    </Reveal>
  );
}

/** Desktop-only animated SVG overlay: curved neon connectors from Produk
 * to the core, the core to Growth, and the core fanning down to each of
 * the six capability cards. Positioned with a percentage-based viewBox
 * (preserveAspectRatio="none") so it stretches to the diagram's own box
 * — purely decorative, so minor stretch at unusual widths is acceptable. */
function ConnectorOverlay() {
  // Six evenly-spaced endpoints matching the capability grid's actual
  // column centers (grid-cols-6, no horizontal padding, viewBox width
  // 1200 -> centers at 1/12, 3/12, 5/12, 7/12, 9/12, 11/12 of the width).
  const fanPaths = [
    "M600,330 C420,410 220,470 100,520",
    "M600,330 C480,420 380,480 300,520",
    "M600,330 C550,430 530,485 500,520",
    "M600,330 C650,430 670,485 700,520",
    "M600,330 C720,420 820,480 900,520",
    "M600,330 C780,410 980,470 1100,520",
  ];

  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 hidden size-full lg:block"
      viewBox="0 0 1200 700"
      preserveAspectRatio="none"
      fill="none"
    >
      <defs>
        <linearGradient id="tanyopo-flow-h" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
        <linearGradient id="tanyopo-flow-fan" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#67e8f9" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
        <marker id="tanyopo-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#ffffff" />
        </marker>
        <filter id="tanyopo-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Solid glowing base underneath each dashed path — keeps the line
          fully, brightly visible at all times, like a lit neon tube; the
          dashed layer on top supplies the moving "data flow" highlight. */}
      <path d="M260,175 C340,175 380,220 465,255" stroke="url(#tanyopo-flow-h)" strokeWidth="3.5" strokeLinecap="round" filter="url(#tanyopo-glow)" opacity="0.9" />
      <path
        d="M260,175 C340,175 380,220 465,255"
        stroke="#ffffff"
        strokeWidth="4"
        strokeLinecap="round"
        markerEnd="url(#tanyopo-arrow)"
        className="tanyopo-connector-path"
        opacity="0.9"
      />
      <path d="M735,255 C820,220 860,175 940,175" stroke="url(#tanyopo-flow-h)" strokeWidth="3.5" strokeLinecap="round" filter="url(#tanyopo-glow)" opacity="0.9" />
      <path
        d="M735,255 C820,220 860,175 940,175"
        stroke="#ffffff"
        strokeWidth="4"
        strokeLinecap="round"
        markerEnd="url(#tanyopo-arrow)"
        className="tanyopo-connector-path"
        opacity="0.9"
      />

      {fanPaths.map((d) => (
        <path key={`${d}-base`} d={d} stroke="url(#tanyopo-flow-fan)" strokeWidth="2.25" strokeLinecap="round" filter="url(#tanyopo-glow)" opacity="0.75" />
      ))}
      {fanPaths.map((d, i) => (
        <path
          key={d}
          d={d}
          stroke="#e0f2fe"
          strokeWidth="2"
          strokeLinecap="round"
          className="tanyopo-connector-path"
          opacity="0.85"
          style={{ animationDelay: `${i * 180}ms` }}
        />
      ))}
    </svg>
  );
}

function MobileConnector({ toGreen }: { toGreen?: boolean }) {
  return (
    <div
      aria-hidden
      className="marketing-line-flow h-8 w-1 shrink-0 rounded-full shadow-[0_0_14px_-2px_rgba(139,92,246,0.55)] sm:h-10"
      style={{
        background: toGreen
          ? "linear-gradient(180deg, #8b5cf6 0%, #22c55e 100%)"
          : "linear-gradient(180deg, #22d3ee 0%, #3b82f6 45%, #8b5cf6 100%)",
      }}
    />
  );
}

export function TanyopoIntelligenceDiagram() {
  return (
    <div className="relative mx-auto max-w-6xl">
      {/* Desktop — Produk (left) -> AI Core (center) -> Growth (right), fan-out to capability grid below */}
      <div className="relative hidden lg:block">
        <ConnectorOverlay />
        <div className="relative z-10 flex items-center justify-between gap-6 px-4 xl:px-10">
          <Reveal><EndpointCard number={1} icon={Package} label="Produk Anda" description="Masukkan produk atau jasa Anda. LINOE memahami bisnis Anda secara mendalam." /></Reveal>
          <AiCore />
          <Reveal><EndpointCard number={8} icon={TrendingUp} label="Pertumbuhan Bisnis" description="Lebih banyak pelanggan, penjualan meningkat, bisnis melaju lebih jauh." /></Reveal>
        </div>
        <div className="relative z-10 mt-14 grid grid-cols-6 gap-3 xl:gap-4">
          {CAPABILITIES.map((item, i) => (
            <CapabilityCard key={item.title} number={i + 2} icon={item.icon} title={item.title} description={item.description} delayMs={i * 90} />
          ))}
        </div>
      </div>

      {/* Mobile / tablet — vertical flow: Produk -> Core -> capability cards -> Growth */}
      <div className="flex flex-col items-center gap-4 lg:hidden">
        <Reveal className="w-full max-w-sm"><EndpointCard number={1} icon={Package} label="Produk Anda" description="Masukkan produk atau jasa Anda. LINOE memahami bisnis Anda secara mendalam." /></Reveal>
        <MobileConnector />
        <AiCore />
        <MobileConnector />
        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
          {CAPABILITIES.map((item, i) => (
            <CapabilityCard key={item.title} number={i + 2} icon={item.icon} title={item.title} description={item.description} delayMs={i * 90} />
          ))}
        </div>
        <MobileConnector toGreen />
        <Reveal className="w-full max-w-sm"><EndpointCard number={8} icon={TrendingUp} label="Pertumbuhan Bisnis" description="Lebih banyak pelanggan, penjualan meningkat, bisnis melaju lebih jauh." /></Reveal>
      </div>
    </div>
  );
}
