import { Target, FileText, Rocket, Search, BarChart3, Sliders, ShieldCheck } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";

const AGENTS = [
  { icon: Target, name: "Strategy Agent", desc: "Menyusun marketing blueprint, positioning, dan USP dari data produk Anda." },
  { icon: FileText, name: "Creative Agent", desc: "Membuat caption, hook, script, dan hashtag untuk setiap platform." },
  { icon: Rocket, name: "Campaign Agent", desc: "Menyusun proposal campaign — tujuan, channel, targeting, dan alokasi budget." },
  { icon: Search, name: "SEO Agent", desc: "Rekomendasi keyword, on-page, dan content plan untuk website Anda." },
  { icon: BarChart3, name: "Analytics Agent", desc: "Merangkum performa nyata menjadi tren dan risiko yang mudah dipahami." },
  { icon: Sliders, name: "Optimization Agent", desc: "Menyarankan aksi budget/channel berbasis kontribusi marketing, bukan ROAS semata." },
];

export function AiTeam() {
  return (
    <section id="ai-agents" className="scroll-mt-16 border-t border-border bg-surface-muted/40 py-14 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal className="mb-8 text-center sm:mb-12">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Tim Marketing AI Anda
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground sm:text-base">
            Enam AI agent yang bekerja terorkestrasi — masing-masing fokus pada satu bagian dari
            siklus marketing.
          </p>
        </Reveal>

        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          {AGENTS.map((agent) => (
            <div
              key={agent.name}
              className="group flex flex-col gap-3 rounded-[var(--radius-lg)] border border-border bg-surface p-4 shadow-[var(--shadow-sm)] transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] sm:p-5"
            >
              <div className="flex size-10 items-center justify-center rounded-[var(--radius-md)] bg-gradient-to-br from-brand to-brand-2 shadow-[var(--shadow-sm)]">
                <agent.icon className="size-4.5 text-brand-foreground" aria-hidden />
              </div>
              <p className="text-sm font-semibold text-foreground">{agent.name}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">{agent.desc}</p>
            </div>
          ))}
        </div>

        <Reveal className="mt-8 flex items-start gap-3 rounded-[var(--radius-lg)] border border-brand/20 bg-brand-muted/60 p-4 sm:mx-auto sm:mt-10 sm:max-w-2xl sm:p-5">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
          <p className="text-sm text-foreground">
            AI menyusun dan menyarankan — bukan mengeksekusi bebas. Setiap aksi berdampak biaya
            atau publikasi tetap melewati <strong className="font-semibold">izin akses</strong>,{" "}
            <strong className="font-semibold">Budget Guard</strong>,{" "}
            <strong className="font-semibold">kebijakan persetujuan</strong>, dan kendali penuh
            Anda sebagai pemilik bisnis.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
