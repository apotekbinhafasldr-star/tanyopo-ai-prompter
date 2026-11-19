import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AIProviderError, type AIProvider, type StructuredGenerationRequest } from "@/lib/ai/provider";
import { buildCampaignProposalPrompt, buildSystemPreamble } from "@/lib/ai/prompts";
import { CampaignProposalGenerationSchema } from "@/schemas/ai/campaign-proposal";
import {
  SMOKE_BRAND_PROFILE,
  SMOKE_CONFIRM_PHRASE,
  SMOKE_DESTINATION,
  SMOKE_INPUTS,
  SMOKE_MAX_ATTEMPTS,
  SMOKE_MAX_TOKENS,
  SMOKE_PRODUCT,
  buildSmokePrompts,
  createSmokeRunner,
  formatSmokeSummary,
  validateSmokeConfig,
} from "@/lib/ai/smoke/strategy-smoke";
import { KOPI_ROBUSTA_IMPROVED } from "@/tests/fixtures/ai/kopi-robusta-aceh-simulasi";

/**
 * AI Strategy smoke A, offline. Every provider here is a fake: no network, no key, no paid call.
 * These tests prove the harness (one attempt, same schema/prompt as the product, no leaks, strict acceptance criteria);
 * the REAL provider acceptance is proven only by the manual workflow (tests/smoke), never here.
 */

const SECRET = "sk-ant-FAKE-SECRET-VALUE-9f8e7d";

const ENV_OK = {
  AI_SMOKE_CONFIRM: SMOKE_CONFIRM_PHRASE,
  AI_SMOKE_PROVIDER: "anthropic",
  AI_SMOKE_MODEL: "some-model-id-1",
  AI_SMOKE_API_KEY: SECRET,
  CI: "true",
  GITHUB_RUN_ID: "123",
};

