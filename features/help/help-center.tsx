"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  HELP_ARTICLES,
  HELP_CATEGORIES,
  HELP_STATUS_LABEL,
  SUPPORT_MAILTO,
  type HelpArticle,
  type HelpStatus,
} from "@/features/help/help-content";
import { filterHelpArticles, type HelpCategoryFilter } from "@/features/help/help-search";
import { LEGAL } from "@/features/legal/legal-meta";

const STATUS_VARIANT: Record<HelpStatus, "success" | "warning" | "info"> = {
  AVAILABLE: "success",
  IN_DEVELOPMENT: "warning",
  AWAITING_PLATFORM: "info",
};

function ArticleLink({ article }: { article: HelpArticle }) {
  if (!article.link) return null;
  const external = article.link.href.startsWith("mailto:");
  return external ? (
    <a href={article.link.href} className="mt-3 inline-block text-sm font-medium text-brand hover:underline">
      {article.link.label}
    </a>
  ) : (
    <Link href={article.link.href} className="mt-3 inline-block text-sm font-medium text-brand hover:underline">
      {article.link.label}
    </Link>
  );
}

/**
 * Searchable, categorised help articles. All articles render on the server
 * (initial state = everything visible), so the content is indexable and works
 * before hydration; the search box and category chips only narrow the list.
 * No data leaves the browser: the query is never sent anywhere.
 */
export function HelpCenter() {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<HelpCategoryFilter>("semua");

  const results = useMemo(() => filterHelpArticles(HELP_ARTICLES, query, category), [query, category]);
  const visibleCategories = HELP_CATEGORIES.filter((c) => results.some((a) => a.category === c.id));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <label htmlFor={searchId} className="text-sm font-medium text-foreground">
          Cari bantuan
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            id={searchId}
            type="search"
            inputMode="search"
            autoComplete="off"
            maxLength={100}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Contoh: trial, refund, TikTok, harga"
            className="h-12 pl-9 text-base"
          />
        </div>
        <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
          {results.length === 0
            ? "Tidak ada hasil."
            : `${results.length} artikel ditemukan.`}
        </p>
      </div>

      <nav aria-label="Kategori bantuan">
        <ul className="flex flex-wrap gap-2">
          {([{ id: "semua", title: "Semua" }, ...HELP_CATEGORIES] as const).map((c) => {
            const active = category === c.id;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => setCategory(c.id)}
                  className={
                    "min-h-11 rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 " +
                    (active
                      ? "border-brand bg-brand-muted text-brand"
                      : "border-border bg-surface text-foreground hover:bg-surface-muted")
                  }
                >
                  {c.title}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div role="group" aria-label="Arti label status" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Status fitur:</span>
        {(Object.keys(HELP_STATUS_LABEL) as HelpStatus[]).map((s) => (
          <Badge key={s} variant={STATUS_VARIANT[s]}>
            {HELP_STATUS_LABEL[s]}
          </Badge>
        ))}
      </div>

      {results.length === 0 ? (
        <div className="rounded-[var(--radius-xl)] border border-border bg-surface p-6 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Tidak menemukan jawabannya?</p>
          <p className="mt-1">Coba kata kunci lain, atau kirim pertanyaan Anda ke tim dukungan lewat email.</p>
          <Button asChild size="md" className="mt-4 w-full sm:w-auto">
            <a href={SUPPORT_MAILTO}>Hubungi dukungan</a>
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {visibleCategories.map((c) => (
            <section key={c.id} id={c.id} aria-labelledby={`${c.id}-title`} className="scroll-mt-24">
              <h2 id={`${c.id}-title`} className="text-lg font-semibold tracking-tight text-foreground">
                {c.title}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">{c.summary}</p>
              <div className="mt-3 flex flex-col divide-y divide-border overflow-hidden rounded-[var(--radius-xl)] border border-border bg-surface shadow-[var(--shadow-sm)]">
                {results
                  .filter((a) => a.category === c.id)
                  .map((a) => (
                    <details key={a.id} className="group px-4 py-1 sm:px-6" id={a.id}>
                      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-3 text-sm font-medium text-foreground marker:content-none">
                        <span className="min-w-0 break-words">{a.question}</span>
                        <span aria-hidden className="shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-45">
                          +
                        </span>
                      </summary>
                      <div className="pb-4 text-sm leading-relaxed text-muted-foreground">
                        {a.status ? (
                          <p className="mb-2">
                            <Badge variant={STATUS_VARIANT[a.status]}>{HELP_STATUS_LABEL[a.status]}</Badge>
                          </p>
                        ) : null}
                        {a.answer.split(/\n\n+/).map((para, i) => (
                          <p key={i} className="mt-2 first:mt-0 break-words">
                            {para}
                          </p>
                        ))}
                        <ArticleLink article={a} />
                      </div>
                    </details>
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <section aria-labelledby="bantuan-kontak" className="rounded-[var(--radius-xl)] border border-border bg-surface-muted/40 p-6">
        <h2 id="bantuan-kontak" className="text-lg font-semibold tracking-tight text-foreground">
          Masih butuh bantuan?
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Kirim email ke {LEGAL.operator}. Jangan kirim kata sandi atau token. Kami tidak menetapkan jangka waktu balasan di halaman ini.
        </p>
        <Button asChild size="lg" className="mt-4 w-full sm:w-auto">
          <a href={SUPPORT_MAILTO}>Hubungi dukungan</a>
        </Button>
        <p className="mt-3 break-all text-xs text-muted-foreground">{LEGAL.contactEmail}</p>
      </section>
    </div>
  );
}
