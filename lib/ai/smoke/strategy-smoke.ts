import { buildCampaignProposalPrompt, buildSystemPreamble, type CampaignProposalInputs } from "@/lib/ai/prompts";
import { evaluateCampaignQuality } from "@/lib/ai/campaign-quality-gate";
import { AIProviderError, type AIErrorCategory, type AIProvider } from "@/lib/ai/provider";
import { AI_REQUEST_TIMEOUT_MS, callWithResilience } from "@/lib/ai/resilience";
import {
  CampaignProposalGenerationSchema,
  CampaignProposalSchema,
  normalizeProposalAdditions,
  withPrimaryCandidate,
  withRecommendedChannels,
} from "@/schemas/ai/campaign-proposal";
import { PROPOSAL_OBJECTIVE_VALUES } from "@/schemas/ai/proposal-objectives";

/**
 * AI Strategy smoke test, stage A (LINOE): ONE real structured-generation call against ONE provider, using the SAME
 * schema (CampaignProposalGenerationSchema), the SAME prompt builders and the SAME provider adapters as the product
 * (the adapters are what serialise the Zod schema for the provider), so a pass proves that provider accepts what the
 * product sends. Nothing else is touched: no Supabase, no Auth, no billing, no Netlify, no Meta, no tenant, no quota.
 *
 * This module is pure apart from the provider call that is handed to it. It never reads process.env except through
 * validateSmokeConfig(env), which the caller passes an env object. It never prints anything and the report it returns
 * contains only booleans, counts, enum values and error CATEGORIES — never the key, the model's text or a provider message.
 */

export const SMOKE_CONFIRM_PHRASE = "RUN-AI-STRATEGY-SMOKE-A";
export const SMOKE_PROVIDERS = ["anthropic", "openai"] as const;
export type SmokeProvider = (typeof SMOKE_PROVIDERS)[number];

/** Same ceiling the adapters use by default in the product. */
export const SMOKE_MAX_TOKENS = 4000;
/** Hard limit: one attempt, ever. No retry (maxRetries 0 here, SDK retries are off in the adapters), no fallback provider. */
export const SMOKE_MAX_ATTEMPTS = 1;

/**
 * Names that must NOT be present in the smoke environment. The smoke gets exactly one credential (AI_SMOKE_API_KEY);
 * if any product/production variable is present the run is refused, so it can never silently use or reach them.
 */
const FORBIDDEN_EXACT = new Set([
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "AI_DEFAULT_PROVIDER",
  "AI_FALLBACK_PROVIDER",
  "AI_OPENAI_DEFAULT_MODEL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "TOKEN_ENCRYPTION_KEY",
  "JOBS_PROCESSOR_SECRET",
  "DEMO_SESSION_SECRET",
  "UMKMPRO_SERVICE_TOKEN",
  "ALERT_EMAIL_ENABLED",
  "ALERT_EMAIL_FROM",
]);
const FORBIDDEN_PREFIXES = [
  "SUPABASE_",
  "PAYMENT_",
  "META_",
  "TIKTOK_",
  "X_CLIENT_",
  "X_REDIRECT_",
  "NETLIFY_",
  "RESEND_",
  "AI_STRATEGY_",
  "AI_STANDARD_",
  "AI_FAST_",
  "AI_CRITICAL_",
  "QA_SUPABASE_",
  "DOKU_",
];

export type SmokeConfigResult =
  | { ok: true; provider: SmokeProvider; model: string; apiKey: string }
  | { ok: false; reasons: string[] };

/**
 * Validates the smoke environment. `reasons` are fixed strings that name variables only — never a value — so they are safe to print.
 * The model must be given explicitly: there is no default, because a default model would silently decide the cost of the run.
 */
