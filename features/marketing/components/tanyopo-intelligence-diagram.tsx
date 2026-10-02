import { Package, Brain, Target, FileText, Rocket, Search, BarChart3, Sliders, TrendingUp, type LucideIcon } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";
import { cn } from "@/lib/utils/cn";

/**
 * Batch: Tanyopo Intelligence visual V4 — founder-approved "AI energy
 * network" direction (supersedes V3's left -> core -> right flowchart;
 * V3's own rationale/history is preserved in git log, not in this file
 * anymore). Founder's V4 brief, implemented as a literal hub-and-spoke
 * network rather than a row/column flowchart:
 *   1. Tanyopo Intelligence stays the one dominant, glowing core — now
 *      the actual hub every other node's energy line connects to, not
 *      just a visually-central stop in a left-to-right row.
 *   2. The connecting "energy" lines are large/thick/bright/glowing,
 *      cyan -> electric blue -> violet (violet -> green into Pertumbuhan
 *      Bisnis), rendered as an SVG overlay with a blur-based glow filter
 *      and an animated dash so the flow reads as alive, not a thin
 *      decorative hairline.
 *   3. The six capabilities are wired straight into the core by that same
 *      glowing line system — no bordered "disconnected card" treatment —
 *      so the whole section reads as one luminous network, on mobile
 *      (a tall hub-with-spokes stack) as well as desktop (a wide
 *      hub-with-spokes layout), not a simple top-to-bottom flowchart.
 * Node + SVG-line positions are authored as percentages of each
 * diagram's container (viewBox="0 0 100 100", preserveAspectRatio="none"),
 * so the same coordinates drive both the SVG lines and the absolutely-
 * positioned HTML nodes without any JS measurement, and the layout stays
 * responsive.
 * Capability set/copy and the "no literal 24/7-autonomous claim" rule
 * from tanyopo-intelligence.tsx are both untouched — this is a visual-only
 * change to this one file, per founder's explicit local-only scope.
 */
const CAPABILITIES: { icon: LucideIcon; title: string; description: string }[] = [
  { icon: Target, title: "Strategi Marketing", description: "AI menyusun arah pemasaran sesuai produk dan target pasar." },
  { icon: FileText, title: "Konten & Copywriting", description: "Membantu membuat ide, headline, caption, dan materi pemasaran." },
  { icon: Rocket, title: "Campaign", description: "Menyusun channel, audience, budget, dan eksekusi campaign." },
  { icon: Search, title: "SEO & Discovery", description: "Membantu bisnis lebih mudah ditemukan." },
  { icon: BarChart3, title: "Analitik", description: "Membaca hasil dan performa pemasaran." },
  { icon: Sliders, title: "Optimasi", description: "Memberikan rekomendasi langkah berikutnya." },
];

type Accent = "brand" | "core" | "success";

type NetworkNode = {
  key: string;
  icon: LucideIcon;
  label: string;
  description?: string;
  x: number;
  y: number;
  accent: Accent;
  number: number;
};

