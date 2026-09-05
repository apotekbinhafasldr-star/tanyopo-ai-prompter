import Image from "next/image";
import { Target, FileText, Rocket, BarChart3, Sliders, Users, Brain, Sparkles } from "lucide-react";

const MODULES = [
  { icon: Target, label: "Strategi" },
  { icon: FileText, label: "Konten" },
  { icon: Rocket, label: "Campaign" },
  { icon: BarChart3, label: "Analitik" },
  { icon: Sliders, label: "Optimasi" },
  { icon: Users, label: "Audience" },
];

/**
 * Hero's visual half: a human presenter photo — face forward, not cropped —
 * plus a floating "AI active" chip and a floating Tanyopo Intelligence
 * dashboard card. The photo keeps its natural color (a colored overlay
 * would clash with her blazer); it ties into the dark hero instead through
 * a bottom-anchored ink vignette that melts the photo's lower edge into
 * the hero background, plus the same cyan/blue/violet glow on its border.
 * The dashboard card is a sibling pulled up over the photo's own lower
 * edge with a negative margin (not absolute-positioned inside an
 * overflow-hidden box), so it always overlaps the photo — never clipped,
 * never a separate floating block with a gap under it — on every
 * breakpoint. The outer hero section is not overflow-hidden, so the AI
 * chip can float just outside the photo's frame onto the dark hero
 * background, reinforcing "one integrated composition" rather than a photo
 * sitting inside its own isolated box.
 */
export function HeroVisual() {
  return (
    <div className="relative w-full">
      <div className="absolute -top-3 left-2 z-10 flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1.5 text-[11px] font-medium text-white shadow-[0_8px_24px_-8px_rgba(59,130,246,0.55)] backdrop-blur sm:-top-4 sm:left-4 sm:px-3 sm:text-xs">
        <Sparkles className="size-3.5 shrink-0 text-[#67e8f9]" aria-hidden />
        Rekomendasi AI Aktif
      </div>

      {/* Floating caption, echoing the reference's handwritten-style note
          near the presenter — a gradient underline stands in for a script
          font so it renders identically everywhere. */}
      <div className="absolute right-2 top-[30%] z-10 max-w-[9.5rem] rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-xs italic leading-snug text-white shadow-[0_8px_24px_-8px_rgba(139,92,246,0.5)] backdrop-blur sm:right-5 sm:max-w-[10.5rem] sm:text-sm">
        Dari Ide, Jadi Hasil Nyata
        <span
          aria-hidden
          className="mt-1.5 block h-0.5 w-9 rounded-full bg-gradient-to-r from-[#22d3ee] to-[#8b5cf6]"
        />
      </div>

      {/* aspect-[3/4] (not the previous 4/3) closely matches this photo's own
          ~2:3 portrait proportions — at 4/3 mobile only showed ~50% of the
          image's height, cropping out either her face or the tablet
          depending on object-position; no position could show both at
          once. At 3/4, ~90% of the height is visible, so both fit. */}
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-[var(--radius-xl)] border border-white/10 shadow-[0_0_0_1px_rgba(59,130,246,0.15),0_24px_64px_-16px_rgba(0,0,0,0.55)] lg:aspect-[4/5]">
        <Image
          src="/brand/linoe/07-hero-wanita-linoe-final.png"
          alt="Presenter LINOE memegang tablet bermerek LINOE, tersenyum percaya diri"
          fill
          priority
          sizes="(min-width: 1024px) 42vw, (min-width: 640px) 60vw, 92vw"
          className="object-cover object-[50%_45%]"
        />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-ink/85 via-transparent to-transparent" />
      </div>

      {/* Tanyopo Intelligence dashboard — pulled up over the photo's lower
          edge. Hidden at lg: since the desktop hero gets its own dedicated
          third-column dashboard panel (HeroDashboardPanel) instead. */}
      <div className="relative -mt-10 mx-3 rounded-[var(--radius-lg)] border border-white/10 bg-surface/97 p-3.5 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.5)] backdrop-blur sm:-mt-12 sm:mx-6 sm:p-4 lg:hidden">
        <div className="mb-2.5 flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-full bg-gradient-to-br from-[#22d3ee] via-[#3b82f6] to-[#8b5cf6] text-white">
            <Brain className="size-3.5" aria-hidden />
          </span>
          <span className="text-xs font-semibold text-foreground">Tanyopo Intelligence</span>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {MODULES.map((m) => (
            <div
              key={m.label}
              className="flex flex-col items-center gap-1 rounded-[var(--radius-md)] bg-surface-muted px-1 py-1.5 text-center"
            >
              <m.icon className="size-3.5 shrink-0 text-brand" aria-hidden />
              <span className="text-[9.5px] font-medium leading-tight text-foreground sm:text-[10.5px]">
                {m.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
