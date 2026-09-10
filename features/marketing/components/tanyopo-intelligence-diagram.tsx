import { Package, Brain, Target, FileText, Rocket, Search, BarChart3, Sliders, TrendingUp, type LucideIcon } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";
import { cn } from "@/lib/utils/cn";

/**
 * The "Tanyopo Intelligence" flow: Produk -> Tanyopo Intelligence -> six
 * capabilities -> Pertumbuhan Bisnis. Capability-based, not numbers — no
 * illustrative metric/result ever belongs here, since this diagram
 * explains how the system works, not a customer's results (product spec
 * §3/§7). Every capability listed is something LINOE actually does
 * today — nothing invented. Composed entirely from the app's own icon
 * language and design tokens (brand/brand-2, existing shadow/radius
 * vars) — no stock imagery, no fake status/animation.
 */
const CAPABILITIES: { icon: LucideIcon; title: string; description: string }[] = [
  { icon: Target, title: "Strategi Marketing", description: "AI menyusun arah pemasaran sesuai produk dan target pasar." },
  { icon: FileText, title: "Konten & Copywriting", description: "Membantu membuat ide, headline, caption, dan materi pemasaran." },
  { icon: Rocket, title: "Campaign", description: "Menyusun channel, audience, budget, dan eksekusi campaign." },
  { icon: Search, title: "SEO & Discovery", description: "Membantu bisnis lebih mudah ditemukan." },
  { icon: BarChart3, title: "Analitik", description: "Membaca hasil dan performa pemasaran." },
  { icon: Sliders, title: "Optimasi", description: "Memberikan rekomendasi langkah berikutnya." },
];

function Connector({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "marketing-line-flow h-8 w-1 rounded-full sm:h-10",
        "bg-[linear-gradient(180deg,#22d3ee_0%,#3b82f6_35%,#8b5cf6_70%,#22d3ee_100%)]",
        "shadow-[0_0_16px_-2px_rgba(139,92,246,0.6)]",
        className,
      )}
    />
  );
}

export function TanyopoIntelligenceDiagram() {
  return (
    <div className="relative mx-auto max-w-4xl">
      <Reveal>
        <div
          className="relative overflow-hidden rounded-[var(--radius-xl)] border border-white/10 p-5 shadow-[var(--shadow-lg)] sm:p-8"
          style={{ background: "linear-gradient(160deg, var(--ink) 0%, #14103a 55%, #1b1140 100%)" }}
        >
          {/* Ambient glow inside the command-center panel — restrained, two soft blobs. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(50% 45% at 15% 0%, color-mix(in srgb, #22d3ee 22%, transparent), transparent 70%), radial-gradient(50% 45% at 100% 100%, color-mix(in srgb, #8b5cf6 26%, transparent), transparent 70%)",
            }}
          />

          {/* window chrome — signals "this is a real product surface" */}
          <div className="relative mb-6 flex items-center gap-1.5 sm:mb-9">
            <span className="size-2.5 rounded-full bg-danger/60" />
            <span className="size-2.5 rounded-full bg-warning/60" />
            <span className="size-2.5 rounded-full bg-success/60" />
            <span className="ml-3 text-[11px] font-medium text-white/50">
              Tanyopo Intelligence — Command Center
            </span>
          </div>

          <div className="relative flex flex-col items-center gap-0">
            <div className="flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 text-xs font-semibold text-white backdrop-blur sm:text-sm">
              <Package className="size-4 text-[#67e8f9]" aria-hidden />
              Produk Anda
            </div>

            <Connector />

            {/* Focal point — the "AI brain" node */}
            <div className="relative flex flex-col items-center">
              <div
                aria-hidden
                className="marketing-glow-pulse pointer-events-none absolute inset-0 -z-10 rounded-full blur-2xl"
                style={{ background: "radial-gradient(circle, rgba(34,211,238,0.55) 0%, rgba(139,92,246,0.45) 55%, transparent 75%)" }}
              />
              <div
                className="flex items-center gap-2.5 rounded-2xl border border-white/20 px-6 py-3.5 text-base font-semibold text-white shadow-[0_0_40px_-8px_rgba(139,92,246,0.7)] sm:px-8 sm:py-4 sm:text-lg"
                style={{ background: "linear-gradient(135deg, #22d3ee 0%, #3b82f6 50%, #8b5cf6 100%)" }}
              >
                <Brain className="size-5 sm:size-6" aria-hidden />
                Tanyopo Intelligence
              </div>
              <p className="mt-3 max-w-xs text-center text-xs leading-relaxed text-white/70 sm:max-w-sm sm:text-sm">
                AI yang menganalisis, menyusun strategi, dan menggerakkan proses pemasaran Anda.
              </p>
            </div>

            <Connector />

            <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
              {CAPABILITIES.map((item) => (
                <div
                  key={item.title}
                  className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-white/10 bg-white/[0.06] p-4 text-left backdrop-blur transition-colors hover:bg-white/[0.09]"
                >
                  <span className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-[#22d3ee] to-[#8b5cf6] text-white">
                    <item.icon className="size-4" aria-hidden />
                  </span>
                  <span className="text-sm font-semibold text-white">{item.title}</span>
                  <span className="text-xs leading-relaxed text-white/65">{item.description}</span>
                </div>
              ))}
            </div>

            <Connector className="bg-[linear-gradient(180deg,#8b5cf6_0%,#22c55e_100%)] shadow-[0_0_16px_-2px_rgba(34,197,94,0.5)]" />

            <div className="flex items-center gap-2 rounded-full border border-success/40 bg-success-muted/90 px-4 py-2 text-xs font-semibold text-success sm:text-sm">
              <TrendingUp className="size-4" aria-hidden />
              Pertumbuhan Bisnis
            </div>
            <p className="mt-3 max-w-xs text-center text-xs leading-relaxed text-white/70 sm:max-w-sm sm:text-sm">
              Keputusan pemasaran yang lebih terarah untuk membantu bisnis bertumbuh.
            </p>
          </div>
        </div>
      </Reveal>
    </div>
  );
}
