import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AnthropicProvider } from "@/lib/ai/anthropic-provider";
import { OpenAIProvider } from "@/lib/ai/openai-provider";
import { createSmokeRunner, formatSmokeSummary, validateSmokeConfig } from "@/lib/ai/smoke/strategy-smoke";

/**
 * AI Strategy smoke A: ONE real provider call. Run only by .github/workflows/qa-ai-strategy-smoke.yml.
 * Nothing here prints the key, the model's text or a provider message: only the report from createSmokeRunner
 * (booleans, counts, enum values, error categories). The thrown messages below name variables, never values.
 */
describe("AI Strategy smoke A (REAL provider call, exactly one attempt)", () => {
  it("the provider accepts the PR-5 generation schema and returns a usable proposal", async () => {
    const config = validateSmokeConfig(process.env);
    if (!config.ok) throw new Error(`Smoke refused: ${config.reasons.join("; ")}`);

    const provider = config.provider === "anthropic" ? new AnthropicProvider(config.apiKey) : new OpenAIProvider(config.apiKey);
    const report = await createSmokeRunner({ provider, model: config.model }).run();

    const summary = formatSmokeSummary(report);
    console.log(summary);
    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
    if (summaryFile) appendFileSync(summaryFile, `${summary}\n`);

    expect(report.error).toBeNull();
    expect(report.attempts).toBe(1);
    expect(report.passed).toBe(true);
  });
});