/** Small numbered badge marking a node's position in the Produk -> ... -> Growth sequence. */
function NumberBadge({ value, accent }: { value: number; accent: Accent }) {
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

/** One node of the energy network — an endpoint (Produk/Growth) or a capability, floating directly on the glow with no card background, so it reads as part of the network rather than a disconnected tile. */
function NetworkNodeView({ node, size = "md" }: { node: NetworkNode; size?: "md" | "sm" }) {
  const isEndpoint = node.accent !== "core";
  return (
    <div
      className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5 text-center"
      style={{ left: `${node.x}%`, top: `${node.y}%`, width: size === "sm" ? "7.5rem" : "9.5rem" }}
    >
      <div className="relative">
        <div
          className={cn(
            "flex items-center justify-center rounded-full shadow-[0_0_28px_-6px_rgba(59,130,246,0.9)]",
            size === "sm" ? "size-11 sm:size-12" : "size-14 sm:size-16",
            isEndpoint &&
              cn("border bg-surface", node.accent === "brand" ? "border-brand/30 text-brand" : "border-success/30 text-success"),
            !isEndpoint && "text-white",
          )}
          style={isEndpoint ? undefined : { background: "linear-gradient(135deg, #22d3ee 0%, #3b82f6 50%, #8b5cf6 100%)" }}
        >
          <node.icon className={size === "sm" ? "size-5" : "size-6 sm:size-7"} aria-hidden />
        </div>
        <NumberBadge value={node.number} accent={node.accent} />
      </div>
      <span className={cn("font-semibold text-foreground", size === "sm" ? "text-xs sm:text-sm" : "text-sm sm:text-base")}>
        {node.label}
      </span>
      {node.description ? (
        <span className="hidden text-[11px] leading-snug text-muted-foreground sm:block">{node.description}</span>
      ) : null}
    </div>
  );
}

/**
 * The dominant central hub (founder feedback: must be unambiguously the
 * network's single powerful source — "BESAR, dominan, bercahaya"). Every
 * other node's energy line in EnergyLines originates here.
 */
function CoreNodeView({ x, y }: { x: number; y: number }) {
  return (
    <div
      className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3"
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      <div className="relative flex items-center justify-center">
        <div
          aria-hidden
          className="marketing-glow-pulse pointer-events-none absolute inset-0 -z-10 rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(34,211,238,0.75) 0%, rgba(139,92,246,0.7) 55%, transparent 75%)" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-4 -z-10 rounded-full opacity-75 blur-xl"
          style={{ background: "radial-gradient(circle, rgba(99,102,241,0.5) 0%, transparent 70%)" }}
        />
        <div
          className="flex size-32 items-center justify-center rounded-full text-white shadow-[0_0_120px_-8px_rgba(99,102,241,0.9)] ring-4 ring-white/20 sm:size-40 lg:size-52"
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

/**
 * Glowing energy-line overlay — every node gets one line straight back to
 * the core (hub-and-spoke), each a thick glow-filtered gradient stroke
 * with an animated dash so the "arus" reads as alive, not a static
 * hairline. Coordinates are percentages in a 0-100 x 0-100 space
 * (preserveAspectRatio="none"), matching the HTML nodes positioned the
 * same way, so it stretches correctly to any container aspect ratio.
 */
function EnergyLines({ core, nodes, strokeWidth }: { core: { x: number; y: number }; nodes: NetworkNode[]; strokeWidth: number }) {
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
      <defs>
        <linearGradient id="tiEnergyGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="55%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
        <linearGradient id="tiEnergyGradientGrowth" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#22c55e" />
        </linearGradient>
        <filter id="tiEnergyGlow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="2.4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {nodes.map((node) => (
        <line
          key={node.key}
          x1={core.x}
          y1={core.y}
          x2={node.x}
          y2={node.y}
          stroke={node.accent === "success" ? "url(#tiEnergyGradientGrowth)" : "url(#tiEnergyGradient)"}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          filter="url(#tiEnergyGlow)"
          className="ti-energy-line"
        />
      ))}
    </svg>
  );
}

function buildCapabilityNodes(positions: { x: number; y: number }[]): NetworkNode[] {
  return CAPABILITIES.map((cap, i) => ({
    key: cap.title,
    icon: cap.icon,
    label: cap.title,
    description: cap.description,
    x: positions[i].x,
    y: positions[i].y,
    accent: "core" as const,
    number: i + 2,
  }));
}

// Flow sequence: 1 Produk Anda -> hub (Tanyopo Intelligence) -> 2-7
// capabilities (in CAPABILITIES order) -> 8 Pertumbuhan Bisnis. The core
// itself stays unnumbered — it is the hub, not a step.
const PRODUCT_NUMBER = 1;
const GROWTH_NUMBER = CAPABILITIES.length + 2; // 8

const DESKTOP_CORE = { x: 50, y: 50 };
const DESKTOP_CAP_POSITIONS = [
  { x: 26, y: 18 },
  { x: 50, y: 10 },
  { x: 74, y: 18 },
  { x: 26, y: 82 },
  { x: 50, y: 90 },
  { x: 74, y: 82 },
];

const MOBILE_CORE = { x: 50, y: 20 };
const MOBILE_CAP_POSITIONS = [
  { x: 24, y: 38 },
  { x: 76, y: 38 },
  { x: 24, y: 55 },
  { x: 76, y: 55 },
  { x: 24, y: 72 },
  { x: 76, y: 72 },
];

export function TanyopoIntelligenceDiagram() {
  const desktopCapNodes = buildCapabilityNodes(DESKTOP_CAP_POSITIONS);
  const mobileCapNodes = buildCapabilityNodes(MOBILE_CAP_POSITIONS);

  const desktopProduk: NetworkNode = { key: "produk", icon: Package, label: "Produk Anda", x: 6, y: 50, accent: "brand", number: PRODUCT_NUMBER };
  const desktopGrowth: NetworkNode = {
    key: "growth",
    icon: TrendingUp,
    label: "Pertumbuhan Bisnis",
    x: 94,
    y: 50,
    accent: "success",
    number: GROWTH_NUMBER,
  };
  const mobileProduk: NetworkNode = { key: "produk", icon: Package, label: "Produk Anda", x: 50, y: 5, accent: "brand", number: PRODUCT_NUMBER };
  const mobileGrowth: NetworkNode = {
    key: "growth",
    icon: TrendingUp,
    label: "Pertumbuhan Bisnis",
    x: 50,
    y: 92,
    accent: "success",
    number: GROWTH_NUMBER,
  };

  return (
    <div className="relative mx-auto max-w-5xl">
      {/* Animated energy-flow dash — scoped to this component via unique
          class/keyframe names; respects prefers-reduced-motion. */}
      <style>{`
        .ti-energy-line { stroke-dasharray: 6 4; animation: ti-energy-flow 2.4s linear infinite; }
        @keyframes ti-energy-flow { to { stroke-dashoffset: -40; } }
        @media (prefers-reduced-motion: reduce) {
          .ti-energy-line { animation: none; }
        }
      `}</style>
      <Reveal className="w-full">
        {/* Desktop / tablet — wide hub-and-spoke network */}
        <div className="relative hidden h-[460px] w-full lg:block xl:h-[520px]">
          <EnergyLines
            core={DESKTOP_CORE}
            nodes={[desktopProduk, ...desktopCapNodes, desktopGrowth]}
            strokeWidth={5}
          />
          <NetworkNodeView node={desktopProduk} />
          <NetworkNodeView node={desktopGrowth} />
          {desktopCapNodes.map((node) => (
            <NetworkNodeView key={node.key} node={node} size="sm" />
          ))}
          <CoreNodeView x={DESKTOP_CORE.x} y={DESKTOP_CORE.y} />
        </div>

        {/* Mobile / small tablet — tall hub-and-spoke network */}
        <div className="relative h-[720px] w-full sm:h-[760px] lg:hidden">
          <EnergyLines
            core={MOBILE_CORE}
            nodes={[mobileProduk, ...mobileCapNodes, mobileGrowth]}
            strokeWidth={4}
          />
          <NetworkNodeView node={mobileProduk} />
          <NetworkNodeView node={mobileGrowth} />
          {mobileCapNodes.map((node) => (
            <NetworkNodeView key={node.key} node={node} size="sm" />
          ))}
          <CoreNodeView x={MOBILE_CORE.x} y={MOBILE_CORE.y} />
        </div>
      </Reveal>
    </div>
  );
}
