import { z } from "zod";
import {
  isKnownCountryCode,
  resolveMetaObjectivePlan,
  type Check,
  type MetaObjectivePlan,
} from "@/lib/campaigns/meta-launch-preflight";
import { META_UNSUPPORTED_OBJECTIVES } from "@/lib/campaigns/meta-objective-contracts";

/**
 * MetaCampaignSpec (Phase 1A) — the single, validated description of a Meta
 * campaign that both future modes (AI Automatic, Professional) will fill in
 * and that the existing preflight -> approval -> launch pipeline will consume.
 *
 * PURE AND INERT. This module has no network, database, environment, session
 * or connector access, and nothing calls it from the launch path yet. Parsing
 * a spec launches nothing and spends nothing; `checkMetaSpecLaunchable` keeps
 * answering "blocked" for every objective until a contract is `verified`.
 *
 * Safety rules:
 *  - STRICT: unknown keys are rejected at every level (no `status`, `token`,
 *    `adAccountId`, `interests`, ... can ride along).
 *  - ALLOWLISTS only: objective, CTA, currency and country codes are enums or
 *    lookups, never free text. The AI/UI may only choose among them.
 *  - NO COERCION: "50000" is not 50000; NaN/Infinity/floats are rejected.
 *  - Budget is whole IDR. No Meta minor-unit conversion happens here (that,
 *    and the Budget Gate evidence, belong to a later phase).
 *  - Messages are our own Indonesian text and never echo the rejected value.
 */

/** LINOE objectives that have an (unverified) Meta contract. Must equal the keys of META_OBJECTIVE_CONTRACTS (tested). */
export const META_SPEC_OBJECTIVES = ["BRAND_AWARENESS", "WEBSITE_TRAFFIC"] as const;

/**
 * Conservative CTA allowlist for link ads. Not yet confirmed against a live
 * account (that is a later, separately approved phase); extending it is a
 * reviewed code change.
 */
export const META_SPEC_CTAS = ["LEARN_MORE", "SHOP_NOW", "SIGN_UP", "CONTACT_US", "ORDER_NOW"] as const;

export const META_SPEC_MIN_AGE = 18;
export const META_SPEC_MAX_AGE = 65;
export const META_SPEC_MAX_COUNTRIES = 5;
/** Sanity ceiling against typos (an extra zero), NOT a Meta limit and NOT a spending permission. Budget Guard and the Budget Gate still decide. */
export const META_SPEC_MAX_DAILY_BUDGET_IDR = 50_000_000;
export const META_SPEC_MAX_DURATION_DAYS = 365;

const countryCode = z
  .string()
  .regex(/^[A-Z]{2}$/)
  .refine((value) => isKnownCountryCode(value));

export const MetaCampaignSpecSchema = z.strictObject({
  objective: z.enum(META_SPEC_OBJECTIVES),
  targeting: z
    .strictObject({
      countries: z
        .array(countryCode)
        .min(1)
        .max(META_SPEC_MAX_COUNTRIES)
        .refine((list) => new Set(list).size === list.length),
      ageMin: z.number().int().min(META_SPEC_MIN_AGE).max(META_SPEC_MAX_AGE),
      ageMax: z.number().int().min(META_SPEC_MIN_AGE).max(META_SPEC_MAX_AGE),
    })
    .refine((t) => t.ageMin <= t.ageMax, { path: ["ageMax"] }),
  cta: z.enum(META_SPEC_CTAS),
  budget: z.strictObject({
    currency: z.literal("IDR"),
    dailyBudget: z.number().int().min(1).max(META_SPEC_MAX_DAILY_BUDGET_IDR),
    durationDays: z.number().int().min(1).max(META_SPEC_MAX_DURATION_DAYS).optional(),
  }),
});

export type MetaCampaignSpec = z.infer<typeof MetaCampaignSpecSchema>;

export type MetaSpecFailureCode =
  | "OBJECTIVE_UNSUPPORTED"
  | "OBJECTIVE_INVALID"
  | "TARGETING_INVALID"
  | "CTA_INVALID"
  | "BUDGET_INVALID"
  | "SPEC_INVALID";

export type MetaSpecParseResult =
  | { ok: true; spec: MetaCampaignSpec }
  | { ok: false; code: MetaSpecFailureCode; message: string; fields: string[] };

const MESSAGES: Record<Exclude<MetaSpecFailureCode, "OBJECTIVE_UNSUPPORTED">, string> = {
  OBJECTIVE_INVALID: "Objective campaign tidak dikenali. Spesifikasi campaign ditolak.",
  TARGETING_INVALID:
    "Targeting tidak valid: gunakan 1–5 kode negara yang dikenal, umur 18–65, dan umur minimum tidak melebihi umur maksimum.",
  CTA_INVALID: "Tombol ajakan (CTA) tidak ada dalam daftar yang diizinkan.",
  BUDGET_INVALID: "Budget tidak valid: gunakan mata uang IDR dan bilangan bulat positif dalam batas yang diizinkan.",
  SPEC_INVALID: "Spesifikasi campaign tidak valid atau memuat isian yang tidak dikenal.",
};

const has = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key);

function readObjective(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
  return has(input, "objective") ? (input as Record<string, unknown>).objective : undefined;
}

/** Never throws, never echoes input values. */
export function parseMetaCampaignSpec(input: unknown): MetaSpecParseResult {
  const parsed = MetaCampaignSpecSchema.safeParse(input);
  if (parsed.success) return { ok: true, spec: parsed.data };

  const issues = parsed.error.issues;
  const fields = Array.from(new Set(issues.map((issue) => issue.path.map(String).join(".") || "(spesifikasi)")));
  const top = issues[0]?.path[0];

  if (top === "objective") {
    const objective = readObjective(input);
    if (typeof objective === "string" && has(META_UNSUPPORTED_OBJECTIVES, objective)) {
      return {
        ok: false,
        code: "OBJECTIVE_UNSUPPORTED",
        message: META_UNSUPPORTED_OBJECTIVES[objective] ?? MESSAGES.OBJECTIVE_INVALID,
        fields,
      };
    }
    return { ok: false, code: "OBJECTIVE_INVALID", message: MESSAGES.OBJECTIVE_INVALID, fields };
  }
  if (top === "targeting") return { ok: false, code: "TARGETING_INVALID", message: MESSAGES.TARGETING_INVALID, fields };
  if (top === "cta") return { ok: false, code: "CTA_INVALID", message: MESSAGES.CTA_INVALID, fields };
  if (top === "budget") return { ok: false, code: "BUDGET_INVALID", message: MESSAGES.BUDGET_INVALID, fields };
  return { ok: false, code: "SPEC_INVALID", message: MESSAGES.SPEC_INVALID, fields };
}

/**
 * Whether a VALID spec may be launched on Meta. Delegates to the one existing
 * decision point (`resolveMetaObjectivePlan`), so it is blocked for every
 * objective while its contract is `verified: false` — which is every objective
 * today, including WEBSITE_TRAFFIC. Adds no new way to launch.
 */
export function checkMetaSpecLaunchable(spec: MetaCampaignSpec): Check<MetaObjectivePlan> {
  return resolveMetaObjectivePlan(spec.objective);
}
