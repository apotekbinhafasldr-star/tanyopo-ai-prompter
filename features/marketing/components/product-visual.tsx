import { Package, Brain, Target, FileText, Rocket, Search, BarChart3, Sliders, TrendingUp } from "lucide-react";

const PIPELINE = [
  { icon: Target, label: "Strategy" },
  { icon: FileText, label: "Content" },
  { icon: Rocket, label: "Campaigns" },
  { icon: Search, label: "SEO" },
  { icon: BarChart3, label: "Analytics" },
  { icon: Sliders, label: "Optimization" },
];

function Sparkline({ points, className }: { points: number[]; className?: string }) {
  const w = 100;
  const h = 32;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${i * step} ${h - ((p - min) / range) * h}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} preserveAspectRatio="none" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MetricCard({
  label,
  value,
  trend,
  points,
  className,
}: {
  label: string;
  value: string;
  trend: string;
  points: number[];
  className?: string;
}) {
  return (
    <div
      className={`flex w-40 flex-col gap-2 rounded-[var(--radius-lg)] border border-border bg-surface/95 p-3.5 shadow-[var(--shadow-lg)] backdrop-blur ${className ?? ""}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        <span className="rounded-full bg-success-muted px-1.5 py-0.5 text-[10px] font-semibold text-success">
          {trend}
        </span>
      </div>
      <span className="text-xl font-semibold tracking-tight text-foreground">{value}</span>
      <Sparkline points={points} className="h-6 w-full text-brand" />
    </div>
  );
}

/**
 * The hero "AI Marketing Command Center" visual. All numbers here are
 * illustrative demo data (labeled "Contoh"), never a real customer's
 * results — see product spec §3/§7. No stock photography, no generic
 * robot imagery: everything is composed from the app's own UI language
 * (cards, icons, gradients already used across the dashboard).
 */
export function ProductVisual() {
  return (
    <div className="relative mx-auto max-w-4xl">
      <div className="rounded-[var(--radius-xl)] border border-border bg-surface/90 p-4 shadow-[var(--shadow-lg)] backdrop-blur sm:p-8">
        {/* window chrome, signals "this is a real product surface" without literal screenshotting */}
        <div className="mb-5 flex items-center gap-1.5 sm:mb-8">
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

      {/* Floating demo metrics — desktop only to keep the mobile composition compact. */}
      <div className="pointer-events-none absolute -left-6 top-10 hidden rotate-[-4deg] lg:block">
        <MetricCard label="ROAS · Contoh" value="4.2x" trend="+18%" points={[2, 2.4, 2.1, 3, 3.4, 3.8, 4.2]} />
      </div>
      <div className="pointer-events-none absolute -right-8 top-24 hidden rotate-[3deg] lg:block">
        <MetricCard label="Konversi · Contoh" value="312" trend="+9%" points={[180, 210, 190, 240, 260, 290, 312]} />
      </div>
      <div className="pointer-events-none absolute -bottom-6 left-1/2 hidden -translate-x-1/2 lg:block">
        <MetricCard label="Revenue · Contoh" value="Rp 84jt" trend="+22%" points={[40, 48, 52, 60, 68, 76, 84]} />
      </div>

      {/* Compact mobile/tablet strip — same demo data, no absolute overflow risk. */}
      <div className="mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 no-scrollbar lg:hidden">
        <div className="snap-start">
          <MetricCard label="ROAS · Contoh" value="4.2x" trend="+18%" points={[2, 2.4, 2.1, 3, 3.4, 3.8, 4.2]} />
        </div>
        <div className="snap-start">
          <MetricCard label="Konversi · Contoh" value="312" trend="+9%" points={[180, 210, 190, 240, 260, 290, 312]} />
        </div>
        <div className="snap-start">
          <MetricCard label="Revenue · Contoh" value="Rp 84jt" trend="+22%" points={[40, 48, 52, 60, 68, 76, 84]} />
        </div>
      </div>
    </div>
  );
}
