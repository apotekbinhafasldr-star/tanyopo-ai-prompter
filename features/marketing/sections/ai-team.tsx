import { ShieldCheck, Search, Target, FileText, Megaphone, BarChart3, Sparkles } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";
import { TeamCarousel, type TeamSlide } from "@/features/marketing/components/team-carousel";

function TagPills({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className="rounded-full bg-brand-muted px-2.5 py-1 text-[11px] font-medium text-brand"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function ChannelRow({ items }: { items: string[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span
            key={item}
            className="rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
          >
            {item}
          </span>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Status koneksi nyata terlihat di Connection Center Anda — belum aktif tetap tampil belum
        aktif.
      </p>
    </div>
  );
}

const SLIDES: TeamSlide[] = [
  {
    id: "product-analysis",
    image: "https://images.unsplash.com/photo-1544168190-79c17527004f?w=1200&q=75&auto=format&fit=crop",
    imageAlt: "Profesional bisnis menganalisis data produk dan pasar di meja kerja",
    icon: <Search aria-hidden />,
    eyebrow: "Analisis",
    name: "Analisis Produk",
    message: "Pahami pasar, target audiens, dan peluang terbaik untuk bisnis Anda.",
    tags: ["Pasar", "Audience", "Peluang"],
    ui: <TagPills items={["Kategori teridentifikasi", "Audiens: Urban 25-40", "Peluang bersaing"]} />,
    ctaLabel: "Lihat cara kerja analisis",
    ctaHref: "#cara-kerja",
  },
  {
    id: "strategy",
    image: "https://images.unsplash.com/photo-1758873268238-0b93e41fdcf5?w=1200&q=75&auto=format&fit=crop",
    imageAlt: "Strategist marketing menyusun rencana di depan papan diagram",
    icon: <Target aria-hidden />,
    eyebrow: "Strategi",
    name: "Strategi Marketing",
    message: "Susun strategi yang tepat sasaran dan berbasis data.",
    tags: ["Target", "Positioning", "Strategi"],
    ui: (
      <TagPills items={["Positioning: Premium lokal", "Audiens: Urban 25-40", "USP teridentifikasi"]} />
    ),
    ctaLabel: "Lihat cara kerja strategi",
    ctaHref: "#cara-kerja",
  },
  {
    id: "content",
    image: "https://images.unsplash.com/photo-1573911932098-5e3e90f59f15?w=1200&q=75&auto=format&fit=crop",
    imageAlt: "Kreator konten mengambil foto produk dengan smartphone",
    icon: <FileText aria-hidden />,
    eyebrow: "Konten",
    name: "Konten & Copywriting",
    message: "Buat ide, caption, hook, CTA, dan konten yang mendorong tindakan.",
    tags: ["Caption", "Hook", "CTA"],
    ui: <TagPills items={["3 ide caption", "Hook video pendek", "Set hashtag"]} />,
    ctaLabel: "Lihat contoh konten",
    ctaHref: "#cara-kerja",
  },
  {
    id: "campaign",
    image: "https://images.unsplash.com/photo-1603086360919-8b8eacad64bc?w=1200&q=75&auto=format&fit=crop",
    imageAlt: "Digital marketer mengelola alur kerja campaign multi-channel",
    icon: <Megaphone aria-hidden />,
    eyebrow: "Iklan",
    name: "Iklan Multi-Channel",
    message: "Kelola campaign lintas channel melalui alur kerja yang lebih sederhana.",
    tags: ["Campaign", "Channel", "Audience"],
    ui: <ChannelRow items={["Instagram", "Facebook", "TikTok", "X", "Website"]} />,
    ctaLabel: "Lihat alur campaign",
    ctaHref: "#cara-kerja",
  },
  {
    id: "analytics",
    image: "https://images.unsplash.com/photo-1579389082289-3d6922d506c4?w=1200&q=75&auto=format&fit=crop",
    imageAlt: "Profesional mempelajari data performa marketing di laptop",
    icon: <BarChart3 aria-hidden />,
    eyebrow: "Analitik",
    name: "Analitik & Laporan",
    message: "Pantau performa dan pahami hasil campaign dengan lebih mudah.",
    tags: ["Insight", "Performa", "Laporan"],
    ui: (
      <div className="flex flex-col gap-1.5">
        <TagPills items={["Atribusi per channel", "Estimasi kontribusi marketing", "Tren revenue"]} />
        <p className="text-[11px] text-muted-foreground">
          Estimasi kontribusi marketing, bukan laba bersih akuntansi.
        </p>
      </div>
    ),
    ctaLabel: "Lihat analitik profit-aware",
    ctaHref: "#analitik",
  },
  {
    id: "optimization",
    image: "https://images.unsplash.com/photo-1720501828093-c792c10e3f0b?w=1200&q=75&auto=format&fit=crop",
    imageAlt: "Profesional marketing meninjau rekomendasi pertumbuhan dari AI",
    icon: <Sparkles aria-hidden />,
    eyebrow: "Optimasi",
    name: "Optimasi Growth",
    message: "Gunakan rekomendasi AI untuk meningkatkan performa secara berkelanjutan.",
    tags: ["AI Insight", "Optimasi", "Growth"],
    ui: (
      <TagPills items={["Analisis efisiensi budget", "Rekomendasi penyesuaian", "Peringatan anomali"]} />
    ),
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
