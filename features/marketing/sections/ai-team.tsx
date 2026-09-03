import { ShieldCheck, TrendingUp } from "lucide-react";
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

function MetricStrip({
  items,
}: {
  items: { label: string; value: string }[];
}) {
  return (
    <div className="flex gap-4 rounded-[var(--radius-md)] border border-border bg-surface-muted/60 px-3 py-2.5">
      {items.map((item) => (
        <div key={item.label}>
          <p className="text-sm font-semibold text-foreground">{item.value}</p>
          <p className="text-[11px] text-muted-foreground">{item.label} · Contoh</p>
        </div>
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

function TrendMini({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-surface-muted/60 px-3 py-2.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-success-muted text-success">
        <TrendingUp className="size-3.5" aria-hidden />
      </span>
      <p className="text-xs text-foreground">{label}</p>
    </div>
  );
}

const SLIDES: TeamSlide[] = [
  {
    id: "strategy",
    image: "https://images.unsplash.com/photo-1580894732444-8ecded7900cd?w=1200&q=75&auto=format&fit=crop",
    imageAlt: "Ilustrasi strategist meninjau intelijen campaign di depan whiteboard",
    eyebrow: "Strategi",
    eyebrowEn: "Strategy",
    name: "AI Strategi Marketing",
    nameEn: "AI Marketing Strategist",
    message: "Strategi yang memahami produk, pasar, dan tujuan bisnis Anda.",
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
    imageAlt: "Ilustrasi kreator konten menyusun ide caption dan konsep kreatif",
    eyebrow: "Konten",
    eyebrowEn: "Content",
    name: "AI Kreator Konten",
    nameEn: "AI Content Creator",
    message: "Konten yang dirancang untuk menarik perhatian dan menghasilkan tindakan.",
    tags: ["Caption", "Hook", "Hashtag"],
    ui: <TagPills items={["3 ide caption", "Hook video pendek", "Set hashtag"]} />,
    ctaLabel: "Lihat contoh konten",
    ctaHref: "#cara-kerja",
  },
  {
    id: "campaign",
    image: "https://images.unsplash.com/photo-1754039985001-ccafee437736?w=1200&q=75&auto=format&fit=crop",
    imageAlt: "Ilustrasi manajer campaign memantau aktivitas multi-channel di beberapa layar",
    eyebrow: "Campaign",
    eyebrowEn: "Campaign",
    name: "AI Manajer Campaign",
    nameEn: "AI Campaign Manager",
    message: "Dari ide hingga campaign multi-channel dalam satu alur.",
    tags: ["Multi-channel", "Orkestrasi", "Approval"],
    ui: <ChannelRow items={["Instagram", "Facebook", "TikTok", "X", "Website"]} />,
    ctaLabel: "Lihat alur campaign",
    ctaHref: "#cara-kerja",
  },
  {
    id: "optimization",
    image: "https://images.unsplash.com/photo-1748609160056-7b95f30041f0?w=1200&q=75&auto=format&fit=crop",
    imageAlt: "Ilustrasi profesional performance marketing meninjau data efisiensi campaign di tablet",
    eyebrow: "Optimasi",
    eyebrowEn: "Optimization",
    name: "AI Optimasi Iklan",
    nameEn: "AI Ads Optimizer",
    message: "AI membantu menemukan peluang untuk meningkatkan efisiensi setiap campaign.",
    tags: ["CTR", "CPA", "ROAS"],
    ui: (
      <MetricStrip
        items={[
          { label: "CTR", value: "3.8%" },
          { label: "CPA", value: "Rp 24rb" },
          { label: "ROAS", value: "4.2x" },
        ]}
      />
    ),
    ctaLabel: "Lihat contoh optimasi",
    ctaHref: "#analitik",
  },
  {
    id: "growth",
    image: "https://images.unsplash.com/photo-1758691736580-a41e0cfe9e9f?w=1200&q=75&auto=format&fit=crop",
    imageAlt: "Ilustrasi pemilik bisnis meninjau sinyal pertumbuhan bersama tim",
    eyebrow: "Growth",
    eyebrowEn: "Growth",
    name: "Growth Intelligence",
    nameEn: "Growth Intelligence",
    message: "Temukan apa yang mendorong pertumbuhan — dan apa yang harus dilakukan berikutnya.",
    tags: ["Sinyal", "Rekomendasi", "Tren"],
    ui: <TrendMini label="Konversi naik 3 minggu berturut-turut · Contoh" />,
    ctaLabel: "Lihat sinyal pertumbuhan",
    ctaHref: "#analitik",
  },
  {
    id: "analytics",
    image: "https://images.unsplash.com/photo-1770013413878-2530e2c3d82b?w=1200&q=75&auto=format&fit=crop",
    imageAlt: "Ilustrasi pemilik UMKM memeriksa performa produk dan bisnisnya",
    eyebrow: "Analitik",
    eyebrowEn: "Analytics",
    name: "Analytics & Profit Intelligence",
    nameEn: "Analytics & Profit Intelligence",
    message: "Bukan hanya melihat penjualan. Pahami dampak marketing terhadap bisnis Anda.",
    tags: ["Revenue", "Atribusi", "Kontribusi Marketing"],
    ui: (
      <div className="flex flex-col gap-1.5">
        <MetricStrip
          items={[
            { label: "Revenue", value: "Rp 84jt" },
            { label: "Konversi", value: "312" },
            { label: "Kontribusi", value: "Rp 19jt" },
          ]}
        />
        <p className="text-[11px] text-muted-foreground">
          Estimasi kontribusi marketing, bukan laba bersih akuntansi.
        </p>
      </div>
    ),
    ctaLabel: "Lihat analitik profit-aware",
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
            Kenali Tim Marketing AI Anda
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground sm:text-base">
            Meet your AI marketing team — enam kapabilitas AI yang bekerja terorkestrasi,
            masing-masing fokus pada satu bagian dari siklus marketing Anda.
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
