import { Package, Brain, Target, FileText, Megaphone, Search, BarChart3, Settings, TrendingUp, type LucideIcon } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";

/**
 * Tanyopo Intelligence — V9 (visible branching network, third Founder
 * mobile-review round). V8 made the core and every connector bigger and
 * bolder, but kept V7's shape: ONE continuous winding path through all 8
 * stops. Founder's next review explicitly rejected that shape — it still
 * read as a single decorative curve behind the cards, not the core
 * visibly sending/receiving energy to and from every function
 * ("JANGAN hanya satu garis melengkung besar — saya ingin BRANCHING
 * CONNECTIONS"). V9 replaces the winding chain with a real tree on BOTH
 * overlays: a bold TRUNK leaves the core straight into a horizontal
 * SPINE, which BRANCHES directly to every function node — so each one
 * has its own thick, unambiguous wire traceable straight back to the
 * core, not a link inferred through its neighbors. Every wire is also
 * substantially thicker/brighter than V8's already-boosted values, and a
 * glowing junction marker sits at every real connection point (trunk
 * exit, spine takeoffs, every node entry). Mobile's function-node grid
 * changed from one 6-across row to 2 rows x 3 cols (viewBox 380 -> 480)
 * so each branch has real width to read without zooming, and the section
 * is allowed to grow taller for it, per Founder's explicit "boleh lebih
 * tinggi, lebih baik besar dan jelas daripada padat dan kecil."
 *
 * Desktop: Produk (input) left / AI Core center / Growth (output) right;
 * ConnectorOverlay's trunk+spine fans out from the core to all 6
 * capability cards below it, plus the Produk-in / Growth-out edges.
 *
 * Mobile: Produk and Growth stay simple full-width stops linked by a
 * short glowing connector; MobileFlowOverlay's trunk+spine+branches fan
 * out from the core to the 2x3 function-node grid. Both endpoint cards
 * carry an explicit "Input" / "Output · Hasil Akhir" tag so their role in
 * the flow doesn't depend on position alone.
 *
 * Every connector (desktop and mobile) layers a blurred bloom halo, a
 * solid saturated core stroke with a subtle electric flicker, a bright
 * traveling dash, and a small particle that physically travels the path
 * via native SVG animateMotion/mpath.
 *
 * Every capability listed is something LINOE already does today — nothing
 * invented (product spec §3/§7). Every animation is CSS transform/opacity/
 * background-position/box-shadow/SVG stroke-dashoffset only (see the
 * `tanyopo-*`/`marketing-*` utility classes in app/globals.css), no
 * canvas/WebGL/animation library, and all disabled under
 * prefers-reduced-motion.
 */
const CAPABILITIES: { icon: LucideIcon; title: string; shortLabel: string; description: string }[] = [
  { icon: Target, title: "Strategi Marketing", shortLabel: "Strategi", description: "AI menyusun strategi sesuai target pasar dan tujuan bisnis Anda." },
  { icon: FileText, title: "Konten & Copywriting", shortLabel: "Konten", description: "Membuat ide, headline, caption, dan creative yang menarik." },
  { icon: Megaphone, title: "Campaign", shortLabel: "Campaign", description: "Menentukan channel, audiens, budget, dan eksekusi kampanye." },
  { icon: Search, title: "SEO & Discovery", shortLabel: "SEO", description: "Meningkatkan visibilitas di Google dan platform lainnya." },
  { icon: BarChart3, title: "Analitik", shortLabel: "Analitik", description: "Memantau hasil dan performa secara real-time." },
  { icon: Settings, title: "Optimasi", shortLabel: "Optimasi", description: "Memberikan rekomendasi otomatis untuk hasil lebih baik." },
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
      className="tanyopo-node-pulse tanyopo-card-sheen relative flex w-full max-w-xs items-start gap-3 overflow-hidden rounded-2xl border border-white/10 p-4 sm:p-5 desktop:max-w-[15rem]"
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
        {accent === "end" ? (
          <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300/90">
            Output &middot; Hasil Akhir
          </p>
        ) : (
          <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-300/90">Input</p>
        )}
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
        className="tanyopo-node-pulse tanyopo-card-sheen relative flex h-full flex-col gap-1.5 overflow-hidden rounded-xl border border-white/10 p-2.5 transition-transform duration-300 hover:-translate-y-1 active:scale-[0.98] desktop:gap-2 desktop:rounded-2xl desktop:p-3 xl:p-3.5"
        style={{
          background: `${CARD_BG}, linear-gradient(90deg, transparent 0%, rgba(103,232,249,0.3) 50%, transparent 100%)`,
          backgroundBlendMode: "normal, overlay",
          animationDelay: `${pulseDelayMs}ms`,
        }}
      >
        <span className="flex size-7 items-center justify-center rounded-full text-white desktop:size-8" style={{ background: ICON_BADGE_BG }}>
          <Icon className="size-3.5 desktop:size-4" aria-hidden />
        </span>
        <div className="flex items-center gap-1.5 desktop:gap-2">
          <NumberBadge n={number} />
          <p className="text-xs font-bold text-white desktop:text-sm">{title}</p>
        </div>
        <p className="text-[11px] leading-snug text-white/65 desktop:text-xs desktop:leading-relaxed">{description}</p>
      </div>
    </Reveal>
  );
}