describe("validateSmokeConfig", () => {
  it("accepts a complete, explicit configuration", () => {
    const r = validateSmokeConfig(ENV_OK);
    expect(r).toEqual({ ok: true, provider: "anthropic", model: "some-model-id-1", apiKey: SECRET });
  });

  it.each([
    ["wrong confirm phrase", { AI_SMOKE_CONFIRM: "run" }],
    ["missing confirm phrase", { AI_SMOKE_CONFIRM: undefined }],
    ["unknown provider", { AI_SMOKE_PROVIDER: "gemini" }],
    ["missing provider", { AI_SMOKE_PROVIDER: undefined }],
    ["no model (there is no default model)", { AI_SMOKE_MODEL: "" }],
    ["model with spaces/shell characters", { AI_SMOKE_MODEL: "a b; rm -rf" }],
    ["missing key", { AI_SMOKE_API_KEY: "" }],
  ])("refuses: %s", (_name, patch) => {
    const r = validateSmokeConfig({ ...ENV_OK, ...patch });
    expect(r.ok).toBe(false);
  });

  it.each([
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "AI_FALLBACK_PROVIDER",
    "AI_STRATEGY_PROVIDER",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "PAYMENT_PROVIDER_API_KEY",
    "META_APP_SECRET",
    "NETLIFY_AUTH_TOKEN",
    "RESEND_ALERT_API_KEY",
    "TOKEN_ENCRYPTION_KEY",
  ])("refuses to run when the product/production variable %s is present", (name) => {
    const r = validateSmokeConfig({ ...ENV_OK, [name]: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.join(" ")).toContain(name);
  });

  it("never lets a key reach the wrong vendor (shape check, no value printed)", () => {
    const wrongForAnthropic = validateSmokeConfig({ ...ENV_OK, AI_SMOKE_PROVIDER: "anthropic", AI_SMOKE_API_KEY: "sk-proj-FAKE-OPENAI-LOOKING-KEY" });
    expect(wrongForAnthropic.ok).toBe(false);
    const wrongForOpenAi = validateSmokeConfig({ ...ENV_OK, AI_SMOKE_PROVIDER: "openai", AI_SMOKE_API_KEY: "sk-ant-FAKE-ANTHROPIC-LOOKING-KEY" });
    expect(wrongForOpenAi.ok).toBe(false);
    expect(JSON.stringify(wrongForAnthropic) + JSON.stringify(wrongForOpenAi)).not.toContain("FAKE");
    expect(validateSmokeConfig({ ...ENV_OK, AI_SMOKE_PROVIDER: "openai", AI_SMOKE_API_KEY: "sk-proj-FAKE-OPENAI-LOOKING-KEY" }).ok).toBe(true);
  });

  it("an EMPTY forbidden variable does not block (only a present value does)", () => {
    expect(validateSmokeConfig({ ...ENV_OK, OPENAI_API_KEY: "" }).ok).toBe(true);
  });

  it("never puts a value (the key, a forbidden variable's value) in the refusal reasons", () => {
    const r = validateSmokeConfig({
      ...ENV_OK,
      AI_SMOKE_CONFIRM: "wrong",
      AI_SMOKE_MODEL: "bad model",
      SUPABASE_SECRET_KEY: "VALUE-MUST-NOT-APPEAR",
      OPENAI_API_KEY: "ANOTHER-VALUE-MUST-NOT-APPEAR",
    });
    expect(r.ok).toBe(false);
    const text = JSON.stringify(r);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("VALUE-MUST-NOT-APPEAR");
    expect(text).not.toContain("bad model");
  });
});

// ── a schema-valid generation output, as the provider would return it ─────────────────────────────────────
function goodOutput(): Record<string, unknown> {
  return {
    ...JSON.parse(JSON.stringify(KOPI_ROBUSTA_IMPROVED)),
    objective_recommendation: "WEBSITE_TRAFFIC",
    audience: { countries: ["ID"], age_min: 22, age_max: 45, advantage_plus: true, interest_suggestions_text: ["kopi", "minuman botol"] },
    missing_facts: ["Harga promo belum diisi"],
    test_plan: { recommended_variants: [1, 2], min_duration_days: 7, rationale: "Bandingkan dua sudut pandang selama seminggu." },
  };
}

type Call = { schema: unknown; request: StructuredGenerationRequest };

function fakeProvider(impl: (callNumber: number) => unknown): { provider: AIProvider; calls: Call[] } {
  const calls: Call[] = [];
  const provider = {
    name: "fake",
    generateStructured: async (schema: unknown, request: StructuredGenerationRequest) => {
      calls.push({ schema, request });
      return impl(calls.length);
    },
  } as unknown as AIProvider;
  return { provider, calls };
}

const okResult = (data: unknown = goodOutput()) => ({ data, provider: "fake", model: "fake-model-2026", tokensInput: 1500, tokensOutput: 1200 });

describe("the smoke uses the product's own schema and prompt", () => {
  it("passes CampaignProposalGenerationSchema itself (not a copy) and the exact product prompt builders", async () => {
    const { provider, calls } = fakeProvider(() => okResult());
    await createSmokeRunner({ provider, model: "m-1" }).run();

    expect(calls).toHaveLength(1);
    expect(calls[0].schema).toBe(CampaignProposalGenerationSchema);
    expect(calls[0].request.system).toBe(buildSystemPreamble(SMOKE_BRAND_PROFILE));
    expect(calls[0].request.prompt).toBe(buildCampaignProposalPrompt(SMOKE_PRODUCT, SMOKE_INPUTS, SMOKE_DESTINATION));
    expect(buildSmokePrompts()).toEqual({ system: calls[0].request.system, prompt: calls[0].request.prompt });
  });

  it("sends the explicit model and the product's token ceiling, with an abort signal", async () => {
    const { provider, calls } = fakeProvider(() => okResult());
    await createSmokeRunner({ provider, model: "m-explicit" }).run();
    expect(calls[0].request.model).toBe("m-explicit");
    expect(calls[0].request.maxTokens).toBe(SMOKE_MAX_TOKENS);
    expect(SMOKE_MAX_TOKENS).toBe(4000);
    expect(calls[0].request.signal).toBeInstanceOf(AbortSignal);
  });

  it("the fixture is a fictional product with no tenant data and no real contact detail", () => {
    const { system, prompt } = buildSmokePrompts();
    const text = `${system}\n${prompt}`;
    expect(text).toContain("Kopi Susu Aren Contoh LINOE");
    expect(text).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
    expect(text).not.toMatch(/\b\d{10,}\b/);
  });
});

describe("exactly one attempt: no retry, no fallback, single-use runner", () => {
  it("success: one provider call, attempts = 1", async () => {
    const { provider, calls } = fakeProvider(() => okResult());
    const report = await createSmokeRunner({ provider, model: "m" }).run();
    expect(calls).toHaveLength(1);
    expect(report.attempts).toBe(SMOKE_MAX_ATTEMPTS);
    expect(SMOKE_MAX_ATTEMPTS).toBe(1);
    expect(report.passed).toBe(true);
  });

  it.each([
    ["rate limit", new AIProviderError("busy", "RATE_LIMIT"), "RATE_LIMIT", null],
    ["connection", new AIProviderError("net", "CONNECTION"), "CONNECTION", null],
    ["vendor 503", new AIProviderError("err", "API", 503), "API", 503],
    ["vendor 529 overloaded", new AIProviderError("err", "API", 529), "API", 529],
    ["auth", new AIProviderError("denied", "AUTH"), "AUTH", null],
    ["invalid output", new AIProviderError("bad", "INVALID_OUTPUT"), "INVALID_OUTPUT", null],
    ["refusal", new AIProviderError("no", "REFUSAL"), "REFUSAL", null],
  ])("a %s failure (even a retryable one) is NOT retried: still one call", async (_n, error, category, status) => {
    const { provider, calls } = fakeProvider(() => {
      throw error;
    });
    const report = await createSmokeRunner({ provider, model: "m" }).run();
    expect(calls).toHaveLength(1);
    expect(report.attempts).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.error).toEqual({ category, status, name: null });
    expect(report.checks).toBeNull();
  });

  it("a provider that never answers times out after one attempt (category CONNECTION)", async () => {
    const { provider, calls } = fakeProvider(() => new Promise(() => {}));
    const report = await createSmokeRunner({ provider, model: "m", timeoutMs: 30 }).run();
    expect(calls).toHaveLength(1);
    expect(report.error?.category).toBe("CONNECTION");
    expect(report.passed).toBe(false);
  });

  it("the runner is single-use: a second run() is refused BEFORE any provider call", async () => {
    const { provider, calls } = fakeProvider(() => okResult());
    const runner = createSmokeRunner({ provider, model: "m" });
    await runner.run();
    await expect(runner.run()).rejects.toThrow(/single-use/);
    expect(calls).toHaveLength(1);
  });

  it("a failed run still uses up the runner (no second paid call after a failure)", async () => {
    const { provider, calls } = fakeProvider(() => {
      throw new AIProviderError("x", "RATE_LIMIT");
    });
    const runner = createSmokeRunner({ provider, model: "m" });
    await runner.run();
    await expect(runner.run()).rejects.toThrow(/single-use/);
    expect(calls).toHaveLength(1);
  });
});

