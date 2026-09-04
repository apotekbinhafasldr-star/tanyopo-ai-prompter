import { ChevronDown } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";

const FAQS = [
  {
    q: "Apa itu LINOE?",
    a: "Tim marketing AI yang membantu memahami produk Anda, menyusun strategi, membuat konten, menyiapkan campaign, menganalisis hasil, dan terus mengoptimasi — dengan Anda tetap memegang kendali penuh.",
  },
  {
    q: "Bisakah saya pakai tanpa UMKMpro AI?",
    a: "Bisa. Integrasi dengan UMKMpro AI sepenuhnya opsional. Anda bisa menambahkan produk secara langsung dan menggunakan seluruh fitur LINOE sebagai bisnis mandiri.",
  },
  {
    q: "Apakah AI mengontrol budget iklan saya?",
    a: "Tidak. AI menyusun rekomendasi budget, tapi Budget Guard membatasi setiap aksi berbayar sesuai batas yang Anda tentukan, dan aksi penting tetap menunggu persetujuan Anda.",
  },
  {
    q: "Platform marketing apa saja yang didukung?",
    a: "Facebook, Instagram, TikTok, X, website/SEO. Status koneksi tiap platform selalu ditampilkan apa adanya — terhubung, belum dikonfigurasi, atau perlu persetujuan.",
  },
  {
    q: "Bisakah saya menyetujui campaign sebelum tayang?",
    a: "Ya. Setiap campaign berbayar melewati Approval Center — Anda meninjau, mengedit, atau meminta regenerasi sebelum apa pun dipublikasikan.",
  },
  {
    q: "Bisakah bisnis internasional menggunakannya?",
    a: "Ya. Arsitektur Global Edition mendukung banyak bahasa, mata uang, dan zona waktu — target pasar campaign Anda bisa berbeda dari negara asal bisnis Anda.",
  },
];

export function Faq() {
  return (
    <section className="border-t border-border bg-surface-muted/40 py-14 sm:py-20">
      <div className="mx-auto max-w-2xl px-4 sm:px-6">
        <Reveal className="mb-8 text-center sm:mb-10">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Pertanyaan Umum
          </h2>
        </Reveal>

        <Reveal className="flex flex-col divide-y divide-border overflow-hidden rounded-[var(--radius-xl)] border border-border bg-surface shadow-[var(--shadow-sm)]">
          {FAQS.map((item) => (
            <details key={item.q} className="group px-4 py-1 sm:px-6">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 text-sm font-medium text-foreground marker:content-none">
                {item.q}
                <ChevronDown
                  className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <p className="pb-4 text-sm leading-relaxed text-muted-foreground">{item.a}</p>
            </details>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