export function validateSmokeConfig(env: Readonly<Record<string, string | undefined>>): SmokeConfigResult {
  const reasons: string[] = [];

  if (env.AI_SMOKE_CONFIRM !== SMOKE_CONFIRM_PHRASE) reasons.push("AI_SMOKE_CONFIRM is missing or wrong");

  const provider = (env.AI_SMOKE_PROVIDER ?? "").trim();
  if (!(SMOKE_PROVIDERS as readonly string[]).includes(provider)) reasons.push("AI_SMOKE_PROVIDER must be anthropic or openai");

  const model = (env.AI_SMOKE_MODEL ?? "").trim();
  if (!model) reasons.push("AI_SMOKE_MODEL is required (no default model, so the cost is chosen explicitly)");
  else if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(model)) reasons.push("AI_SMOKE_MODEL has an invalid format");

  const apiKey = (env.AI_SMOKE_API_KEY ?? "").trim();
  if (!apiKey) reasons.push("AI_SMOKE_API_KEY is missing");
  // Wrong-vendor guard: a key must never be sent to the other vendor. Anthropic keys start with "sk-ant-"; an OpenAI key never does.
  // Only the shape is checked and nothing about the key is ever printed.
  else if (provider === "anthropic" && !apiKey.startsWith("sk-ant-")) reasons.push("AI_SMOKE_API_KEY does not look like an Anthropic key");
  else if (provider === "openai" && apiKey.startsWith("sk-ant-")) reasons.push("AI_SMOKE_API_KEY looks like an Anthropic key but the provider is openai");

  const forbidden = Object.keys(env)
    .filter((name) => (env[name] ?? "") !== "")
    .filter((name) => FORBIDDEN_EXACT.has(name) || FORBIDDEN_PREFIXES.some((p) => name.startsWith(p)))
    .sort();
  if (forbidden.length > 0) reasons.push(`Product/production variables must not be present: ${forbidden.join(", ")}`);

  if (reasons.length > 0) return { ok: false, reasons };
  return { ok: true, provider: provider as SmokeProvider, model, apiKey };
}

// ── Fixed, non-sensitive fixture (a fictional product; nothing from any tenant) ─────────────────────────────

export const SMOKE_PRODUCT = {
  name: "Kopi Susu Aren Contoh LINOE",
  product_type: "PHYSICAL",
  category: "Minuman",
  description: "Minuman kopi susu gula aren dalam botol 250 ml, dijual lewat toko online.",
  price: 18000,
  currency: "IDR",
  website_url: null,
  target_countries: ["ID"],
} as never;

export const SMOKE_BRAND_PROFILE = { brand_name: "LINOE QA Contoh", default_language: "id" } as never;

export const SMOKE_INPUTS: CampaignProposalInputs = {
  objective: "WEBSITE_TRAFFIC",
  channels: ["FACEBOOK", "INSTAGRAM"],
  targetCountry: "ID",
  targetRegion: null,
  targetCity: null,
  audienceNotes: null,
  dailyBudget: 50000,
  totalBudget: null,
  currency: "IDR",
};

/** example.com is reserved for documentation; the model is told never to repeat a URL anyway. */
export const SMOKE_DESTINATION = { type: "WEBSITE", host: "example.com" } as const;

export function buildSmokePrompts(): { system: string; prompt: string } {
  return {
    system: buildSystemPreamble(SMOKE_BRAND_PROFILE),
    prompt: buildCampaignProposalPrompt(SMOKE_PRODUCT, SMOKE_INPUTS, SMOKE_DESTINATION),
  };
}

// ── Report ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface SmokeChecks {
  /** The provider returned a result that passed the strict generation schema (the adapter throws otherwise). */
  providerAcceptedSchema: boolean;
  /** After normalizeProposalAdditions(), the STORED schema accepts it. */
  storedSchemaValid: boolean;
  candidatesCount: number;
  objectiveRecommendationValid: boolean;
  audiencePresent: boolean;
  /**
   * Informational: the provider's RAW interest_suggestions_text (before normalizeProposalAdditions) held no numeric-only,
   * Meta-ID-like entry. Not a pass criterion: the product repairs it in code; this only shows how the model behaved.
   */
  rawInterestsAreText: boolean;
  missingFactsIsArray: boolean;
  testPlanPresent: boolean;
  /** No URL or phone-like number in the active copy: this file's pattern AND the quality gate's URL_IN_COPY / PHONE_IN_COPY. */
  copyHasNoUrlOrPhone: boolean;
}