/** Compact mobile function node — sits in a 2-row x 3-col grid below the
 * core (see MobileFlowOverlay's docblock for why: a single 6-across row
 * left too little width per branch line to read as a real connection, so
 * V9 gives the network two rows of open vertical room instead). */
function MobileFunctionNode({
  number,
  icon: Icon,
  label,
  revealDelayMs,
  pulseDelayMs,
}: {
  number: number;
  icon: LucideIcon;
  label: string;
  revealDelayMs: number;
  pulseDelayMs: number;
}) {
  return (
    <Reveal delayMs={revealDelayMs} className="flex flex-col items-center gap-1.5">
      <span
        className="tanyopo-node-pulse relative flex size-14 items-center justify-center rounded-full text-white"
        style={{ background: ICON_BADGE_BG, animationDelay: `${pulseDelayMs}ms` }}
      >
        <Icon className="size-6" aria-hidden />
        <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full border border-cyan-300/60 bg-[#0c1631] text-[9px] font-bold text-cyan-300">
          {number}
        </span>
      </span>
      <p className="max-w-20 text-center text-[11px] font-semibold leading-tight text-white/85">{label}</p>
    </Reveal>
  );
}

/** Short glowing connector between two stacked mobile stops (Produk->Core,
 * cluster->Growth) — a thicker, brighter, particle-carrying replacement for
 * a plain line, reusing the same tanyopo-spine/-particle treatment. */
function EnergyConnector() {
  return (
    <div aria-hidden className="relative h-12 w-4 shrink-0">
      <div className="tanyopo-spine absolute inset-0 rounded-full" />
      <div className="tanyopo-spine-particle absolute left-1/2 size-4 -translate-x-1/2 rounded-full" />
    </div>
  );
}

/** Mobile-only flow overlay — V9 (visible branching network, second
 * Founder mobile-review round). V7/V8's single chained path (Core ->
 * Strategi -> Konten -> ... -> Optimasi) was architecturally connected but
 * Founder's follow-up review found it still read as one thin decorative
 * line behind the cards, not a network the core is visibly sending energy
 * through to EVERY node. V9 replaces the single winding chain with a real
 * tree: one bold TRUNK leaves the core, feeds a horizontal SPINE, which
 * BRANCHES directly down to Strategi/Konten/Campaign (row 1), and each of
 * those continues straight down to SEO/Analitik/Optimasi (row 2) — so
 * every node has its own thick, unambiguous line traceable straight back
 * to the core, exactly the "branching connections, not one big curve"
 * Founder asked for. The function-node grid below is now 2 rows x 3 cols
 * (see MobileFunctionNode/TanyopoIntelligenceDiagram) instead of one
 * 6-across row, so each branch has real width to read clearly without
 * zooming, and the section is allowed to grow taller for it (viewBox
 * height 380 -> 480).
 *
 * Same three-layer technique as the desktop ConnectorOverlay (blurred halo
 * behind a solid core stroke, bright traveling dash, and a
 * physically-moving particle via animateMotion), plus glowing junction
 * markers at every branch point and node entry, with its own
 * uniquely-prefixed def ids since both overlays exist in the DOM at once
 * (one hidden via CSS, not unmounted) and duplicate SVG ids would let
 * `url(#id)` references resolve to the wrong tree. */
function MobileFlowOverlay() {
  // Column centers for the 2x3 node grid (evenly spaced across the
  // 360-wide viewBox), and the two row y-levels.
  const COLS = [60, 180, 300];
  const SPINE_Y = 300;
  const ROW1_Y = 355;
  const ROW2_Y = 445;

  const segments = [
    // Trunk: the core's own single output, leaving straight down into the
    // spine — the thickest, boldest wire, since every branch traces back
    // through this one line to the core.
    { d: `M180,250 L180,${SPINE_Y}`, tier: "trunk" as const },
    // Spine: the horizontal distribution wire the trunk feeds into.
    { d: `M${COLS[0]},${SPINE_Y} L${COLS[2]},${SPINE_Y}`, tier: "spine" as const },
    // Row 1 branches: spine -> Strategi / Konten / Campaign.
    ...COLS.map((x) => ({ d: `M${x},${SPINE_Y} L${x},${ROW1_Y}`, tier: "branch" as const })),
    // Row 2 verticals: each row-1 node continues straight down to its
    // row-2 partner (Strategi->SEO, Konten->Analitik, Campaign->Optimasi),
    // so the network keeps reading as one connected system, not two
    // separate unrelated rows.
    ...COLS.map((x) => ({ d: `M${x},${ROW1_Y} L${x},${ROW2_Y}`, tier: "branch" as const })),
  ];

  // A glowing marker at every real connection point: the core's exit, the
  // spine's two ends plus its three branch takeoffs, and every node entry
  // in both rows.
  const junctions = [
    { x: 180, y: 250, r: 7 }, // leaves the core
    { x: COLS[0], y: SPINE_Y, r: 5 },
    { x: COLS[1], y: SPINE_Y, r: 5 },
    { x: COLS[2], y: SPINE_Y, r: 5 },
    ...COLS.map((x) => ({ x, y: ROW1_Y, r: 5 })),
    ...COLS.map((x) => ({ x, y: ROW2_Y, r: 5 })),
  ];

  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 360 480" preserveAspectRatio="none" fill="none">
      <defs>
        <linearGradient id="tanyopo-m-flow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#06b6d4" />
          <stop offset="50%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
        <radialGradient id="tanyopo-m-particle-fill" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="60%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#a5f3fc" stopOpacity="0" />
        </radialGradient>
        <filter id="tanyopo-m-halo" x="-140%" y="-140%" width="380%" height="380%">
          <feGaussianBlur stdDeviation="11" />
        </filter>
        <filter id="tanyopo-m-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="4.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {segments.map((seg, i) => {
        const id = `tanyopo-m-seg-${i}`;
        const haloWidth = seg.tier === "trunk" ? 26 : seg.tier === "spine" ? 22 : 18;
        const coreWidth = seg.tier === "trunk" ? 10 : seg.tier === "spine" ? 8.5 : 7;
        const dashWidth = seg.tier === "trunk" ? 5 : 4;
        const particleR = seg.tier === "trunk" ? 8.5 : 7;
        return (
          <g key={id}>
            <path d={seg.d} stroke="url(#tanyopo-m-flow)" strokeWidth={haloWidth} strokeLinecap="round" filter="url(#tanyopo-m-halo)" opacity="0.85" />
            <path
              d={seg.d}
              stroke="url(#tanyopo-m-flow)"
              strokeWidth={coreWidth}
              strokeLinecap="round"
              opacity="1"
              className="tanyopo-connector-glow"
              style={{ animationDelay: `${i * 200}ms` }}
            />
            <path
              id={id}
              d={seg.d}
              stroke="#ffffff"
              strokeWidth={dashWidth}
              strokeLinecap="round"
              className="tanyopo-connector-path"
              opacity="1"
              style={{ animationDelay: `${stopDelay(i + 1)}ms` }}
            />
            <circle r={particleR} className="tanyopo-energy-particle" fill="url(#tanyopo-m-particle-fill)" filter="url(#tanyopo-m-glow)">
              <animateMotion dur="1.4s" repeatCount="indefinite" begin={`${i * 0.18}s`}>
                <mpath href={`#${id}`} />
              </animateMotion>
            </circle>
          </g>
        );
      })}

      {junctions.map((j, i) => (
        <g key={`tanyopo-m-junction-${i}`}>
          <circle cx={j.x} cy={j.y} r={j.r + 6} fill="url(#tanyopo-m-particle-fill)" filter="url(#tanyopo-m-glow)" opacity="0.6" />
          <circle
            cx={j.x}
            cy={j.y}
            r={j.r}
            fill="#ffffff"
            className="tanyopo-connector-glow"
            style={{ animationDelay: `${i * 200}ms` }}
          />
        </g>
      ))}
    </svg>
  );
}

