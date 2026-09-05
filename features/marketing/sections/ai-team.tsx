import { ShieldCheck, Search, Target, FileText, Megaphone, BarChart3, Sparkles } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";
import { TeamCarousel, type TeamSlide } from "@/features/marketing/components/team-carousel";

const SLIDES: TeamSlide[] = [
  {
    id: "product-analysis",
    image: "/brand/linoe/feature-cards/06-analisis-produk-final.png",
    imageAlt: "Analisis Produk LINOE — pahami pasar, target audiens, dan peluang terbaik untuk produk Anda",
    imageIsComplete: true,
    icon: <Search aria-hidden />,
    titleLead: "Analisis",
    titleAccent: "Produk",
    message: "Pahami pasar, target audiens, dan peluang terbaik untuk bisnis Anda.",
    ctaLabel: "Lihat cara kerja analisis",
    ctaHref: "#cara-kerja",
  },
  {
    id: "strategy",
    image: "/brand/linoe/feature-cards/01-strategi-marketing-final.png",
    imageAlt: "Strategi Marketing LINOE — rancang strategi pemasaran berbasis data dan insight AI untuk hasil maksimal",
    imageIsComplete: true,
    icon: <Target aria-hidden />,
    titleLead: "Strategi",
    titleAccent: "Marketing",
    message: "Susun strategi yang tepat sasaran dan berbasis data.",
    ctaLabel: "Lihat cara kerja strategi",
    ctaHref: "#cara-kerja",
  },
  {
    id: "content",
    image: "/brand/linoe/feature-cards/02-konten-copywriting-final.png",
    imageAlt: "Konten & Copywriting LINOE — buat ide, caption, dan konten menarik yang siap digunakan di semua channel",
    imageIsComplete: true,
    icon: <FileText aria-hidden />,
    titleLead: "Konten &",
    titleAccent: "Copywriting",
    message: "Buat ide, caption, hook, CTA, dan konten yang mendorong tindakan.",
    ctaLabel: "Lihat contoh konten",
    ctaHref: "#cara-kerja",
  },
  {
    id: "campaign",
    image: "/brand/linoe/feature-cards/03-iklan-multi-channel-final.png",
    imageAlt: "Iklan Multi-Channel LINOE — jalankan iklan di TikTok, Instagram, Facebook, dan X dengan AI",
    imageIsComplete: true,
    icon: <Megaphone aria-hidden />,
    titleLead: "Iklan",
    titleAccent: "Multi-Channel",
    message: "Kelola campaign lintas channel melalui alur kerja yang lebih sederhana.",
    ctaLabel: "Lihat alur campaign",
    ctaHref: "#cara-kerja",
  },
  {
    id: "analytics",
    image: "/brand/linoe/feature-cards/04-analitik-laporan-final.png",
    imageAlt: "Analitik & Laporan LINOE — pantau performa campaign dengan laporan real-time yang mudah dipahami",
    imageIsComplete: true,
    icon: <BarChart3 aria-hidden />,
    titleLead: "Analitik &",
    titleAccent: "Laporan",
    message: "Pantau performa dan pahami hasil campaign dengan lebih mudah.",
    ctaLabel: "Lihat analitik profit-aware",
    ctaHref: "#analitik",
  },
  {
    id: "optimization",
    image: "/brand/linoe/feature-cards/05-optimasi-growth-final.png",
    imageAlt: "Optimasi Growth LINOE — dapatkan rekomendasi AI untuk meningkatkan hasil dan menurunkan biaya iklan",
    imageIsComplete: true,
    icon: <Sparkles aria-hidden />,
    titleLead: "Optimasi",
    titleAccent: "Growth",
    message: "Gunakan rekomendasi AI untuk meningkatkan performa secara berkelanjutan.",
    ctaLabel: "Lihat contoh optimasi",
    ctaHref: "#analitik",
  },
];

export function AiTeam() {
  return (
    <section id="ai-agents" className="scroll-mt-16 border-t border-border py-14 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal className="mb-8 text-center sm:mb-12">
          <span className="text-xs font-semibold uppercase tracking-wide text-brand">
            AI Marketing Team
          </span>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Tim Marketing AI Lengkap untuk Bisnis Anda
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground sm:text-base">
            Dari strategi hingga optimasi, LINOE membantu setiap tahap pemasaran bisnis Anda
            dengan AI.
          </p>
        </Reveal>
      </div>

      <Reveal>
        <TeamCarousel slides={SLIDES} />
      </Reveal>

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal className="mt-10 flex items-start gap-3 rounded-[var(--radius-lg)] border border-brand/20 bg-brand-muted/60 p-4 sm:mx-auto sm:mt-12 sm:max-w-2xl sm:p-5">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
          <p className="text-sm text-foreground">
            <strong className="font-semibold">AI merekomendasikan. Anda menyetujui.</strong>{" "}
            Tanyopo menjalankan aksi hanya dalam batas izin yang Anda berikan — Approval Control,
            Budget Guard, dan Emergency Stop selalu berada di tangan Anda.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