export interface SmokeReport {
  /** True only if every strict check passed and exactly one attempt was made. The quality-gate outcome is informational. */
  passed: boolean;
  provider: string | null;
  /** The model id the provider reports having used. */
  model: string | null;
  attempts: number;
  tokensInput: number | null;
  tokensOutput: number | null;
  checks: SmokeChecks | null;
  /** Quality gate over the ACTIVE copy, the way submit enforces it. Informational for this smoke. */
  gate: { status: string; score: number; blocking: boolean; issueCodes: string[] } | null;
  /**
   * Set only when the call failed: a coarse category, an HTTP status and, for a non-provider error (e.g. an SDK parse error),
   * the error CLASS name only when it is a plain identifier. Never a message, so nothing the provider or model wrote.
   */
  error: { category: AIErrorCategory | "UNKNOWN"; status: number | null; name: string | null } | null;
}

// A URL, a bare domain, an Indonesian mobile number or any 10+ digit run. Prices such as "Rp18.000 - 25.000" must NOT match.
const URL_OR_PHONE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|co\.id|id|net|org|io)\b|(\+62|\b0)[\s-]?8\d[\d\s-]{6,12}\d|\b\d{10,}\b)/i;

function activeCopy(p: { hook: string; headline: string; primary_text: string; cta: string }): string {
  return [p.hook, p.headline, p.primary_text, p.cta].join("\n");
}

function emptyReport(partial: Partial<SmokeReport>): SmokeReport {
  return {
    passed: false,
    provider: null,
    model: null,
    attempts: 0,
    tokensInput: null,
    tokensOutput: null,
    checks: null,
    gate: null,
    error: null,
    ...partial,
  };
}

export interface SmokeRunner {
  run(): Promise<SmokeReport>;
}

/**
 * Creates a runner that can run exactly ONCE. A second run() throws before any provider call.
 * The provider is injected so the unit tests drive it with a fake and the real smoke passes the product adapter.
 */
