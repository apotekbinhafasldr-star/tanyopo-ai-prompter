import { ShieldCheck } from "lucide-react";
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
    image: "https://images.unsplash.com/photo-1758518729908-d4220a678d81?w=1200&q=75&auto=format&fit=crop",
    imageAlt: "Tim bisnis meninjau data produk dan riset pasar bersama",
    eyebrow: "Analisis",
    name: "Analisis Produk",
    message: "Pahami pasar, target audiens, dan peluang terbaik untuk bisnis Anda.",
    tags: ["Riset Pasar", "Target Audiens", "Peluang Produk"],
    ui: <TagPills items={["Kategori teridentifikasi", "Audiens: Urban 25-40", "Peluang bersaing"]} />,
    ctaLabel: "Lihat cara kerja analisis",
    ctaHref: "#cara-kerja",
  },
  {
    id: "strategy",
    image: "https://images.unsplash.com/photo-1580894732444-8ecded7900cd?w=1200&q=75&auto=format&fit=crop",
    imageAlt: "Strategist meninjau intelijen campaign di depan whiteboard",
    eyebrow: "Strategi",
    name: "Strategi Marketing",
    message: "Susun strategi yang tepat sasaran dan berbasis data.",
    tags: ["Positioning", "Target Audience", "USP"],
    ui: (
      <TagPills items={["Positioning: Premium lokal", "Audiens: Urban 25-40", "USP teridentifikasi"]} />
    ),
    ctaLabel: "Lihat cara kerja strategi",
    ctaHref: "#cara-kerja",
  },
  {
    id: "content",
    image: "https://images.unsplash.com/photo-1737729991003-521d47240eb3?w=1200&q=75&auto=format&fit=crop",
    imageAlt: "Kreator konten menyusun ide caption dan konsep kreatif",
    eyebrow: "Konten",
    name: "Konten & Copywriting",
    message: "Buat ide, caption, hook, CTA, dan konten yang mendorong tindakan.",
    tags: ["Caption", "Hook", "Hashtag"],
    ui: <TagPills items={["3 ide caption", "Hook video pendek", "Set hashtag"]} />,
    ctaLabel: "Lihat contoh konten",
    ctaHref: "#cara-kerja",
  },
  {
    id: "campaign",
    image: "https://images.unsplash.com/photo-1754039985001-ccafee437736?w=1200&q=75&auto=format&fit=crop",
    imageAlt: "Manajer campaign memantau aktivitas multi-channel di beberapa layar",
    eyebrow: "Iklan",
    name: "Iklan Multi-Channel",
    message: "Kelola campaign lintas channel dari satu alur kerja yang lebih sederhana.",
    tags: ["Multi-channel", "Orkestrasi", "Approval"],
    ui: <ChannelRow items={["Instagram", "Facebook", "TikTok", "X", "Website"]} />,
    ctaLabel: "Lihat alur campaign",
    ctaHref: "#cara-kerja",
  },
  {
    id: "analytics",
    image: "https://images.unsplash.com/photo-1770013413878-2530e2c3d82b?w=1200&q=75&auto=format&fit=crop",
    imageAlt: "Pemilik UMKM memeriksa performa produk dan bisnisnya",
    eyebrow: "Analitik",
    name: "Analitik & Laporan",
    message: "Pantau performa dan pahami hasil campaign dengan lebih mudah.",
    tags: ["Revenue", "Atribusi", "Kontribusi Marketing"],
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
    image: "https://images.unsplash.com/photo-1758691736580-a41e0cfe9e9f?w=1200&q=75&auto=format&fit=crop",
    imageAlt: "Profesional marketing meninjau rekomendasi pertumbuhan bersama tim",
    eyebrow: "Optimasi",
    name: "Optimasi Growth",
    message: "Gunakan rekomendasi AI untuk meningkatkan performa secara berkelanjutan.",
    tags: ["CTR", "CPA", "ROAS"],
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
