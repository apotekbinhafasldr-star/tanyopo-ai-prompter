"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { updateGlobalPreferencesAction, type SettingsActionState } from "@/features/settings/actions";
import { QUICK_PICK_COUNTRY_CODES, countryLabel } from "@/lib/i18n/countries";
import { listTimezones } from "@/lib/i18n/timezones";
import { SUPPORTED_CURRENCIES } from "@/schemas/global-preferences";
import type { Dictionary } from "@/lib/i18n/dictionary";
import type { Locale } from "@/types/database";

const initialState: SettingsActionState = { error: null };

const selectClass =
  "h-10 rounded-[var(--radius-md)] border border-border-strong bg-surface px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40";

export function GlobalPreferencesForm({
  countryCode,
  language,
  timezone,
  currency,
  dictionary,
  readOnly,
}: {
  countryCode: string;
  language: Locale;
  timezone: string;
  currency: string;
  dictionary: Dictionary;
  readOnly: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateGlobalPreferencesAction, initialState);
  const timezones = listTimezones();

  if (readOnly) {
    return (
      <p className="text-xs text-muted-foreground">
        {countryLabel(countryCode, language)} · {language === "en" ? "English" : "Bahasa Indonesia"} · {timezone} ·{" "}
        {currency}
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="countryCode">{dictionary.onboarding.countryLabel}</Label>
          <select id="countryCode" name="countryCode" defaultValue={countryCode} className={selectClass}>
            {QUICK_PICK_COUNTRY_CODES.map((code) => (
              <option key={code} value={code}>
                {countryLabel(code, language)}
              </option>
            ))}
            {!QUICK_PICK_COUNTRY_CODES.includes(countryCode as (typeof QUICK_PICK_COUNTRY_CODES)[number]) ? (
              <option value={countryCode}>{countryLabel(countryCode, language)}</option>
            ) : null}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="language">{dictionary.settings.languageTitle}</Label>
          <select id="language" name="language" defaultValue={language} className={selectClass}>
            <option value="id">Bahasa Indonesia</option>
            <option value="en">English</option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="timezone">{dictionary.onboarding.timezoneLabel}</Label>
          <select id="timezone" name="timezone" defaultValue={timezone} className={selectClass}>
            {!timezones.includes(timezone) ? <option value={timezone}>{timezone}</option> : null}
            {timezones.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="currency">{dictionary.onboarding.currencyLabel}</Label>
          <select id="currency" name="currency" defaultValue={currency} className={selectClass}>
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{dictionary.settings.languageDescription}</p>

      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      <div>
        <Button type="submit" size="sm" loading={pending}>
          {dictionary.common.save}
        </Button>
      </div>
    </form>
  );
}