describe("nothing sensitive reaches the report or the summary", () => {
  it("a provider error message (even one that contains a key) is never copied; only category and status", async () => {
    const { provider } = fakeProvider(() => {
      throw new AIProviderError(`Incorrect API key provided: ${SECRET}`, "AUTH", 401);
    });
    const report = await createSmokeRunner({ provider, model: "m" }).run();
    const text = JSON.stringify(report) + formatSmokeSummary(report);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("Incorrect API key");
    expect(report.error).toEqual({ category: "AUTH", status: 401, name: null });
  });

  it("a non-provider error (e.g. a TypeError with a message) is reported as UNKNOWN without its text", async () => {
    const { provider } = fakeProvider(() => {
      throw new TypeError(`boom ${SECRET}`);
    });
    const report = await createSmokeRunner({ provider, model: "m" }).run();
    // Only the error CLASS name is kept (useful for an SDK parse error), never its message.
    expect(report.error).toEqual({ category: "UNKNOWN", status: null, name: "TypeError" });
    expect(JSON.stringify(report)).not.toContain(SECRET);
  });

  it("an error whose name is not a plain identifier gets no name at all", async () => {
    const { provider } = fakeProvider(() => {
      const e = new Error("x");
      e.name = `bad name ${SECRET}`;
      throw e;
    });
    const report = await createSmokeRunner({ provider, model: "m" }).run();
    expect(report.error).toEqual({ category: "UNKNOWN", status: null, name: null });
    expect(JSON.stringify(report)).not.toContain(SECRET);
  });

  it("the success report and summary contain no model-written text (copy, audience words, missing facts)", async () => {
    const out = goodOutput() as { candidates: { hook: string }[]; audience: { interest_suggestions_text: string[] }; missing_facts: string[] };
    const { provider } = fakeProvider(() => okResult(out));
    const report = await createSmokeRunner({ provider, model: "m" }).run();
    const text = JSON.stringify(report) + formatSmokeSummary(report);
    for (const hook of out.candidates.map((c) => c.hook)) expect(text).not.toContain(hook);
    for (const word of out.audience.interest_suggestions_text) expect(text).not.toContain(word);
    for (const fact of out.missing_facts) expect(text).not.toContain(fact);
  });
});