function AiCore() {
  return (
    <Reveal className="tanyopo-core-reveal relative z-10 mx-auto flex shrink-0">
      <div
        aria-hidden
        className="marketing-glow-pulse pointer-events-none absolute inset-[-3.5rem] -z-10 rounded-full blur-3xl sm:inset-[-4.5rem]"
        style={{ background: "radial-gradient(circle, rgba(59,99,251,0.65) 0%, rgba(139,92,246,0.48) 50%, transparent 75%)" }}
      />
      <div
        className="relative flex size-72 flex-col items-center justify-center gap-2.5 rounded-full px-7 text-center sm:size-80 desktop:size-96"
        style={{
          background: "radial-gradient(circle at 50% 35%, #545fe8 0%, #2c2f8f 45%, #181a54 75%, #10112f 100%)",
          boxShadow:
            "0 0 0 3px rgba(255,255,255,0.95), 0 0 0 10px rgba(103,232,249,0.32), 0 0 90px 18px rgba(59,99,251,0.75), 0 0 180px 50px rgba(139,92,246,0.42)",
        }}
      >
        <span aria-hidden className="tanyopo-core-ring pointer-events-none absolute inset-[-14px] rounded-full" style={{ animationDelay: "0ms" }} />
        <span aria-hidden className="tanyopo-core-ring pointer-events-none absolute inset-[-14px] rounded-full" style={{ animationDelay: "1000ms" }} />
        <span aria-hidden className="tanyopo-core-ring pointer-events-none absolute inset-[-14px] rounded-full" style={{ animationDelay: "2000ms" }} />
        <Brain className="size-11 text-violet-200 sm:size-12 desktop:size-14" strokeWidth={1.5} aria-hidden />
        <p className="text-xl font-bold leading-tight text-white sm:text-2xl desktop:text-3xl">
          Tanyopo
          <br />
          Intelligence
        </p>
        <p className="max-w-[15rem] text-xs leading-relaxed text-blue-100/80 sm:max-w-[17rem] sm:text-sm desktop:max-w-[19rem] desktop:text-base">
          Otak pusat yang menganalisis, menyusun strategi, dan menggerakkan seluruh proses pemasaran dengan AI.
        </p>
      </div>
    </Reveal>
  );
}

