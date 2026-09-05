import { UserCheck, Wallet, Lock, ScrollText, KeyRound, Octagon } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";

const TRUST_POINTS = [
  { icon: UserCheck, title: "Persetujuan Manusia", desc: "Aksi berbayar menunggu Anda meninjau dan menyetujui, bukan langsung tayang." },
  { icon: Wallet, title: "Budget Guard", desc: "Batas harian, bulanan, dan per-campaign yang tidak bisa dilewati AI." },
  { icon: Lock, title: "Isolasi Tenant", desc: "Data tiap bisnis terisolasi di level database (Row Level Security), bukan hanya di aplikasi." },
  { icon: ScrollText, title: "Jejak Audit", desc: "Koneksi akun, peluncuran campaign, dan perubahan budget tercatat rapi." },
  { icon: KeyRound, title: "Koneksi Aman", desc: "OAuth resmi ke Facebook, Instagram, TikTok, dan X — kami tidak pernah menyimpan password Anda." },
  { icon: Octagon, title: "Emergency Stop", desc: "Satu tombol untuk menghentikan seketika semua aksi otomatis, kapan pun." },
];

export function Trust() {
  return (
    <section id="keamanan" className="scroll-mt-16 border-t border-border bg-surface-muted/40 py-14 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal className="mb-8 text-center sm:mb-12">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Kendali Tetap di Tangan Anda
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground sm:text-base">
            Dibangun dengan prinsip keamanan multi-tenant yang ketat sejak hari pertama.
          </p>
        </Reveal>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {TRUST_POINTS.map((p) => (
            <div
              key={p.title}
              className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-border bg-surface p-4 shadow-[var(--shadow-sm)] sm:p-5"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-muted">
                <p.icon className="size-4 text-brand" aria-hidden />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{p.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{p.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