describe("acceptance criteria (what makes the smoke pass)", () => {
  it("passes for a well-formed result and records provider, reported model and tokens", async () => {
    const { provider } = fakeProvider(() => okResult());
    const report = await createSmokeRunner({ provider, model: "m" }).run();
    expect(report).toMatchObject({
      passed: true,
      provider: "fake",
      model: "fake-model-2026",
      attempts: 1,
      tokensInput: 1500,
      tokensOutput: 1200,
      error: null,
    });
    expect(report.checks).toEqual({
      providerAcceptedSchema: true,
      storedSchemaValid: true,
      candidatesCount: 3,
      objectiveRecommendationValid: true,
      audiencePresent: true,
      rawInterestsAreText: true,
      missingFactsIsArray: true,
      testPlanPresent: true,
      copyHasNoUrlOrPhone: true,
    });
    expect(report.gate).not.toBeNull();
  });

  it("repairs a slightly-off audience in code (swapped ages, numeric 'interest', long list) and still passes; the raw numeric interest is only reported", async () => {
    const out = goodOutput();
    out.audience = {
      countries: ["id", "Indonesia", "SG"],
      age_min: 50,
      age_max: 20,
      advantage_plus: true,
      interest_suggestions_text: ["123456789", "kopi", "  ", "kopi"],
    };
    const { provider } = fakeProvider(() => okResult(out));
    const report = await createSmokeRunner({ provider, model: "m" }).run();
    expect(report.checks?.storedSchemaValid).toBe(true);
    expect(report.checks?.rawInterestsAreText).toBe(false); // informational: how the model behaved, not a pass criterion
    expect(report.passed).toBe(true);
  });

  it("accepts null for every PR-5 field (a model with nothing to add) but then testPlanPresent/audiencePresent are false", async () => {
    const out = { ...goodOutput(), objective_recommendation: null, audience: null, missing_facts: [], test_plan: null };
    const { provider } = fakeProvider(() => okResult(out));
    const report = await createSmokeRunner({ provider, model: "m" }).run();
    expect(report.passed).toBe(true);
    expect(report.checks?.audiencePresent).toBe(false);
    expect(report.checks?.testPlanPresent).toBe(false);
  });

  it("FAILS when the active copy contains a URL, a bare domain or a phone number", async () => {
    for (const bad of ["Kunjungi https://contoh.example/beli", "Beli di tokokopi.com", "Chat 0812 3456 7890", "Hubungi +62 812-3456-7890"]) {
      const out = goodOutput() as { candidates: { primary_text: string }[] };
      out.candidates[0].primary_text = `${bad} sekarang`;
      const { provider } = fakeProvider(() => okResult(out));
      const report = await createSmokeRunner({ provider, model: "m" }).run();
      expect(report.checks?.copyHasNoUrlOrPhone, bad).toBe(false);
      expect(report.passed, bad).toBe(false);
    }
  });

  it("also FAILS on a link/phone form the local pattern misses but the quality gate catches (one definition, not two)", async () => {
    for (const bad of ["Beli di tokokopi.shop sekarang", "Pesan di tokokopi.store sekarang"]) {
      const out = goodOutput() as { candidates: { primary_text: string }[] };
      out.candidates[0].primary_text = bad;
      const { provider } = fakeProvider(() => okResult(out));
      const report = await createSmokeRunner({ provider, model: "m" }).run();
      expect(report.gate?.issueCodes, bad).toContain("URL_IN_COPY");
      expect(report.checks?.copyHasNoUrlOrPhone, bad).toBe(false);
      expect(report.passed, bad).toBe(false);
    }
  });

  it("the summary claims REAL evidence only when the smoke passed", async () => {
    const pass = await createSmokeRunner({ provider: fakeProvider(() => okResult()).provider, model: "m" }).run();
    expect(formatSmokeSummary(pass)).toContain("provider accepted the schema");
    const fail = await createSmokeRunner({
      provider: fakeProvider(() => {
        throw new AIProviderError("denied", "AUTH", 401);
      }).provider,
      model: "m",
    }).run();
    expect(formatSmokeSummary(fail)).toContain("NOT proof that the provider accepts the schema");
    expect(formatSmokeSummary(fail)).not.toContain("provider accepted the schema");
  });

  it("does NOT fail on ordinary prices and ranges", async () => {
    const out = goodOutput() as { candidates: { primary_text: string }[] };
    out.candidates[0].primary_text = "Mulai Rp18.000 sampai Rp25.000 per botol 250 ml, stok terbatas sesuai produksi.";
    const { provider } = fakeProvider(() => okResult(out));
    const report = await createSmokeRunner({ provider, model: "m" }).run();
    expect(report.checks?.copyHasNoUrlOrPhone).toBe(true);
    expect(report.passed).toBe(true);
  });

  it("FAILS when the provider output does not have exactly three candidates", async () => {
    const out = goodOutput() as { candidates: unknown[] };
    out.candidates = out.candidates.slice(0, 2);
    const { provider } = fakeProvider(() => okResult(out));
    const report = await createSmokeRunner({ provider, model: "m" }).run();
    expect(report.checks?.candidatesCount).toBe(2);
    expect(report.passed).toBe(false);
  });

  it("FAILS when objective_recommendation is outside the allowed list", async () => {
    const out = { ...goodOutput(), objective_recommendation: "MAKE_MONEY_FAST" };
    const { provider } = fakeProvider(() => okResult(out));
    const report = await createSmokeRunner({ provider, model: "m" }).run();
    expect(report.checks?.objectiveRecommendationValid).toBe(false);
    expect(report.passed).toBe(false);
  });

  it("reports the quality gate over the active copy but does not fail the smoke because of it", async () => {
    const out = goodOutput() as { candidates: { hook: string }[] };
    out.candidates[0].hook = "Pasti cuan setiap hari";
    const { provider } = fakeProvider(() => okResult(out));
    const report = await createSmokeRunner({ provider, model: "m" }).run();
    expect(report.gate?.blocking).toBe(true);
    expect(report.gate?.issueCodes).toContain("FINANCIAL_CLAIM");
    // The gate worked on the output; the smoke's question (does the provider accept the schema?) is still answered.
    expect(report.passed).toBe(true);
  });
});

