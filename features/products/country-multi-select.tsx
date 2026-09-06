"use client";

import { useId, useMemo, useState } from "react";
import { X } from "lucide-react";
import { QUICK_PICK_COUNTRY_CODES, countryLabel } from "@/lib/i18n/countries";
import type { Locale } from "@/types/database";

/** "id, my, sg" -> ["ID","MY","SG"], de-duplicated, blanks dropped. Mirrors
 * parseTargetCountries() in features/products/actions.ts so a default value
 * coming straight from the DB's stored comma-separated text round-trips. */
function parseCodes(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((c) => c.trim().toUpperCase())
        .filter((c) => /^[A-Z]{2}$/.test(c)),
    ),
  );
}

/**
 * Searchable multi-select for "Target Negara Pemasaran" — shows country
 * names (never asks the user to know an ISO code), selected countries as
 * removable chips, and writes a hidden comma-separated ISO alpha-2 input
 * under `name` so the server action's existing parsing
 * (parseTargetCountries in features/products/actions.ts) is unchanged.
 */
export function CountryMultiSelect({
  name,
  inputId,
  defaultValue,
  locale = "id",
}: {
  name: string;
  inputId?: string;
  defaultValue?: string;
  locale?: Locale;
}) {
  const [selected, setSelected] = useState<string[]>(() => parseCodes(defaultValue ?? ""));
  const [query, setQuery] = useState("");
  const listId = useId();

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return QUICK_PICK_COUNTRY_CODES.filter((code) => !selected.includes(code)).filter((code) => {
      if (!q) return true;
      return countryLabel(code, locale).toLowerCase().includes(q) || code.toLowerCase().includes(q);
    });
  }, [query, selected, locale]);

  // A typed 2-letter code not in the quick-pick list is still accepted —
  // the underlying schema/DB column takes any ISO 3166-1 alpha-2 code (see
  // lib/i18n/countries.ts), this UI just doesn't have every country
  // pre-listed as a search suggestion yet.
  const canAddTypedCode = /^[A-Za-z]{2}$/.test(query.trim()) && !selected.includes(query.trim().toUpperCase());

  function addCode(code: string) {
    const upper = code.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(upper)) return;
    setSelected((prev) => (prev.includes(upper) ? prev : [...prev, upper]));
    setQuery("");
  }

  function removeCode(code: string) {
    setSelected((prev) => prev.filter((c) => c !== code));
  }

  return (
    <div className="flex flex-col gap-2">
      <input type="hidden" name={name} value={selected.join(",")} />

      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((code) => (
            <span
              key={code}
              className="inline-flex items-center gap-1.5 rounded-full border border-brand/30 bg-brand-muted py-1 pl-3 pr-1.5 text-xs font-medium text-brand"
            >
              {countryLabel(code, locale)}
              <button
                type="button"
                onClick={() => removeCode(code)}
                aria-label={`Hapus ${countryLabel(code, locale)}`}
                className="flex size-5 items-center justify-center rounded-full hover:bg-brand/20"
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="relative">
        <input
          id={inputId}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (options[0]) addCode(options[0]);
            else if (canAddTypedCode) addCode(query);
          }}
          placeholder="Cari negara, mis. Indonesia, Malaysia..."
          role="combobox"
          aria-expanded={query.length > 0 && (options.length > 0 || canAddTypedCode)}
          aria-controls={listId}
          className="h-11 w-full rounded-[var(--radius-md)] border border-border-strong bg-surface px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        />
        {query.length > 0 && (options.length > 0 || canAddTypedCode) ? (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-[var(--radius-md)] border border-border-strong bg-surface shadow-[var(--shadow-md)]"
          >
            {options.map((code) => (
              <li key={code} role="option" aria-selected={false}>
                <button
                  type="button"
                  onClick={() => addCode(code)}
                  className="flex min-h-11 w-full items-center justify-between px-3 py-2.5 text-left text-sm text-foreground hover:bg-surface-muted"
                >
                  <span>{countryLabel(code, locale)}</span>
                  <span className="text-xs text-muted-foreground">{code}</span>
                </button>
              </li>
            ))}
            {canAddTypedCode ? (
              <li role="option" aria-selected={false}>
                <button
                  type="button"
                  onClick={() => addCode(query)}
                  className="flex min-h-11 w-full items-center justify-between px-3 py-2.5 text-left text-sm text-foreground hover:bg-surface-muted"
                >
                  <span>Tambahkan kode &ldquo;{query.trim().toUpperCase()}&rdquo;</span>
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Cari dan pilih negara tujuan pemasaran. Kosongkan jika belum ditentukan.
      </p>
    </div>
  );
}
