import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AnthropicProvider } from "@/lib/ai/anthropic-provider";
import { OpenAIProvider } from "@/lib/ai/openai-provider";
import { createSmokeRunner, formatSmokeSummary, validateSmokeConfig } from "@/lib/ai/smoke/strategy-smoke";

/**
 * AI Strategy smoke A: ONE real provider call. Run only by .github/workflows/qa-ai-strategy-smoke.yml.
 * Nothing here prints the key, the model's text or a provider message: only the report from createSmokeRunner
 * (booleans, counts, enum values, error categories). The thrown messages below are FIXED text or variable names, never values,
 * and every failure leaves this test as a fixed-text Error so vitest cannot print a provider/SDK message or stack.
 */
function writeSummary(text: string): void {
  console.log(text);
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile) return;
  try {
    appendFileSync(summaryFile, `${text}\n`);
  } catch {
    // The console copy above is enough; never let a summary-file problem hide the verdict.
  }
}

describe("AI Strategy smoke A (REAL provider call, exactly one attempt)", () => {
  it("the provider accepts the PR-5 generation schema and returns a usable proposal", async () => {
    const config = validateSmokeConfig(process.env);
    if (!config.ok) throw new Error(`Smoke refused: ${config.reasons.join("; ")}`);

    let passed = false;
    try {
      const provider = config.provider === "anthropic" ? new AnthropicProvider(config.apiKey) : new OpenAIProvider(config.apiKey);
      const report = await createSmokeRunner({ provider, model: config.model }).run();
      writeSummary(formatSmokeSummary(report));
      passed = report.passed && report.error === null && report.attempts === 1;
    } catch (err) {
      // Only the class name, and only when it is a plain identifier. Never the message or stack.
      const name = err instanceof Error && /^[A-Za-z]{1,40}$/.test(err.name) ? err.name : "unknown";
      writeSummary(`## AI Strategy smoke A: FAIL\n- The smoke harness itself threw (class ${name}). Details are withheld on purpose.`);
    }

    expect(passed, "smoke did not pass (see the summary; details are withheld on purpose)").toBe(true);
  });
});