/** Desktop-only animated "AI energy flow" overlay — V9 (visible branching
 * network, second Founder mobile-review round). V7/V8 drew ONE continuous
 * winding chain through all 8 stops; Founder's follow-up review explicitly
 * rejected that shape ("JANGAN hanya membuat satu garis melengkung besar
 * di belakang semua card — saya ingin BRANCHING CONNECTIONS") because it
 * still read as a single decorative curve rather than the core visibly
 * sending energy to every function. V9 replaces it with a real tree: a
 * bold TRUNK leaves the core straight down into a horizontal SPINE, which
 * BRANCHES directly to each of the 6 capability cards below (matching
 * their grid-cols-6 column x-positions) — so every card has its own thick
 * line traceable straight back to the core — plus the existing Produk-in /
 * Growth-out edges on either side of the core. Each wire layers three
 * things: a thick glowing gradient halo with a subtle electric flicker
 * (tanyopo-connector-glow), a bright traveling dash highlight
 * (tanyopo-connector-path), and a small glowing particle that physically
 * travels along the path (native SVG animateMotion/mpath — no JS animation
 * loop, GPU-friendly), plus a glowing junction marker at every real
 * connection point. Positioned with a percentage-based viewBox
 * (preserveAspectRatio="none") so it stretches to the diagram's own box —
 * purely decorative, so minor stretch at unusual widths is acceptable. */
