import { Package, Brain, Target, FileText, Megaphone, Search, BarChart3, Settings, TrendingUp, type LucideIcon } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";

/**
 * Tanyopo Intelligence — V8 (bigger + more dominant flow, second Founder
 * mobile-review round). V7 fixed the mobile "disconnected cards" complaint
 * by chaining the nodes into one path, but Founder's next review found the
 * result still too similar to the prior version — the core and the flow
 * itself needed to be visibly bigger and more dominant, not just correctly
 * connected. V8 keeps V7's connected-chain architecture and, on top of it:
 * substantially enlarges the AI core (size-72/80/96 vs V7's 60/72/80) and
 * its glow/ring/icon/text; thickens every connector's halo/core/dash/
 * particle on BOTH the desktop ConnectorOverlay and MobileFlowOverlay; and
 * adds explicit glowing "junction" markers at every stop the flow visits
 * (Produk, each of the 6 capability cards, Growth) on both overlays, so the
 * connection reads as real linked nodes rather than a line merely passing
 * behind the cards. Mobile's viewBox also grew taller (330 -> 380) to give
 * the bigger core and its icon row more open vertical room.
 *
 * Desktop: Produk (input) left / AI Core center / Growth (output) right,
 * with ONE continuous chained "energy flow" path running Produk -> Core ->
 * Strategi -> Konten -> Campaign -> SEO -> Analitik -> Optimasi -> Growth
 * (ConnectorOverlay) — the core sits inline in that path, not beside it.
 *
 * Mobile (V6 fixed a stacked-grid complaint but Founder's follow-up phone
 * review found the six function nodes read as disconnected — each only
 * had its own separate spoke back to the core, in parallel, with no line
 * between the functions themselves, so it still looked like "a bunch of
 * standalone cards" rather than one process moving through them in order).
 * V7 replaces that radial six-spoke fan (MobileBranchOverlay) with a single
 * connected chain (MobileFlowOverlay): Core -> Strategi -> Konten ->
 * Campaign -> SEO -> Analitik -> Optimasi, visiting every node in sequence
 * in one open row, so the same left-to-right story the desktop version
 * tells is legible on a phone too. Produk and Growth stay simple
 * full-width stops linked to that chain by a short glowing connector, and
 * both endpoint cards now carry an explicit "Input" / "Output · Hasil
 * Akhir" tag so their role in the flow doesn't depend on position alone.
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

/** Compact mobile function node — a small icon node in a SINGLE open row
 * below the core (not a multi-row grid), so every one of the six branch
 * lines from the core stays in open space, fully visible, rather than
 * disappearing behind an opaque card in a lower row. */
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
    <Reveal delayMs={revealDelayMs} className="flex flex-col items-center gap-1">
      <span
        className="tanyopo-node-pulse relative flex size-11 items-center justify-center rounded-full text-white"
        style={{ background: ICON_BADGE_BG, animationDelay: `${pulseDelayMs}ms` }}
      >
        <Icon className="size-5" aria-hidden />
        <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full border border-cyan-300/60 bg-[#0c1631] text-[8px] font-bold text-cyan-300">
          {number}
        </span>
      </span>
      <p className="max-w-14 text-center text-[10px] font-semibold leading-tight text-white/85">{label}</p>
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

/** Mobile-only flow overlay — ONE continuous connected path: Core ->
 * Strategi -> Konten -> Campaign -> SEO -> Analitik -> Optimasi, visiting
 * every function node in sequence instead of six separate spokes fanning
 * out from the core in parallel. A radial "starburst" (the previous
 * design) reads as six independent, disconnected cards that merely sit
 * near the core; a single chained path reads as what it actually is — one
 * process moving through the core and then through each function in
 * order, the same "Produk -> Intelligence -> Strategi -> Konten ->
 * Campaign -> SEO -> Analitik -> Optimasi -> Growth" flow the desktop
 * version already draws. The core is still the visual origin of the chain
 * (the first, boldest segment leaves the core), so it keeps reading as the
 * hub the whole flow moves through, not just a floating decoration above a
 * row of cards.
 *
 * Same three-layer technique as the desktop ConnectorOverlay (blurred halo
 * behind a solid core stroke, bright traveling dash, and a
 * physically-moving particle via animateMotion), with its own
 * uniquely-prefixed def ids since both overlays exist in the DOM at once
 * (one hidden via CSS, not unmounted) and duplicate SVG ids would let
 * `url(#id)` references resolve to the wrong tree. viewBox is tuned to the
 * core's base size (size-60) plus the icon row below it — purely
 * decorative, so modest stretch at other widths is fine. */
function MobileFlowOverlay() {
  // Point 0 is the core's lower edge; points 1-6 are the six function
  // nodes in their single row (same x positions the row itself lays out
  // to: evenly spaced across the 360-wide viewBox). Each segment gently
  // dips between nodes so the chain reads as a moving current, not a flat
  // ruler line. Viewbox height grew (330 -> 380) to give the now-larger
  // core, and the row below it, more open vertical room — a taller
  // section reads clearer than a cramped one on a phone.
  const segments = [
    { d: "M180,250 C120,285 60,320 30,345", bold: true }, // Core -> Strategi (the boldest wire: this is the core's own output)
    { d: "M30,345 C50,320 70,320 90,345", bold: false }, // Strategi -> Konten
    { d: "M90,345 C110,320 130,320 150,345", bold: false }, // Konten -> Campaign
    { d: "M150,345 C170,320 190,320 210,345", bold: false }, // Campaign -> SEO
    { d: "M210,345 C230,320 250,320 270,345", bold: false }, // SEO -> Analitik
    { d: "M270,345 C290,320 310,320 330,345", bold: false }, // Analitik -> Optimasi
  ];
  // A small glowing marker at every junction the flow actually visits —
  // the core's own exit point plus each of the six function nodes — so
  // the connection reads as real "connection points," not just a line
  // passing behind the cards.
  const junctions = [
    { x: 180, y: 250, r: 5 }, // leaves the core
    { x: 30, y: 345, r: 4 },
    { x: 90, y: 345, r: 4 },
    { x: 150, y: 345, r: 4 },
    { x: 210, y: 345, r: 4 },
    { x: 270, y: 345, r: 4 },
    { x: 330, y: 345, r: 4 },
  ];

  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 360 380" preserveAspectRatio="none" fill="none">
      <defs>
        <linearGradient id="tanyopo-m-flow" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#06b6d4" />
          <stop offset="50%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
        <radialGradient id="tanyopo-m-particle-fill" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="60%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#a5f3fc" stopOpacity="0" />
        </radialGradient>
        <filter id="tanyopo-m-halo" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        <filter id="tanyopo-m-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {segments.map((seg, i) => {
        const id = `tanyopo-m-seg-${i}`;
        const haloWidth = seg.bold ? 20 : 15;
        const coreWidth = seg.bold ? 8 : 6;
        const dashWidth = seg.bold ? 4 : 3;
        const particleR = seg.bold ? 7 : 5.5;
        return (
          <g key={id}>
            <path d={seg.d} stroke="url(#tanyopo-m-flow)" strokeWidth={haloWidth} strokeLinecap="round" filter="url(#tanyopo-m-halo)" opacity="0.8" />
            <path
              d={seg.d}
              stroke="url(#tanyopo-m-flow)"
              strokeWidth={coreWidth}
              strokeLinecap="round"
              opacity="1"
              className="tanyopo-connector-glow"
              style={{ animationDelay: `${i * 220}ms` }}
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
              <animateMotion dur="1.6s" repeatCount="indefinite" begin={`${i * 0.2}s`}>
                <mpath href={`#${id}`} />
              </animateMotion>
            </circle>
          </g>
        );
      })}

      {junctions.map((j, i) => (
        <g key={`tanyopo-m-junction-${i}`}>
          <circle cx={j.x} cy={j.y} r={j.r + 5} fill="url(#tanyopo-m-particle-fill)" filter="url(#tanyopo-m-glow)" opacity="0.55" />
          <circle
            cx={j.x}
            cy={j.y}
            r={j.r}
            fill="#ffffff"
            className="tanyopo-connector-glow"
            style={{ animationDelay: `${i * 220}ms` }}
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

/** Desktop-only animated "AI energy flow" overlay — ONE continuous chain of
 * 8 curved segments (Produk -> Core -> Strategi -> Konten -> Campaign ->
 * SEO -> Analitik -> Optimasi -> Growth). Each segment layers three things:
 * a thick glowing gradient wire with a subtle electric flicker
 * (tanyopo-connector-glow), a bright traveling dash highlight
 * (tanyopo-connector-path, existing), and a small glowing particle that
 * physically travels along the path (native SVG animateMotion/mpath — no
 * JS animation loop, GPU-friendly). Positioned with a percentage-based
 * viewBox (preserveAspectRatio="none") so it stretches to the diagram's
 * own box — purely decorative, so minor stretch at unusual widths is
 * acceptable. */
function ConnectorOverlay() {
  // Flow order. The 6 middle segments connect capability card i to card
  // i+1 (centers at x=100/300/500/700/900/1100, matching the grid-cols-6
  // column midpoints), dipping in a gentle wave between them.
  const segments = [
    { d: "M260,175 C340,175 380,220 465,255", arrow: true },
    { d: "M600,330 C420,410 220,470 100,520", arrow: false },
    { d: "M100,520 C160,565 240,565 300,520", arrow: false },
    { d: "M300,520 C360,565 440,565 500,520", arrow: false },
    { d: "M500,520 C560,565 640,565 700,520", arrow: false },
    { d: "M700,520 C760,565 840,565 900,520", arrow: false },
    { d: "M900,520 C960,565 1040,565 1100,520", arrow: false },
    { d: "M1100,520 C1170,460 1140,300 940,175", arrow: true },
  ];
  // Visible "connection point" markers at every real stop the flow visits —
  // Produk's own exit, each of the six capability cards, and Growth's
  // entry — so the chain reads as genuine linked nodes, not just a line
  // passing behind the cards (same treatment as MobileFlowOverlay's
  // `junctions`, mirrored here for desktop per Founder's brief that the
  // flow must look connected "di SETIAP lini," not mobile-only).
  const junctions = [
    { x: 260, y: 175, r: 7 }, // Produk Anda (input)
    { x: 100, y: 520, r: 6 },
    { x: 300, y: 520, r: 6 },
    { x: 500, y: 520, r: 6 },
    { x: 700, y: 520, r: 6 },
    { x: 900, y: 520, r: 6 },
    { x: 1100, y: 520, r: 6 },
    { x: 940, y: 175, r: 7 }, // Pertumbuhan Bisnis (output)
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
        const gradient = seg.arrow ? "url(#tanyopo-flow-h)" : "url(#tanyopo-flow-fan)";
        const haloWidth = seg.arrow ? 26 : 22;
        const coreWidth = seg.arrow ? 9 : 7.5;
        const dashWidth = seg.arrow ? 4.5 : 4;
        const particleR = seg.arrow ? 9.5 : 8.5;
        return (
          <g key={id}>
            {/* Soft bloom halo — solid color, wide, blurred, always on. */}
            <path d={seg.d} stroke={gradient} strokeWidth={haloWidth} strokeLinecap="round" filter="url(#tanyopo-halo)" opacity="0.8" />
            {/* Solid saturated core — the wire itself, crisp, never faint. */}
            <path
              d={seg.d}
              stroke={gradient}
              strokeWidth={coreWidth}
              strokeLinecap="round"
              opacity="1"
              className="tanyopo-connector-glow"
              style={{ animationDelay: `${i * 220}ms` }}
            />
            {/* Bright dashed highlight traveling along the core. */}
            <path
              id={id}
              d={seg.d}
              stroke="#ffffff"
              strokeWidth={dashWidth}
              strokeLinecap="round"
              markerEnd={seg.arrow ? "url(#tanyopo-arrow)" : undefined}
              className="tanyopo-connector-path"
              opacity="1"
              style={{ animationDelay: `${stopDelay(i)}ms` }}
            />
            {/* Traveling energy particle — the clearest "it's moving" cue. */}
            <circle r={particleR} className="tanyopo-energy-particle" fill="url(#tanyopo-particle-fill)" filter="url(#tanyopo-glow)">
              <animateMotion dur="1.6s" repeatCount="indefinite" begin={`${i * 0.2}s`}>
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
          one continuous chained path running through the 6-card row below the core. */}
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

      {/* Mobile / tablet — a compact energy NETWORK, not a flowchart list:
          Produk and Growth stay simple full-width stops, but the core stays
          the visual hub: a single connected chain (MobileFlowOverlay) leaves
          the core and visits each of the six function nodes in sequence, so
          the section reads as one process moving through the core and then
          through each function in order — not six standalone cards that
          merely sit near the core. */}
      <div className="relative flex flex-col items-center gap-1 desktop:hidden">
        <Reveal className="relative z-10 w-full max-w-sm">
          <EndpointCard number={1} icon={Package} label="Produk Anda" description="Masukkan produk atau jasa Anda. LINOE memahami bisnis Anda secara mendalam." accent="start" delayMs={stopDelay(0)} />
        </Reveal>
        <EnergyConnector />
        <div className="relative w-full max-w-sm">
          <MobileFlowOverlay />
          <AiCore />
          <div className="relative z-10 mt-5 flex items-start justify-between px-1">
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
