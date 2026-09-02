import { MessageCircle, Camera, Music2, X as XIcon, Globe, Search } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";

const CHANNELS = [
  { icon: MessageCircle, label: "Facebook" },
  { icon: Camera, label: "Instagram" },
  { icon: Music2, label: "TikTok" },
  { icon: XIcon, label: "X" },
  { icon: Globe, label: "Website" },
  { icon: Search, label: "SEO" },
];

export function Omnichannel() {
  return (
    <section className="border-t border-border py-14 sm:py-20">
      <div className="mx-auto max-w-5xl px-4 text-center sm:px-6">
        <Reveal>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Satu Strategi, Banyak Channel
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground sm:text-base">
            Arsitektur koneksi resmi (OAuth) untuk platform marketing utama. Channel yang belum
            Anda hubungkan tetap ditandai jelas sebagai belum terhubung — tidak pernah
            berpura-pura aktif.
          </p>
        </Reveal>

        <Reveal className="mt-8 grid grid-cols-3 gap-3 sm:mt-10 sm:gap-5 lg:grid-cols-6">
          {CHANNELS.map((c) => (
            <div
              key={c.label}
              className="flex flex-col items-center gap-2 rounded-[var(--radius-lg)] border border-border bg-surface p-4 shadow-[var(--shadow-sm)]"
            >
              <div className="flex size-11 items-center justify-center rounded-full bg-surface-muted">
                <c.icon className="size-5 text-foreground" aria-hidden />
              </div>
              <span className="text-xs font-medium text-muted-foreground">{c.label}</span>
            </div>
          ))}
        </Reveal>
        <p className="mt-6 text-xs text-muted-foreground">
          Status koneksi setiap channel — terhubung, belum dikonfigurasi, atau perlu persetujuan —
          selalu terlihat apa adanya di Connection Center Anda.
        </p>
      </div>
    </section>
  );
}
