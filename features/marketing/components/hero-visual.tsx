import Image from "next/image";
import { Target, FileText, Rocket, BarChart3, Brain } from "lucide-react";

const CAPABILITIES = [
  { icon: Target, label: "Strategi" },
  { icon: FileText, label: "Konten" },
  { icon: Rocket, label: "Campaign" },
  { icon: BarChart3, label: "Analytics" },
];

/**
 * Hero's visual half: a human photo (its own layer) with a separate
 * "Tanyopo Intelligence" capability card overlapping its lower portion —
 * two independent layers (an <Image> plus an absolutely-positioned card
 * inset within the photo's own box, never past it), never text/UI baked
 * into the photo itself, and never a numeric metric. Kept inside the
 * photo's bounds (not hanging below it) so it always reads as one
 * integrated visual, never a second, disconnected block. A short/wide
 * crop on mobile keeps the image from dominating the viewport.
 */
export function HeroVisual() {
  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[var(--radius-xl)] border border-border shadow-[var(--shadow-md)] sm:aspect-[16/10] lg:aspect-[4/5]">
      <Image
        src="https://images.unsplash.com/photo-1758874385600-1e4d5c49a44c?w=1200&q=80&auto=format&fit=crop"
        alt="Pemilik bisnis meninjau strategi marketing di laptop dan ponselnya"
        fill
        priority
        sizes="(min-width: 1024px) 42vw, (min-width: 640px) 60vw, 92vw"
        className="object-cover"
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-ink/70 via-ink/5 to-transparent"
      />

      {/* Capability card, overlapping the photo's own lower portion. */}
      <div className="absolute inset-x-3 bottom-3 rounded-[var(--radius-lg)] border border-white/15 bg-surface/95 p-3 shadow-[var(--shadow-lg)] backdrop-blur sm:inset-x-4 sm:bottom-4 sm:p-3.5">
        <div className="mb-2 flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-2 text-brand-foreground">
            <Brain className="size-3.5" aria-hidden />
          </span>
          <span className="text-xs font-semibold text-foreground">Tanyopo Intelligence</span>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {CAPABILITIES.map((c) => (
            <div
              key={c.label}
              className="flex flex-col items-center gap-1 rounded-[var(--radius-md)] bg-surface-muted px-1 py-1.5 text-center"
            >
              <c.icon className="size-3.5 shrink-0 text-brand" aria-hidden />
              <span className="text-[9.5px] font-medium leading-tight text-foreground sm:text-[10.5px]">
                {c.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
