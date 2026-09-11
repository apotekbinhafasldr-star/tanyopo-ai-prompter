import { Package, Brain, Target, FileText, Megaphone, Search, BarChart3, Settings, TrendingUp, type LucideIcon } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";

/**
 * Tanyopo Intelligence — Animated V5. Reworked per founder feedback that V4
 * read as a hub with independent parallel cards rather than "a living AI
 * machine." V5 keeps V4's wide composition (Produk left / AI Core center /
 * Growth right / reference PNG as source of truth for hierarchy) but wires
 * every stop into ONE sequential chain — Produk -> Core -> Strategi ->
 * Konten -> Campaign -> SEO -> Analitik -> Optimasi -> Growth — with a
 * single traveling light animated through all 8 connector segments in
 * order, each node briefly glowing in turn as the "energy" reaches it
 * (marketing-node-pulse), and a more dominant, visibly "alive" core
 * (concentric sonar-style rings, marketing-core-ring). Mobile drops the
 * old stack-of-8-big-cards layout for a compact connected timeline: a
 * single glowing spine running through a large central core with short
 * one-line process rows (FlowStep) attached to it, so the phone view still
 * reads as one diagram, not a long list.
 *
 * Every capability listed is something LINOE already does today — nothing
 * invented (product spec §3/§7). Every animation is CSS transform/opacity/
 * background-position/box-shadow/SVG stroke-dashoffset only (see the
 * `tanyopo-*`/`marketing-*` utility classes in app/globals.css), no
 * canvas/WebGL/animation library, and all disabled under
 * prefers-reduced-motion.
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

// Single shared cycle (ms) for the connector "energy" and the per-node glow
// it triggers, so both stay roughly in step across all 8 stops.
const FLOW_CYCLE_MS = 3500;
const stopDelay = (index: number) => Math.round((index / 8) * FLOW_CYCLE_MS);

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
  accent,
  delayMs,
}: {
  number: number;
  icon: LucideIcon;
  label: string;
  description: string;
  accent: "start" | "end";
  delayMs: number;
}) {
  const accentRing =
    accent === "end"
      ? "0 0 0 1px rgba(74,222,128,0.4), 0 0 28px -6px rgba(34,197,94,0.5), "
      : "0 0 0 1px rgba(103,232,249,0.4), ";
  return (
    <div
      className="tanyopo-node-pulse tanyopo-card-sheen relative flex w-full max-w-xs items-start gap-3 overflow-hidden rounded-2xl border border-white/10 p-4 sm:p-5 lg:max-w-[15rem]"
      style={{
        background: `${CARD_BG}, linear-gradient(90deg, transparent 0%, rgba(103,232,249,0.35) 50%, transparent 100%)`,
        backgroundBlendMode: "normal, overlay",
        boxShadow: `${accentRing}0 12px 32px -12px rgba(15,23,60,0.6)`,
        animationDelay: `${delayMs}ms`,
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
        {accent === "end" ? <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300/90">Hasil akhir</p> : null}
      </div>
    </div>
  );
}

/** Desktop capability card — icon-top layout matching the reference PNG's
 * capability row. Sequential glow (tanyopo-node-pulse) ties it into the
 * same chain timing as every other stop. */
