import { Store, ArrowRight, Rocket, LineChart } from "lucide-react";
import { Reveal } from "@/features/marketing/components/reveal";

const FLOW = [
  { icon: Store, label: "UMKMpro AI" },
  { icon: ArrowRight, label: null, isConnector: true },
  { icon: Rocket, label: "LINOE" },
  { icon: ArrowRight, label: null, isConnector: true },
  { icon: LineChart, label: "Insight Konversi" },
];

export function UmkmproIntegration() {
  return (
    <section className="border-t border-border bg-surface-muted/40 py-14 sm:py-20">
      <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
        <Reveal>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Satu Ekosistem, Dua Produk
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
            <strong className="text-foreground">UMKMpro AI</strong> mengelola bisnis Anda —{" "}
            <strong className="text-foreground">LINOE</strong> menumbuhkannya.
            Kirim produk, stok, dan data bisnis dengan satu klik.
          </p>
        </Reveal>

        <Reveal className="mt-8 flex flex-wrap items-center justify-center gap-2 sm:mt-10 sm:gap-3">
          {FLOW.map((step, i) =>
            step.isConnector ? (
              <ArrowRight key={i} className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            ) : (
              <div
                key={step.label}
                className="flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground shadow-[var(--shadow-sm)]"
              >
                <step.icon className="size-4 text-brand" aria-hidden />
                {step.label}
              </div>
            ),
          )}
        </Reveal>

        <p className="mt-6 text-xs text-muted-foreground">
          Integrasi ini sepenuhnya opsional — LINOE tetap berjalan penuh untuk
          bisnis yang tidak memakai UMKMpro AI sama sekali.
        </p>
      </div>
    </section>
  );
}
