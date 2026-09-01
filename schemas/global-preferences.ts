import { z } from "zod";

/**
 * Initial supported currencies (product spec §5) — architecture allows
 * more ISO-4217 codes later, this is just what's offered in the picker
 * today. Never mixed without an explicit code; see lib/billing/success-fee.ts
 * and lib/fx/convert.ts for where currency-awareness matters most.
 */
export const SUPPORTED_CURRENCIES = ["IDR", "USD", "MYR", "SGD", "EUR", "GBP", "AUD"] as const;

/**
 * ISO 3166-1 alpha-2 shape only (not an enum of every country) — a
 * regex keeps this maintenance-free and never blocks a real country
 * this app just doesn't have a display label for yet. See
 * lib/i18n/countries.ts for the (deliberately non-exhaustive) label map
 * used for rendering.
 */
const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "Kode negara harus 2 huruf (ISO 3166-1 alpha-2).");

export const globalPreferencesSchema = z.object({
  countryCode: countryCodeSchema,
  language: z.enum(["id", "en"]),
  timezone: z.string().trim().min(1),
  currency: z.enum(SUPPORTED_CURRENCIES),
  // Campaign target market is optional and independent of the business
  // home market above (product spec §8) — blank means "same as home market".
  targetMarketCountryCode: z.union([countryCodeSchema, z.literal("")]).optional(),
});

export type GlobalPreferencesInput = z.infer<typeof globalPreferencesSchema>;
