import { Package, Brain, Target, FileText, Rocket, Search, BarChart3, Sliders, TrendingUp, type LucideIcon } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";
import { cn } from "@/lib/utils/cn";

/**
 * Batch: Tanyopo Intelligence visual V2 — founder-directed layout change
 * from the prior dark "Command Center" card to a light, glowing "AI Core"
 * diagram: Produk Anda (left) -> Tanyopo Intelligence (large glowing core,
 * center) -> Pertumbuhan Bisnis (right) on desktop, with six capability
 * cards below; a vertical Produk -> Core -> capabilities -> Growth flow
 * on mobile (growth last, matching how a linear read-down makes sense on
 * a phone). Capability-based, not numbers — no illustrative metric ever
 * belongs here, since this diagram explains how the system works, not a
 * customer's results (product spec §3/§7). Every capability listed is
 * something LINOE already does today — nothing invented.
 */
const CAPABILITIES: { icon: LucideIcon; title: string; description: string }[] = [
  { icon: Target, title: "Strategi Marketing", description: "AI menyusun arah pemasaran sesuai produk dan target pasar." },
  { icon: FileText, title: "Konten & Copywriting", description: "Membantu membuat ide, headline, caption, dan materi pemasaran." },
  { icon: Rocket, title: "Campaign", description: "Menyusun channel, audience, budget, dan eksekusi campaign." },
  { icon: Search, title: "SEO & Discovery", description: "Membantu bisnis lebih mudah ditemukan." },
  { icon: BarChart3, title: "Analitik", description: "Membaca hasil dan performa pemasaran." },
  { icon: Sliders, title: "Optimasi", description: "Memberikan rekomendasi langkah berikutnya." },
];

function EndpointNode({
  icon: Icon,
  label,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  accent: "brand" | "success";
}) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-2">
      <div
        className={cn(
          "flex size-14 items-center justify-center rounded-full border bg-surface shadow-[var(--shadow-md)] sm:size-16",
          accent === "brand" ? "border-brand/30 text-brand" : "border-success/30 text-success",
        )}
      >
        <Icon className="size-6 sm:size-7" aria-hidden />
      </div>
      <span className="text-center text-sm font-semibold text-foreground sm:text-base">{label}</span>
    </div>
  );
}

function HorizontalConnector({ toGreen }: { toGreen?: boolean }) {
  return (
    <div
      aria-hidden
      className="marketing-line-flow hidden h-1 min-w-10 flex-1 rounded-full shadow-[0_0_14px_-2px_rgba(59,130,246,0.65)] lg:block"
      style={{
        background: toGreen
          ? "linear-gradient(90deg, #8b5cf6 0%, #22c55e 100%)"
          : "linear-gradient(90deg, #22d3ee 0%, #3b82f6 50%, #8b5cf6 100%)",
      }}
    />
  );
}

function VerticalConnector({ toGreen, className }: { toGreen?: boolean; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("marketing-line-flow h-8 w-1 shrink-0 rounded-full shadow-[0_0_14px_-2px_rgba(139,92,246,0.55)] sm:h-10", className)}
      style={{
        background: toGreen
          ? "linear-gradient(180deg, #8b5cf6 0%, #22c55e 100%)"
          : "linear-gradient(180deg, #22d3ee 0%, #3b82f6 45%, #8b5cf6 100%)",
      }}
    />
  );
}

function AiCore() {
  return (
    <div className="relative flex shrink-0 flex-col items-center gap-3">
      <div className="relative flex items-center justify-center">
        <div
          aria-hidden
          className="marketing-glow-pulse pointer-events-none absolute inset-0 -z-10 rounded-full blur-2xl"
          style={{ background: "radial-gradient(circle, rgba(34,211,238,0.55) 0%, rgba(139,92,246,0.5) 55%, transparent 75%)" }}
        />
        <div
          className="flex size-28 items-center justify-center rounded-full text-white shadow-[0_0_70px_-6px_rgba(99,102,241,0.65)] sm:size-32 lg:size-40"
          style={{ background: "radial-gradient(circle at 35% 30%, #67e8f9 0%, #3b82f6 45%, #8b5cf6 90%)" }}
        >
          <Brain className="size-11 sm:size-12 lg:size-16" aria-hidden />
        </div>
      </div>
      <div className="flex flex-col items-center gap-1 px-2">
        <p className="text-base font-bold text-foreground sm:text-lg">Tanyopo Intelligence</p>
        <p className="max-w-60 text-center text-xs leading-relaxed text-muted-foreground sm:max-w-xs sm:text-sm">
          AI yang menganalisis, menyusun strategi, dan menggerakkan proses pemasaran Anda.
        </p>
      </div>
    </div>
  );
}

export function TanyopoIntelligenceDiagram() {
  return (
    <div className="relative mx-auto max-w-5xl">
      <Reveal className="flex flex-col items-center gap-8 sm:gap-10">
        {/* Mobile / tablet — vertical flow: Produk -> Core */}
        <div className="flex flex-col items-center gap-3 lg:hidden">
          <EndpointNode icon={Package} label="Produk Anda" accent="brand" />
          <VerticalConnector />
          <AiCore />
        </div>

        {/* Desktop — Produk (left) -> Core (center) -> Growth (right) */}
        <div className="hidden w-full items-center justify-center gap-4 lg:flex xl:gap-8">
          <EndpointNode icon={Package} label="Produk Anda" accent="brand" />
          <HorizontalConnector />
          <AiCore />
          <HorizontalConnector toGreen />
          <EndpointNode icon={TrendingUp} label="Pertumbuhan Bisnis" accent="success" />
        </div>

        <VerticalConnector />

        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((item) => (
            <div
              key={item.title}
              className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-border bg-surface p-4 text-left shadow-[var(--shadow-sm)] transition-shadow hover:shadow-[var(--shadow-md)]"
            >
              <span
                className="flex size-10 items-center justify-center rounded-full text-white"
                style={{ background: "linear-gradient(135deg, #22d3ee 0%, #3b82f6 50%, #8b5cf6 100%)" }}
              >
                <item.icon className="size-4" aria-hidden />
              </span>
              <span className="text-sm font-semibold text-foreground">{item.title}</span>
              <span className="text-xs leading-relaxed text-muted-foreground">{item.description}</span>
            </div>
          ))}
        </div>

        {/* Mobile-only: Growth comes after the capability cards in the linear read-down */}
        <div className="flex flex-col items-center gap-3 lg:hidden">
          <VerticalConnector toGreen />
          <EndpointNode icon={TrendingUp} label="Pertumbuhan Bisnis" accent="success" />
        </div>
      </Reveal>
    </div>
  );
}
