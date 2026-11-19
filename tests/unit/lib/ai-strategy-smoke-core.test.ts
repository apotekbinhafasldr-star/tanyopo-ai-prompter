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
  classifyFailure,
  createSmokeRunner,
  formatSmokeSummary,
  validateApiKeyShape,
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
    ["rate limit", new AIProviderError("busy", "RATE_LIMIT"), "RATE_LIMIT", null, "RATE_LIMIT"],
    ["connection", new AIProviderError("net", "CONNECTION"), "CONNECTION", null, "CONNECTION_OR_TIMEOUT"],
    ["vendor 503", new AIProviderError("err", "API", 503), "API", 503, "PROVIDER_SERVER_ERROR"],
    ["vendor 529 overloaded", new AIProviderError("err", "API", 529), "API", 529, "PROVIDER_SERVER_ERROR"],
    ["auth", new AIProviderError("denied", "AUTH"), "AUTH", null, "AUTH"],
    ["invalid output", new AIProviderError("bad", "INVALID_OUTPUT"), "INVALID_OUTPUT", null, "OUTPUT_UNUSABLE_CAUSE_UNKNOWN"],
    ["refusal", new AIProviderError("no", "REFUSAL"), "REFUSAL", null, "REFUSAL"],
  ])("a %s failure (even a retryable one) is NOT retried: still one call", async (_n, error, category, status, kind) => {
    const { provider, calls } = fakeProvider(() => {
      throw error;
    });
    const report = await createSmokeRunner({ provider, model: "m" }).run();
    expect(calls).toHaveLength(1);
    expect(report.attempts).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.error).toEqual({ category, status, name: null, kind });
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
    expect(report.error).toEqual({ category: "AUTH", status: 401, name: null, kind: "AUTH" });
  });

  it("a non-provider error (e.g. a TypeError with a message) is reported as UNKNOWN without its text", async () => {
    const { provider } = fakeProvider(() => {
      throw new TypeError(`boom ${SECRET}`);
    });
    const report = await createSmokeRunner({ provider, model: "m" }).run();
    // Only the error CLASS name is kept (useful for an SDK parse error), never its message.
    expect(report.error).toEqual({ category: "UNKNOWN", status: null, name: "TypeError", kind: "UNKNOWN" });
    expect(JSON.stringify(report)).not.toContain(SECRET);
  });

  it("an error whose name is not a plain identifier gets no name at all", async () => {
    const { provider } = fakeProvider(() => {
      const e = new Error("x");
      e.name = `bad name ${SECRET}`;
      throw e;
    });
    const report = await createSmokeRunner({ provider, model: "m" }).run();
    expect(report.error).toEqual({ category: "UNKNOWN", status: null, name: null, kind: "UNKNOWN" });
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

// ── PR-177 hardening regressions (one block per audit finding) ───────────────────────────────────────────
describe("hardening 2: API key validation (official formats only, fail closed, no value ever printed)", () => {
  const pad = "A1b2C3d4E5f6G7h8I9j0";
  it.each([
    ["anthropic", `sk-ant-api03-${pad}`, true],
    ["anthropic", `sk-ant-api99-${pad}`, true], // version segment is NOT assumed
    ["anthropic", `sk-ant-${pad}`, true], // no version segment at all is accepted too
    ["anthropic", `sk-ant-admin01-${pad}`, false], // Admin key (documented prefix)
    ["anthropic", `SK-ANT-ADMIN01-${pad}`.replace("SK-ANT-ADMIN01", "sk-ant-ADMIN01"), false], // case-insensitive Admin check
    ["anthropic", `sk-proj-${pad}`, false], // other vendor
    ["anthropic", `sk-${pad}`, false],
    ["anthropic", "", false],
    ["openai", `sk-proj-${pad}`, true],
    ["openai", `sk-${pad}`, true],
    ["openai", `sk-ant-api03-${pad}`, false], // Anthropic key to OpenAI
    ["openai", `SK-ANT-api03-${pad}`.replace("SK-ANT", "sk-Ant"), false], // case-insensitive wrong-vendor check
    ["openai", `sk-admin-${pad}`, false], // OpenAI Admin key
    ["openai", `pk-${pad}`, false],
    ["openai", "", false],
  ])("%s key: %s -> accepted=%s", (provider, key, accepted) => {
    expect(validateApiKeyShape(provider, key) === null).toBe(accepted);
  });

  it.each([
    ["too short", "sk-ant-short"],
    ["whitespace inside", `sk-ant-api03-${pad} ${pad}`],
    ["trailing newline", `sk-ant-api03-${pad}\n`],
    ["leading space", ` sk-ant-api03-${pad}`],
    ["control character", `sk-ant-api03-${pad}\u0007`],
    ["non-ASCII", `sk-ant-api03-${pad}é`],
    ["absurdly long", `sk-ant-${"a".repeat(600)}`],
  ])("rejects a malformed key (%s) and never echoes it", (_n, key) => {
    const r = validateSmokeConfig({ ...ENV_OK, AI_SMOKE_API_KEY: key });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(key.trim());
    expect(JSON.stringify(r)).not.toContain(pad);
  });

  it("does not trim: a padded provider, model or key is refused instead of silently altered", () => {
    expect(validateSmokeConfig({ ...ENV_OK, AI_SMOKE_PROVIDER: " anthropic" }).ok).toBe(false);
    expect(validateSmokeConfig({ ...ENV_OK, AI_SMOKE_PROVIDER: "anthropic\n" }).ok).toBe(false);
    expect(validateSmokeConfig({ ...ENV_OK, AI_SMOKE_PROVIDER: "Anthropic" }).ok).toBe(false);
    expect(validateSmokeConfig({ ...ENV_OK, AI_SMOKE_MODEL: " some-model-id-1" }).ok).toBe(false);
  });

  it("with an invalid provider the run is refused and the reasons stay value-free", () => {
    const r = validateSmokeConfig({ ...ENV_OK, AI_SMOKE_PROVIDER: "gemini" });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(JSON.stringify(r)).not.toContain("gemini");
  });

  it.each([
    "OPENAI_BASE_URL",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "OPENAI_ORG_ID",
    "HTTPS_PROXY",
    "http_proxy",
    "NODE_OPTIONS",
    "GITHUB_TOKEN",
    "DATABASE_URL",
  ])("refuses when the redirecting/credential variable %s is present", (name) => {
    const r = validateSmokeConfig({ ...ENV_OK, [name]: "https://example.invalid" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.join(" ")).toContain(name);
    expect(JSON.stringify(r)).not.toContain("example.invalid");
  });
});

describe("hardening 3: an exception AFTER the paid call is contained and never leaks", () => {
  it("a bug while checking the answer (here: a getter that throws with a secret) yields a sanitized report, not a raw exception", async () => {
    const poisoned = goodOutput();
    Object.defineProperty(poisoned, "candidates", {
      get() {
        throw new RangeError(`explode ${SECRET}`);
      },
      enumerable: true,
    });
    const { provider, calls } = fakeProvider(() => okResult(poisoned));
    const report = await createSmokeRunner({ provider, model: "m" }).run();
    expect(calls).toHaveLength(1);
    expect(report.passed).toBe(false);
    expect(report.attempts).toBe(1);
    expect(report.error).toEqual({ category: "UNKNOWN", status: null, name: "RangeError", kind: "POST_PROCESSING_ERROR" });
    expect(report.tokensInput).toBe(1500);
    expect(report.tokensOutput).toBe(1200);
    const text = JSON.stringify(report) + formatSmokeSummary(report);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("explode");
    expect(text).toContain("POST_PROCESSING_ERROR");
  });

  it("a post-call failure still uses up the runner (no second paid call)", async () => {
    const poisoned = goodOutput();
    Object.defineProperty(poisoned, "candidates", {
      get() {
        throw new Error("x");
      },
      enumerable: true,
    });
    const { provider, calls } = fakeProvider(() => okResult(poisoned));
    const runner = createSmokeRunner({ provider, model: "m" });
    await runner.run();
    await expect(runner.run()).rejects.toThrow(/single-use/);
    expect(calls).toHaveLength(1);
  });

  it("provider and model strings reported back are kept only if they are plain identifiers (no free text)", async () => {
    const { provider } = fakeProvider(() => ({ ...okResult(), provider: `leak ${SECRET}`, model: "bad model\nwith text" }));
    const report = await createSmokeRunner({ provider, model: "m" }).run();
    expect(report.provider).toBeNull();
    expect(report.model).toBeNull();
    expect(JSON.stringify(report) + formatSmokeSummary(report)).not.toContain(SECRET);
  });

  it("even a hostile result object (getters that throw) cannot make run() throw", async () => {
    const hostile = {
      data: goodOutput(),
      get provider(): string {
        throw new Error(`provider ${SECRET}`);
      },
      get model(): string {
        throw new Error("model");
      },
      get tokensInput(): number {
        throw new Error("tin");
      },
      tokensOutput: 5,
    };
    const { provider } = fakeProvider(() => hostile);
    const report = await createSmokeRunner({ provider, model: "m" }).run();
    expect(report.passed).toBe(false);
    expect(report.error?.kind).toBe("POST_PROCESSING_ERROR");
    expect(report.provider).toBeNull();
    expect(report.tokensInput).toBeNull();
    expect(JSON.stringify(report) + formatSmokeSummary(report)).not.toContain(SECRET);
  });

  it("the real smoke test wraps the run so no raw exception text can reach vitest output", () => {
    const real = readFileSync(path.join(process.cwd(), "tests/smoke/ai-strategy.smoke.test.ts"), "utf8");
    expect(real).toMatch(/try\s*{[\s\S]*createSmokeRunner[\s\S]*}\s*catch/);
    expect(real).toContain("withheld on purpose");
    expect(real).not.toMatch(/\.message|\.stack/);
  });
});

describe("hardening 4: schema rejection vs token cap vs unknown cause (only what the SDK result proves)", () => {
  it.each([
    ["AUTH", null, "AUTH"],
    ["RATE_LIMIT", null, "RATE_LIMIT"],
    ["CONNECTION", null, "CONNECTION_OR_TIMEOUT"],
    ["REFUSAL", null, "REFUSAL"],
    ["CONFIG", null, "CONFIG"],
    ["INVALID_OUTPUT", null, "OUTPUT_UNUSABLE_CAUSE_UNKNOWN"],
    ["API", 400, "PROVIDER_REJECTED_REQUEST_CAUSE_UNKNOWN"],
    ["API", 422, "PROVIDER_REJECTED_REQUEST_CAUSE_UNKNOWN"],
    ["API", 500, "PROVIDER_SERVER_ERROR"],
    ["API", 529, "PROVIDER_SERVER_ERROR"],
    ["API", null, "UNKNOWN"],
    ["UNKNOWN", null, "UNKNOWN"],
  ] as const)("%s (status %s) is classified %s", (category, status, kind) => {
    expect(classifyFailure(category, status)).toBe(kind);
  });

  it("no failure kind is ever named as a proven schema rejection or a proven token cut", () => {
    const kinds = ["AUTH", "RATE_LIMIT", "CONNECTION", "REFUSAL", "CONFIG", "INVALID_OUTPUT", "API", "UNKNOWN"] as const;
    for (const c of kinds) for (const st of [null, 400, 500]) expect(classifyFailure(c, st)).not.toMatch(/SCHEMA|TOKEN|TRUNC/i);
  });

  it("an unproven cause is stated as UNKNOWN in the summary and never as 'schema rejected'", async () => {
    for (const error of [new AIProviderError("m", "INVALID_OUTPUT"), new AIProviderError("m", "API", 400), new TypeError("m")]) {
      const { provider } = fakeProvider(() => {
        throw error;
      });
      const text = formatSmokeSummary(await createSmokeRunner({ provider, model: "m" }).run());
      expect(text).toContain("Cause: **UNKNOWN**");
      expect(text).toContain("Do NOT read it as proof");
      expect(text).not.toMatch(/schema (was )?rejected by the provider|provider rejects the schema/i);
      expect(text).not.toContain("REAL (one provider call");
    }
  });

  it("a clear provider cause (auth) is not labelled UNKNOWN", async () => {
    const { provider } = fakeProvider(() => {
      throw new AIProviderError("m", "AUTH", 401);
    });
    const text = formatSmokeSummary(await createSmokeRunner({ provider, model: "m" }).run());
    expect(text).toContain("Failure kind: AUTH");
    expect(text).not.toContain("Cause: **UNKNOWN**");
  });

  it("success at the 4000-token cap is flagged informationally; below it is not", async () => {
    const atCap = await createSmokeRunner({ provider: fakeProvider(() => ({ ...okResult(), tokensOutput: SMOKE_MAX_TOKENS })).provider, model: "m" }).run();
    expect(atCap.outputAtTokenCap).toBe(true);
    expect(formatSmokeSummary(atCap)).toContain("reached the cap");
    const below = await createSmokeRunner({ provider: fakeProvider(() => okResult()).provider, model: "m" }).run();
    expect(below.outputAtTokenCap).toBe(false);
    expect(formatSmokeSummary(below)).not.toContain("reached the cap");
  });

  it("a failed call has no token-cap claim", async () => {
    const { provider } = fakeProvider(() => {
      throw new AIProviderError("m", "INVALID_OUTPUT");
    });
    expect((await createSmokeRunner({ provider, model: "m" }).run()).outputAtTokenCap).toBeNull();
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
