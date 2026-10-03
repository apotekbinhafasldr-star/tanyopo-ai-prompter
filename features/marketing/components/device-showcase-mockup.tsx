import { BarChart3, MousePointerClick, Percent, Target } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * Stylized, non-screenshot device mockup for the "Device Showcase"
 * marketing section (features/marketing/sections/device-showcase.tsx).
 *
 * Explicitly NOT a screenshot of the real app and NOT a claim about any
 * specific screen or feature — the repo has no existing dashboard
 * screenshot asset to reuse (checked public/, app/, features/), so per
 * the founder's own guardrail ("Do NOT invent fake product
 * functionality... this is only a MARKETING VISUAL / DEVICE MOCKUP"),
 * this draws a generic, clearly illustrative dashboard silhouette
 * (header bar + a small metric grid + a bar-chart strip) using only the
 * metric *names* already established elsewhere in this codebase for
 * this exact product (ROAS / Konversi / CTR / Growth Trend, the same
 * four used by features/marketing/sections/analytics-showcase.tsx) —
 * no invented numbers are presented as real data, no specific UI is
 * depicted as an accurate reproduction of any real screen. Built with
 * plain CSS/divs, consistent with how tanyopo-intelligence-diagram.tsx
 * already builds custom marketing visuals in this codebase rather than
 * importing images.
 */
const MINI_STATS = [
  { icon: Target, label: "ROAS", bar: 72 },
  { icon: MousePointerClick, label: "Konversi", bar: 58 },
  { icon: Percent, label: "CTR", bar: 45 },
  { icon: BarChart3, label: "Growth", bar: 83 },
];

const TREND_BARS = [32, 48, 40, 60, 52, 70, 64, 82];

function MiniDashboardScreen({ compact }: { compact: boolean }) {
  return (
    <div className={cn("rounded-lg bg-surface", compact ? "p-2.5" : "p-3 sm:p-4")}>
      <div className={cn("grid gap-2", compact ? "grid-cols-1" : "grid-cols-2 sm:gap-3")}>
        {MINI_STATS.map((stat) => (
          <div
            key={stat.label}
            className={cn(
              "flex items-center gap-2 rounded-md border border-border bg-surface-muted/60",
              compact ? "px-2 py-1.5" : "px-2.5 py-2",
            )}
          >
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-muted text-brand">
              <stat.icon className="size-3" aria-hidden />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className={cn("truncate font-medium text-foreground", compact ? "text-[9px]" : "text-[10px]")}>
                {stat.label}
              </span>
              <div className="h-1 w-full overflow-hidden rounded-full bg-border">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-brand to-brand-2"
                  style={{ width: `${stat.bar}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className={cn("mt-2.5 flex items-end gap-1", compact ? "h-8" : "h-12 sm:h-14")}>
        {TREND_BARS.map((h, i) => (
          <span
            key={i}
            aria-hidden
            className="flex-1 rounded-sm bg-gradient-to-t from-brand to-brand-2/70 opacity-80"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
    </div>
  );
}

function ScreenHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 pb-2 pt-2">
      <span aria-hidden className="size-2 rounded-full bg-red-400/70" />
      <span aria-hidden className="size-2 rounded-full bg-amber-400/70" />
      <span aria-hidden className="size-2 rounded-full bg-emerald-400/70" />
      <span className="ml-1.5 truncate text-[9px] font-medium text-white/60">{label}</span>
    </div>
  );
}

/** Laptop frame — the large device on the left of the showcase. Pure CSS/divs, no image asset. */
function LaptopMockup() {
  return (
    <div className="mx-auto w-full max-w-[420px]">
      <div
        className="overflow-hidden rounded-xl border border-black/10 bg-[#0b0b12] p-1.5 shadow-[var(--shadow-lg)] sm:p-2"
        style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.04) inset, var(--shadow-lg)" }}
      >
        <ScreenHeader label="LINOE Dashboard" />
        <MiniDashboardScreen compact={false} />
      </div>
      {/* laptop base */}
      <div aria-hidden className="mx-auto h-2.5 w-[72%] rounded-b-lg bg-[#0b0b12]" />
      <div aria-hidden className="mx-auto h-1 w-[92%] rounded-full bg-[#0b0b12]/60" />
    </div>
  );
}

/** Phone frame — layered in front of the laptop to show the responsive view. Pure CSS/divs, no image asset. */
function PhoneMockup() {
  return (
    <div className="w-full max-w-[150px] sm:max-w-[170px]">
      <div
        className="overflow-hidden rounded-[1.4rem] border-[3px] border-[#0b0b12] bg-[#0b0b12] shadow-[var(--shadow-lg)]"
        style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.04) inset, var(--shadow-lg)" }}
      >
        <ScreenHeader label="LINOE" />
        <MiniDashboardScreen compact />
      </div>
    </div>
  );
}

/**
 * The full device stack: laptop on the left/behind, phone overlapping
 * the bottom-right corner in front — the composition the founder asked
 * for ("large desktop/laptop/dashboard mockup" with "smartphone mockup"
 * "overlay/in front"). Responsive by construction (percentage widths,
 * `mx-auto`, no fixed pixel container wider than its parent), so it
 * never causes horizontal overflow on narrow phones.
 */
export function DeviceShowcaseStack() {
  return (
    <div className="relative mx-auto w-full max-w-[460px] pb-8 pr-6 sm:pb-10 sm:pr-8">
      <LaptopMockup />
      <div className="absolute bottom-0 right-0 w-[36%]">
        <PhoneMockup />
      </div>
    </div>
  );
}