function CapabilityCard({
  number,
  icon: Icon,
  title,
  description,
  revealDelayMs,
  pulseDelayMs,
}: {
  number: number;
  icon: LucideIcon;
  title: string;
  description: string;
  revealDelayMs: number;
  pulseDelayMs: number;
}) {
  return (
    <Reveal delayMs={revealDelayMs}>
      <div
        className="tanyopo-node-pulse tanyopo-card-sheen relative flex h-full flex-col gap-1.5 overflow-hidden rounded-xl border border-white/10 p-2.5 transition-transform duration-300 hover:-translate-y-1 active:scale-[0.98] lg:gap-2 lg:rounded-2xl lg:p-3 xl:p-3.5"
        style={{
          background: `${CARD_BG}, linear-gradient(90deg, transparent 0%, rgba(103,232,249,0.3) 50%, transparent 100%)`,
          backgroundBlendMode: "normal, overlay",
          animationDelay: `${pulseDelayMs}ms`,
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

/** Compact mobile process row — one line, attached to the vertical spine,
 * replacing V4's tall icon-top cards so the phone view reads as a short
 * connected timeline instead of a stack of eight big cards. */
function FlowStep({
  number,
  icon: Icon,
  title,
  description,
  revealDelayMs,
  pulseDelayMs,
}: {
  number: number;
  icon: LucideIcon;
  title: string;
  description: string;
  revealDelayMs: number;
  pulseDelayMs: number;
}) {
  return (
    <Reveal delayMs={revealDelayMs} className="relative z-10">
      <div
        className="tanyopo-node-pulse flex items-center gap-3 rounded-2xl border border-white/10 px-3.5 py-2.5"
        style={{ background: CARD_BG, animationDelay: `${pulseDelayMs}ms` }}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full text-white" style={{ background: ICON_BADGE_BG }}>
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <NumberBadge n={number} />
            <p className="text-[13px] font-bold text-white">{title}</p>
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-white/60">{description}</p>
        </div>
      </div>
    </Reveal>
  );
}

function AiCore() {
  return (
    <Reveal className="tanyopo-core-reveal relative z-10 mx-auto flex shrink-0">
      <div
        aria-hidden
        className="marketing-glow-pulse pointer-events-none absolute inset-[-2.5rem] -z-10 rounded-full blur-2xl"
        style={{ background: "radial-gradient(circle, rgba(59,99,251,0.55) 0%, rgba(139,92,246,0.4) 55%, transparent 75%)" }}
      />
      <div
        className="relative flex size-60 flex-col items-center justify-center gap-2 rounded-full px-6 text-center sm:size-72 lg:size-80"
        style={{
          background: "radial-gradient(circle at 50% 35%, #4c56d6 0%, #2c2f8f 45%, #181a54 75%, #10112f 100%)",
          boxShadow:
            "0 0 0 3px rgba(255,255,255,0.9), 0 0 0 8px rgba(103,232,249,0.25), 0 0 60px 10px rgba(59,99,251,0.65), 0 0 130px 36px rgba(139,92,246,0.35)",
        }}
      >
        <span aria-hidden className="tanyopo-core-ring pointer-events-none absolute inset-[-10px] rounded-full" style={{ animationDelay: "0ms" }} />
        <span aria-hidden className="tanyopo-core-ring pointer-events-none absolute inset-[-10px] rounded-full" style={{ animationDelay: "1000ms" }} />
        <span aria-hidden className="tanyopo-core-ring pointer-events-none absolute inset-[-10px] rounded-full" style={{ animationDelay: "2000ms" }} />
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

/** Desktop-only animated SVG overlay — ONE continuous chain of 8 curved
 * segments (Produk -> Core -> Strategi -> Konten -> Campaign -> SEO ->
 * Analitik -> Optimasi -> Growth), each carrying a bright traveling
 * highlight staggered so the light appears to move down the whole chain
 * in reading order, then loop. Positioned with a percentage-based viewBox
 * (preserveAspectRatio="none") so it stretches to the diagram's own box —
 * purely decorative, so minor stretch at unusual widths is acceptable. */
function ConnectorOverlay() {
  // Chain segments in flow order. The 6 middle segments connect capability
  // card i to card i+1 (centers at x=100/300/500/700/900/1100, matching the
  // grid-cols-6 column midpoints), dipping in a gentle wave between them.
  const chainSegments = [
    "M600,330 C420,410 220,470 100,520",
    "M100,520 C160,565 240,565 300,520",
    "M300,520 C360,565 440,565 500,520",
    "M500,520 C560,565 640,565 700,520",
    "M700,520 C760,565 840,565 900,520",
    "M900,520 C960,565 1040,565 1100,520",
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

      {/* Segment 0: Produk -> Core */}
      <path d="M260,175 C340,175 380,220 465,255" stroke="url(#tanyopo-flow-h)" strokeWidth="3.5" strokeLinecap="round" filter="url(#tanyopo-glow)" opacity="0.9" />
      <path
        d="M260,175 C340,175 380,220 465,255"
        stroke="#ffffff"
        strokeWidth="4"
        strokeLinecap="round"
        markerEnd="url(#tanyopo-arrow)"
        className="tanyopo-connector-path"
        opacity="0.9"
        style={{ animationDelay: `${stopDelay(0)}ms` }}
      />

      {/* Segments 1-6: Core -> Strategi -> Konten -> Campaign -> SEO -> Analitik -> Optimasi */}
      {chainSegments.map((d) => (
        <path key={`${d}-base`} d={d} stroke="url(#tanyopo-flow-fan)" strokeWidth="2.5" strokeLinecap="round" filter="url(#tanyopo-glow)" opacity="0.8" />
      ))}
      {chainSegments.map((d, i) => (
        <path
          key={d}
          d={d}
          stroke="#e0f2fe"
          strokeWidth="2.25"
          strokeLinecap="round"
          className="tanyopo-connector-path"
          opacity="0.9"
          style={{ animationDelay: `${stopDelay(i + 1)}ms` }}
        />
      ))}

      {/* Segment 7: Optimasi -> Growth */}
      <path d="M1100,520 C1170,460 1140,300 940,175" stroke="url(#tanyopo-flow-h)" strokeWidth="3.5" strokeLinecap="round" filter="url(#tanyopo-glow)" opacity="0.9" />
      <path
        d="M1100,520 C1170,460 1140,300 940,175"
        stroke="#ffffff"
        strokeWidth="4"
        strokeLinecap="round"
        markerEnd="url(#tanyopo-arrow)"
        className="tanyopo-connector-path"
        opacity="0.9"
        style={{ animationDelay: `${stopDelay(7)}ms` }}
      />
    </svg>
  );
}

export function TanyopoIntelligenceDiagram() {
  return (
    <div className="relative mx-auto max-w-6xl">
      {/* Desktop — Produk (left) -> AI Core (center, dominant) -> Growth (right),
          one continuous chained path running through the 6-card row below the core. */}
      <div className="relative hidden lg:block">
        <ConnectorOverlay />
        <div className="relative z-10 flex items-center justify-between gap-6 px-4 xl:px-10">
          <Reveal>
            <EndpointCard number={1} icon={Package} label="Produk Anda" description="Masukkan produk atau jasa Anda. LINOE memahami bisnis Anda secara mendalam." accent="start" delayMs={stopDelay(0)} />
          </Reveal>
          <AiCore />
          <Reveal>
            <EndpointCard number={8} icon={TrendingUp} label="Pertumbuhan Bisnis" description="Lebih banyak pelanggan, penjualan meningkat, bisnis melaju lebih jauh." accent="end" delayMs={stopDelay(7)} />
          </Reveal>
        </div>
        <div className="relative z-10 mt-14 grid grid-cols-6 gap-3 xl:gap-4">
          {CAPABILITIES.map((item, i) => (
            <CapabilityCard
              key={item.title}
              number={i + 2}
              icon={item.icon}
              title={item.title}
              description={item.description}
              revealDelayMs={i * 90}
              pulseDelayMs={stopDelay(i + 1)}
            />
          ))}
        </div>
      </div>

      {/* Mobile / tablet — compact connected timeline: one glowing spine running
          through a large central core with short single-line process rows,
          instead of eight tall stacked cards. */}
      <div className="relative flex flex-col items-center gap-3 lg:hidden">
        <div aria-hidden className="tanyopo-spine pointer-events-none absolute left-1/2 top-6 bottom-6 w-1 -translate-x-1/2 rounded-full" />
        <Reveal className="relative z-10 w-full max-w-sm">
          <EndpointCard number={1} icon={Package} label="Produk Anda" description="Masukkan produk atau jasa Anda. LINOE memahami bisnis Anda secara mendalam." accent="start" delayMs={stopDelay(0)} />
        </Reveal>
        <AiCore />
        <div className="relative z-10 flex w-full max-w-sm flex-col gap-2.5">
          {CAPABILITIES.map((item, i) => (
            <FlowStep
              key={item.title}
              number={i + 2}
              icon={item.icon}
              title={item.title}
              description={item.description}
              revealDelayMs={i * 90}
              pulseDelayMs={stopDelay(i + 1)}
            />
          ))}
        </div>
        <Reveal className="relative z-10 w-full max-w-sm">
          <EndpointCard number={8} icon={TrendingUp} label="Pertumbuhan Bisnis" description="Lebih banyak pelanggan, penjualan meningkat, bisnis melaju lebih jauh." accent="end" delayMs={stopDelay(7)} />
        </Reveal>
      </div>
    </div>
  );
}
