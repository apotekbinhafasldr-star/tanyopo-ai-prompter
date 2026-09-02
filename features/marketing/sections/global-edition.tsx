import { Globe2, Languages, Coins, Clock } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";

const PILLARS = [
  { icon: Languages, title: "Bahasa", desc: "Indonesia & English, dengan arsitektur yang siap ditambah." },
  { icon: Coins, title: "Mata Uang", desc: "IDR, USD, MYR, SGD, EUR, GBP, AUD — tidak pernah dicampur diam-diam." },
  { icon: Clock, title: "Zona Waktu", desc: "Penjadwalan sadar zona waktu — tidak berasumsi satu wilayah untuk semua." },
  { icon: Globe2, title: "Target Pasar", desc: "Pasar bisnis Anda dan target campaign bisa berbeda, dan itu didukung." },
];

export function GlobalEdition() {
  return (
    <section className="border-t border-border py-14 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal className="mb-8 text-center sm:mb-12">
          <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            <Globe2 className="size-3.5 text-brand" aria-hidden />
            Global Edition
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Dibangun untuk Tumbuh Lintas Batas
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground sm:text-base">
            Mulai dari Indonesia, dirancang untuk bisnis global — tanpa mengorbankan bisnis lokal
            yang sudah berjalan hari ini.
          </p>
        </Reveal>

        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {PILLARS.map((p) => (
            <div
              key={p.title}
              className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-border bg-surface p-4 shadow-[var(--shadow-sm)] sm:p-5"
            >
              <div className="flex size-10 items-center justify-center rounded-[var(--radius-md)] bg-brand-muted">
                <p.icon className="size-4.5 text-brand" aria-hidden />
              </div>
              <p className="text-sm font-semibold text-foreground">{p.title}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">{p.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
