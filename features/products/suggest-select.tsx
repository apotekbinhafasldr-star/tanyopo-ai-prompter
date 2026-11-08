"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils/cn";

/** Sentinel option value for "Lainnya (ketik sendiri)". Never submitted: the
 * <select> has no `name`, only the hidden input does. */
export const SUGGEST_SELECT_OTHER = "__other__";

const selectClass =
  "h-11 w-full rounded-[var(--radius-md)] border border-border-strong bg-surface px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40";

/**
 * Native <select> of suggestions + an "Lainnya (ketik sendiri)" free-text
 * fallback, replacing <input list>/<datalist>. A datalist popup is drawn by the
 * browser and Chrome for Android does not open the full list from its arrow, so
 * on a phone the user could only type. A native <select> opens the system
 * picker on every platform.
 *
 * Submission contract is unchanged: one value under `name`, as free text (the
 * column is free text — see schemas/products.ts). It is carried by a hidden
 * input, so the server action keeps reading `formData.get(name)` as before.
 *
 * - A defaultValue that is not among the options (an older or custom value) is
 *   shown in the free-text field, never dropped.
 * - If `options` changes (e.g. a different product type) and the current value
 *   is no longer listed, it is kept as custom text.
 */
export function SuggestSelect({
  id,
  name,
  label,
  options,
  defaultValue = "",
  emptyLabel = "Pilih (opsional)",
  otherLabel = "Lainnya (ketik sendiri)",
  customLabel,
  customPlaceholder,
  maxLength,
  describedBy,
  hideLabel = false,
  className,
}: {
  id: string;
  name: string;
  /** Visible label text (rendered here so the select and label stay paired). */
  label: string;
  options: readonly string[];
  defaultValue?: string | null;
  emptyLabel?: string;
  otherLabel?: string;
  /** Accessible name of the free-text field (screen readers). */
  customLabel: string;
  customPlaceholder?: string;
  maxLength?: number;
  describedBy?: string;
  /** Keep the label for screen readers only (the caller shows its own heading). */
  hideLabel?: boolean;
  className?: string;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [otherMode, setOtherMode] = useState(false);

  const isCustom = otherMode || (value !== "" && !options.includes(value));
  const selectValue = isCustom ? SUGGEST_SELECT_OTHER : value;
  const customId = `${id}-custom`;

  function onSelect(next: string) {
    if (next === SUGGEST_SELECT_OTHER) {
      // Moving from a listed option to "Lainnya" starts a fresh free-text value.
      if (!isCustom) setValue("");
      setOtherMode(true);
      return;
    }
    setOtherMode(false);
    setValue(next);
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id} className={hideLabel ? "sr-only" : undefined}>
        {label}
      </Label>
      <select
        id={id}
        value={selectValue}
        onChange={(e) => onSelect(e.target.value)}
        aria-describedby={describedBy}
        className={selectClass}
      >
        <option value="">{emptyLabel}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        <option value={SUGGEST_SELECT_OTHER}>{otherLabel}</option>
      </select>
      {isCustom && (
        <Input
          id={customId}
          aria-label={customLabel}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={customPlaceholder}
          maxLength={maxLength}
          autoComplete="off"
        />
      )}
      <input type="hidden" name={name} value={value} />
    </div>
  );
}
