import Image from "next/image";
import { Target, FileText, Rocket, BarChart3, Brain } from "lucide-react";

const CAPABILITIES = [
  { icon: Target, label: "Strategi" },
  { icon: FileText, label: "Konten" },
  { icon: Rocket, label: "Campaign" },
  { icon: BarChart3, label: "Analytics" },
];

/**
 * Hero's right-column visual: a human photo (its own layer) with a
 * separate floating "Tanyopo Intelligence" capability card overlaid on
 * top — deliberately two independent responsive layers (an <Image> plus
 * an absolutely-positioned card), never text/UI baked into the photo
 * itself. No numeric metrics here — capability labels only.
 */
export function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none">
      <div className="relative aspect-[4/5] overflow-hidden rounded-[var(--radius-xl)] border border-border shadow-[var(--shadow-lg)] sm:aspect-[5/6] lg:aspect-[4/5]">
        <Image
          src="https://images.unsplash.com/photo-1758874385600-1e4d5c49a44c?w=1200&q=80&auto=format&fit=crop"
          alt="Pemilik bisnis meninjau strategi marketing di laptop dan ponselnya"
          fill
          priority
          sizes="(min-width: 1024px) 42vw, (min-width: 640px) 60vw, 88vw"
          className="object-cover"
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-ink/35 via-transparent to-transparent"
        />
      </div>

      {/* Floating capability overlay — separate layer from the photo. */}
      <div className="absolute -bottom-5 left-1/2 w-[88%] -translate-x-1/2 rounded-[var(--radius-lg)] border border-border bg-surface/95 p-3.5 shadow-[var(--shadow-lg)] backdrop-blur sm:-bottom-6 sm:w-[80%] sm:p-4 lg:-right-6 lg:left-auto lg:w-64 lg:translate-x-0">
        <div className="mb-2.5 flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-2 text-brand-foreground">
            <Brain className="size-3.5" aria-hidden />
          </span>
          <span className="text-xs font-semibold text-foreground">Tanyopo Intelligence</span>
        </div>
        <div className="grid grid-cols-4 gap-1.5 lg:grid-cols-2">
          {CAPABILITIES.map((c) => (
            <div
              key={c.label}
              className="flex flex-col items-center gap-1 rounded-[var(--radius-md)] bg-surface-muted px-1.5 py-2 text-center lg:flex-row lg:justify-start lg:gap-2 lg:px-2.5"
            >
              <c.icon className="size-3.5 shrink-0 text-brand" aria-hidden />
              <span className="text-[10px] font-medium text-foreground sm:text-[11px]">
                {c.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