function ConnectorOverlay() {
  // Capability card centers (matching the grid-cols-6 column midpoints).
  const CARD_XS = [100, 300, 500, 700, 900, 1100];
  const ROW_Y = 520;
  const SPINE_Y = 455;

  const segments = [
    // Produk -> Core: the flow's input edge.
    { d: "M260,175 C340,175 380,225 480,265", tier: "edge" as const },
    // Trunk: the core's single output, straight down into the spine — the
    // one line every branch traces back through to the core.
    { d: `M600,400 L600,${SPINE_Y}`, tier: "trunk" as const },
    // Spine: the horizontal wire the trunk feeds, spanning the full
    // capability row.
    { d: `M${CARD_XS[0]},${SPINE_Y} L${CARD_XS[5]},${SPINE_Y}`, tier: "spine" as const },
    // Branches: spine -> each of the 6 capability cards, direct and equal.
    ...CARD_XS.map((x) => ({ d: `M${x},${SPINE_Y} C ${x},${SPINE_Y + 22} ${x},${SPINE_Y + 40} ${x},${ROW_Y}`, tier: "branch" as const })),
    // Optimasi -> Growth: the flow's output edge (aggregated result).
    { d: "M1100,520 C1170,460 1140,300 940,175", tier: "edge" as const },
  ];

  // Visible "connection point" markers at every real stop the flow visits —
  // Produk's own exit, the core's trunk exit, the spine, all 6 capability
  // cards, and Growth's entry — so the network reads as genuine linked
  // nodes, not a line passing behind the cards.
  const junctions = [
    { x: 260, y: 175, r: 8 }, // Produk Anda (input)
    { x: 600, y: 400, r: 8 }, // leaves the core
    ...CARD_XS.map((x) => ({ x, y: ROW_Y, r: 7 })),
    { x: 940, y: 175, r: 8 }, // Pertumbuhan Bisnis (output)
  ];

  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 hidden size-full desktop:block"
      viewBox="0 0 1200 700"
      preserveAspectRatio="none"
      fill="none"
    >
      <defs>
        <linearGradient id="tanyopo-flow-h" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#06b6d4" />
          <stop offset="50%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
        <linearGradient id="tanyopo-flow-fan" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#06b6d4" />
          <stop offset="50%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
        <radialGradient id="tanyopo-particle-fill" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="60%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#a5f3fc" stopOpacity="0" />
        </radialGradient>
        <marker id="tanyopo-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#ffffff" />
        </marker>
        {/* Wide, soft bloom — sits behind the solid core so the wire looks
            like it's radiating light, without blurring the wire itself. */}
        <filter id="tanyopo-halo" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        {/* Tight blur used only on the traveling particle's own glow. */}
        <filter id="tanyopo-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="3.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {segments.map((seg, i) => {
        const id = `tanyopo-seg-${i}`;
        const gradient = seg.tier === "edge" ? "url(#tanyopo-flow-h)" : "url(#tanyopo-flow-fan)";
        const haloWidth = seg.tier === "edge" || seg.tier === "trunk" ? 28 : seg.tier === "spine" ? 24 : 20;
        const coreWidth = seg.tier === "edge" || seg.tier === "trunk" ? 10 : seg.tier === "spine" ? 8.5 : 7.5;
        const dashWidth = seg.tier === "edge" || seg.tier === "trunk" ? 5 : 4.2;
        const particleR = seg.tier === "edge" || seg.tier === "trunk" ? 10 : 8.5;
        return (
          <g key={id}>
            {/* Soft bloom halo — solid color, wide, blurred, always on. */}
            <path d={seg.d} stroke={gradient} strokeWidth={haloWidth} strokeLinecap="round" filter="url(#tanyopo-halo)" opacity="0.85" />
            {/* Solid saturated core — the wire itself, crisp, never faint. */}
            <path
              d={seg.d}
              stroke={gradient}
              strokeWidth={coreWidth}
              strokeLinecap="round"
              opacity="1"
              className="tanyopo-connector-glow"
              style={{ animationDelay: `${i * 200}ms` }}
            />
            {/* Bright dashed highlight traveling along the core. */}
            <path
              id={id}
              d={seg.d}
              stroke="#ffffff"
              strokeWidth={dashWidth}
              strokeLinecap="round"
              markerEnd={seg.tier === "edge" ? "url(#tanyopo-arrow)" : undefined}
              className="tanyopo-connector-path"
              opacity="1"
              style={{ animationDelay: `${stopDelay(i)}ms` }}
            />
            {/* Traveling energy particle — the clearest "it's moving" cue. */}
            <circle r={particleR} className="tanyopo-energy-particle" fill="url(#tanyopo-particle-fill)" filter="url(#tanyopo-glow)">
              <animateMotion dur="1.4s" repeatCount="indefinite" begin={`${i * 0.18}s`}>
                <mpath href={`#${id}`} />
              </animateMotion>
            </circle>
          </g>
        );
      })}

      {junctions.map((j, i) => (
        <g key={`tanyopo-junction-${i}`}>
          <circle cx={j.x} cy={j.y} r={j.r + 7} fill="url(#tanyopo-particle-fill)" filter="url(#tanyopo-glow)" opacity="0.55" />
          <circle cx={j.x} cy={j.y} r={j.r} fill="#ffffff" className="tanyopo-connector-glow" style={{ animationDelay: `${i * 220}ms` }} />
        </g>
      ))}
    </svg>
  );
}