export function createSmokeRunner(deps: { provider: AIProvider; model: string; timeoutMs?: number }): SmokeRunner {
  let used = false;
  return {
    async run(): Promise<SmokeReport> {
      if (used) throw new Error("The AI smoke runner is single-use: a second attempt is refused.");
      used = true;

      const { system, prompt } = buildSmokePrompts();
      let attempts = 0;

      let result;
      try {
        result = await callWithResilience(
          (signal) => {
            attempts += 1;
            if (attempts > SMOKE_MAX_ATTEMPTS) {
              // Unreachable with maxRetries 0; kept as a hard stop so a future change cannot add a second paid call unnoticed.
              throw new AIProviderError("attempt limit", "CONFIG");
            }
            return deps.provider.generateStructured(CampaignProposalGenerationSchema, {
              system,
              prompt,
              model: deps.model,
              maxTokens: SMOKE_MAX_TOKENS,
              signal,
            });
          },
          { maxRetries: 0, timeoutMs: deps.timeoutMs ?? AI_REQUEST_TIMEOUT_MS },
        );
      } catch (err) {
        const category: AIErrorCategory | "UNKNOWN" = err instanceof AIProviderError ? err.category : "UNKNOWN";
        const status = err instanceof AIProviderError && typeof err.status === "number" ? err.status : null;
        const rawName = err instanceof Error && !(err instanceof AIProviderError) ? err.name : "";
        const name = /^[A-Za-z]{1,40}$/.test(rawName) ? rawName : null;
        return emptyReport({ provider: deps.provider.name, attempts, error: { category, status, name } });
      }

      const normalized = normalizeProposalAdditions(result.data);
      const stored = CampaignProposalSchema.safeParse(normalized);
      const proposal = withRecommendedChannels(withPrimaryCandidate(normalized));

      const gateResult = evaluateCampaignQuality(proposal, {
        productName: (SMOKE_PRODUCT as { name: string }).name,
        knownFacts: (SMOKE_PRODUCT as { description: string }).description,
        copyScope: "active",
      });

      const checks: SmokeChecks = {
        providerAcceptedSchema: true,
        storedSchemaValid: stored.success,
        candidatesCount: Array.isArray(proposal.candidates) ? proposal.candidates.length : 0,
        objectiveRecommendationValid:
          proposal.objective_recommendation == null ||
          (PROPOSAL_OBJECTIVE_VALUES as readonly string[]).includes(proposal.objective_recommendation),
        audiencePresent: proposal.audience != null,
        rawInterestsAreText: (result.data.audience?.interest_suggestions_text ?? []).every((i) => !/^\d+$/.test(String(i).trim())),
        missingFactsIsArray: Array.isArray(proposal.missing_facts) || proposal.missing_facts == null,
        testPlanPresent: proposal.test_plan != null,
        copyHasNoUrlOrPhone:
          !URL_OR_PHONE.test(activeCopy(proposal)) && !gateResult.issues.some((i) => i.code === "URL_IN_COPY" || i.code === "PHONE_IN_COPY"),
      };

      const passed =
        attempts === SMOKE_MAX_ATTEMPTS &&
        checks.providerAcceptedSchema &&
        checks.storedSchemaValid &&
        checks.candidatesCount === 3 &&
        checks.objectiveRecommendationValid &&
        checks.missingFactsIsArray &&
        checks.copyHasNoUrlOrPhone;

      return {
        passed,
        provider: result.provider,
        model: result.model,
        attempts,
        tokensInput: result.tokensInput,
        tokensOutput: result.tokensOutput,
        checks,
        gate: {
          status: gateResult.status,
          score: gateResult.score,
          blocking: gateResult.issues.some((i) => i.severity === "block"),
          issueCodes: [...new Set(gateResult.issues.map((i) => i.code))].sort(),
        },
        error: null,
      };
    },
  };
}

/** Markdown for the job summary: numbers, booleans and codes only. */
export function formatSmokeSummary(report: SmokeReport): string {
  const lines = [
    "## AI Strategy smoke A",
    "",
    `- Result: **${report.passed ? "PASS" : "FAIL"}**`,
    `- Provider: ${report.provider ?? "-"} | Model reported: ${report.model ?? "-"}`,
    `- Attempts: ${report.attempts} (limit ${SMOKE_MAX_ATTEMPTS}, no retry, no fallback)`,
    `- Tokens in/out: ${report.tokensInput ?? "-"} / ${report.tokensOutput ?? "-"}`,
  ];
  if (report.error) {
    lines.push(
      `- Error category: ${report.error.category}${report.error.status ? ` (HTTP ${report.error.status})` : ""}${report.error.name ? `, class ${report.error.name}` : ""}`,
    );
  }
  if (report.checks) {
    lines.push("", "| Check | Value |", "|---|---|");
    for (const [k, v] of Object.entries(report.checks)) lines.push(`| ${k} | ${String(v)} |`);
  }
  if (report.gate) {
    lines.push(
      "",
      `- Quality gate (active copy, informational): ${report.gate.status}, score ${report.gate.score}, blocking=${report.gate.blocking}, issues=[${report.gate.issueCodes.join(", ")}]`,
    );
  }
  lines.push(
    "",
    report.passed
      ? "_Evidence class: REAL (one provider call; the provider accepted the schema). Not a quota, billing or database test._"
      : "_REAL attempt, but NOT proof that the provider accepts the schema. Do not rerun automatically; report the category above._",
  );
  return lines.join("\n");
}
