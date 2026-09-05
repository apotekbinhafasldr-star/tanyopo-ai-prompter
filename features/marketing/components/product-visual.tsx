import { Package, Brain, Target, FileText, Rocket, Search, BarChart3, Sliders, TrendingUp } from "lucide-react";

const PIPELINE = [
  { icon: Target, label: "Strategy" },
  { icon: FileText, label: "Content" },
  { icon: Rocket, label: "Campaigns" },
  { icon: Search, label: "SEO" },
  { icon: BarChart3, label: "Analytics" },
  { icon: Sliders, label: "Optimization" },
];

/**
 * The "Tanyopo Intelligence" flow visual: Produk -> Tanyopo Intelligence
 * -> six capabilities -> Growth. Capability-based, not numbers — no
 * illustrative metric ever belongs here, since this diagram represents
 * how the system works, not a customer's results (product spec §3/§7).
 * No stock photography, no generic robot imagery: composed entirely from
 * the app's own UI language (cards, icons, gradients already used across
 * the dashboard).
 */
export function ProductVisual() {
  return (
    <div className="relative mx-auto max-w-3xl">
      <div className="rounded-[var(--radius-xl)] border border-border bg-surface/90 p-4 shadow-[var(--shadow-lg)] backdrop-blur sm:p-7">
        {/* window chrome, signals "this is a real product surface" without literal screenshotting */}
        <div className="mb-5 flex items-center gap-1.5 sm:mb-7">
          <span className="size-2.5 rounded-full bg-danger/60" />
          <span className="size-2.5 rounded-full bg-warning/60" />
          <span className="size-2.5 rounded-full bg-success/60" />
          <span className="ml-3 text-[11px] font-medium text-muted-foreground">
            Tanyopo Intelligence — Command Center
          </span>
        </div>

        <div className="flex flex-col items-center gap-3 sm:gap-4">
          <div className="flex items-center gap-2 rounded-full border border-border bg-surface-muted px-3.5 py-1.5 text-xs font-semibold text-foreground sm:text-sm">
            <Package className="size-3.5 text-brand" aria-hidden />
            Produk Anda
          </div>

          <div aria-hidden className="h-6 w-px bg-gradient-to-b from-border to-brand/40 sm:h-8" />

          <div className="marketing-float flex items-center gap-2 rounded-[var(--radius-lg)] border border-brand/20 bg-gradient-to-r from-brand to-brand-2 px-5 py-2.5 text-sm font-semibold text-brand-foreground shadow-[var(--shadow-glow)]">
            <Brain className="size-4" aria-hidden />
            Tanyopo Intelligence
          </div>

          <div aria-hidden className="h-6 w-px bg-gradient-to-b from-brand/40 to-border sm:h-8" />

          <div className="grid w-full grid-cols-3 gap-2 sm:gap-3">
            {PIPELINE.map((item) => (
              <div
                key={item.label}
                className="flex flex-col items-center gap-1.5 rounded-[var(--radius-md)] border border-border bg-surface px-2 py-3 text-center shadow-[var(--shadow-sm)] sm:py-4"
              >
                <item.icon className="size-4 text-brand" aria-hidden />
                <span className="text-[11px] font-medium text-foreground sm:text-xs">{item.label}</span>
              </div>
            ))}
          </div>

          <div aria-hidden className="h-6 w-px bg-gradient-to-b from-border to-success/40 sm:h-8" />

          <div className="flex items-center gap-2 rounded-full border border-success/30 bg-success-muted px-3.5 py-1.5 text-xs font-semibold text-success sm:text-sm">
            <TrendingUp className="size-3.5" aria-hidden />
            Growth
          </div>
        </div>
      </div>
    </div>
  );
}