describe("module hygiene: the smoke core cannot reach anything but the AI code it exercises", () => {
  const source = readFileSync(path.join(process.cwd(), "lib/ai/smoke/strategy-smoke.ts"), "utf8");
  const imports = [...source.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);

  it("imports only the pure AI modules, schemas and the fixed gate", () => {
    expect(imports.sort()).toEqual(
      [
        "@/lib/ai/campaign-quality-gate",
        "@/lib/ai/prompts",
        "@/lib/ai/provider",
        "@/lib/ai/resilience",
        "@/schemas/ai/campaign-proposal",
        "@/schemas/ai/proposal-objectives",
      ].sort(),
    );
  });

  it("does not read the environment, the network, the filesystem or print anything", () => {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/process\.env/);
    expect(code).not.toMatch(/\bfetch\(/);
    expect(code).not.toMatch(/console\./);
    expect(code).not.toMatch(/node:fs|child_process/);
  });

  it("the real smoke test builds the product adapters and the runner, with no schema of its own", () => {
    const real = readFileSync(path.join(process.cwd(), "tests/smoke/ai-strategy.smoke.test.ts"), "utf8");
    expect(real).toContain('from "@/lib/ai/anthropic-provider"');
    expect(real).toContain('from "@/lib/ai/openai-provider"');
    expect(real).toContain("createSmokeRunner");
    expect(real).not.toMatch(/from "zod"/);
    expect(real).not.toMatch(/z\.object|z\.strictObject/);
    expect(real).not.toMatch(/\.env\.(OPENAI|ANTHROPIC|SUPABASE)/);
    expect(real).not.toMatch(/router|supabase|netlify/i);
  });
});