export function TanyopoIntelligenceDiagram() {
  return (
    <div className="relative mx-auto max-w-6xl">
      {/* Desktop — Produk (left) -> AI Core (center, dominant) -> Growth (right),
          with a branching tree (trunk -> spine -> 6 direct branches) fanning
          out from the core to every capability card below it, so each card
          traces straight back to the core rather than through one long
          winding line. */}
      <div className="relative hidden desktop:block">
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

      {/* Mobile / tablet — a real branching energy NETWORK, not a flowchart
          list: Produk and Growth stay simple full-width stops, but the core
          is the visual hub a trunk-and-spine tree (MobileFlowOverlay) fans
          out from, branching directly to each of the six function nodes
          (2 rows x 3 cols below the core), so every node traces straight
          back to the core rather than through one long winding line. */}
      <div className="relative flex flex-col items-center gap-1 desktop:hidden">
        <Reveal className="relative z-10 w-full max-w-sm">
          <EndpointCard number={1} icon={Package} label="Produk Anda" description="Masukkan produk atau jasa Anda. LINOE memahami bisnis Anda secara mendalam." accent="start" delayMs={stopDelay(0)} />
        </Reveal>
        <EnergyConnector />
        <div className="relative w-full max-w-sm">
          <MobileFlowOverlay />
          <AiCore />
          {/* 2 rows x 3 cols (not one 6-across row) — see MobileFlowOverlay's
              docblock: this gives each branch line real width to read
              clearly without zooming, and lets the section grow taller
              instead of cramming everything into one viewport-width row. */}
          <div className="relative z-10 mt-7 grid grid-cols-3 items-start justify-items-center gap-x-3 gap-y-11 px-1">
            {CAPABILITIES.map((item, i) => (
              <MobileFunctionNode
                key={item.title}
                number={i + 2}
                icon={item.icon}
                label={item.shortLabel}
                revealDelayMs={i * 90}
                pulseDelayMs={stopDelay(i + 1)}
              />
            ))}
          </div>
        </div>
        <EnergyConnector />
        <Reveal className="relative z-10 w-full max-w-sm">
          <EndpointCard number={8} icon={TrendingUp} label="Pertumbuhan Bisnis" description="Lebih banyak pelanggan, penjualan meningkat, bisnis melaju lebih jauh." accent="end" delayMs={stopDelay(7)} />
        </Reveal>
      </div>
    </div>
  );
}
