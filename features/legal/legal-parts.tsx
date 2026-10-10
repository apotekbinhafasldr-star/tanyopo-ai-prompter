import Link from "next/link";
import type { ReactNode } from "react";
import { LEGAL, LEGAL_LINKS } from "./legal-meta";

export interface LegalTocItem {
  id: string;
  title: string;
}

/** Page shell: header, draft notice, table of contents, body, cross links. */
export function LegalDocument({
  title,
  intro,
  toc,
  current,
  children,
}: {
  title: string;
  intro: string;
  toc: LegalTocItem[];
  current: (typeof LEGAL_LINKS)[number]["href"];
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
      <header className="mb-8">
        <p className="text-sm font-medium text-brand">{LEGAL.product}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{title}</h1>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">{intro}</p>
        <p className="mt-3 text-sm text-muted-foreground">
          Penyelenggara: {LEGAL.operator}, {LEGAL.location}.
        </p>
      </header>

      {LEGAL.isDraft ? (
        <div
          role="note"
          className="mb-8 rounded-xl border border-border bg-muted/40 p-4 text-sm leading-relaxed text-foreground"
        >
          <p className="font-semibold">Draf — belum final</p>
          <p className="mt-1 text-muted-foreground">
            Dokumen ini adalah draf yang disusun pada {LEGAL.draftDate} berdasarkan perilaku aplikasi saat ini. Isinya
            belum ditinjau penasihat hukum dan belum berlaku sebagai dokumen hukum final. Bagian bertanda “Menunggu
            keputusan perusahaan” sengaja dikosongkan sampai perusahaan memutuskannya.
          </p>
        </div>
      ) : null}

      <nav aria-label="Daftar isi" className="mb-10 rounded-xl border border-border p-4">
        <p className="text-sm font-semibold text-foreground">Daftar isi</p>
        <ol className="mt-2 grid list-decimal gap-1 pl-5 text-sm text-muted-foreground sm:grid-cols-2">
          {toc.map((item) => (
            <li key={item.id}>
              <a href={`#${item.id}`} className="hover:text-foreground hover:underline">
                {item.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="flex flex-col gap-10">{children}</div>

      <nav aria-label="Dokumen hukum lainnya" className="mt-14 border-t border-border pt-6 text-sm">
        <p className="text-muted-foreground">Dokumen terkait:</p>
        <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
          {LEGAL_LINKS.filter((l) => l.href !== current).map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="font-medium text-brand hover:underline">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

export function LegalSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24">
      <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      <div className="mt-3 flex flex-col gap-3 text-[15px] leading-relaxed text-foreground/90">{children}</div>
    </section>
  );
}

export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

/**
 * Visible marker for information the company has not decided / supplied yet.
 * Never rendered as if it were a final policy statement.
 */
export function PendingDecision({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
      <span className="font-semibold text-foreground">Menunggu keputusan perusahaan: </span>
      {children}
    </p>
  );
}
