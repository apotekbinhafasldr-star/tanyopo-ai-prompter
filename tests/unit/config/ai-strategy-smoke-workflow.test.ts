import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SMOKE_CONFIRM_PHRASE } from "@/lib/ai/smoke/strategy-smoke";

/**
 * Tripwires for .github/workflows/qa-ai-strategy-smoke.yml and the config around it. They read the files as text
 * (no YAML parser is a dependency) and fail if a later edit makes the paid call start automatically, widens what the
 * job can reach, leaks a secret to a step that does not need it, or lets it run outside the protected path.
 */

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const WORKFLOW = ".github/workflows/qa-ai-strategy-smoke.yml";
const raw = read(WORKFLOW);
// Comments are documentation, not behaviour: strip them before looking for forbidden words.
const code = raw
  .split("\n")
  .map((l) => l.replace(/(^|\s)#.*$/, ""))
  .join("\n");

describe("trigger: manual only", () => {
  const onBlock = code.slice(code.indexOf("\non:"), code.indexOf("\npermissions:"));

  it("is started by workflow_dispatch and nothing else", () => {
    expect(onBlock).toMatch(/workflow_dispatch:/);
    for (const trigger of ["push", "pull_request", "pull_request_target", "schedule", "workflow_run", "workflow_call", "repository_dispatch", "release", "issue_comment"]) {
      expect(onBlock, trigger).not.toMatch(new RegExp(`^\\s{2}${trigger}:`, "m"));
    }
    // exactly one top-level trigger key under `on:`
    expect(onBlock.match(/^\s{2}[a-z_]+:/gm)).toHaveLength(1);
  });

  it("requires provider, model and the confirmation phrase as inputs", () => {
    for (const input of ["provider:", "model:", "confirm:"]) expect(onBlock).toContain(input);
    expect((onBlock.match(/required: true/g) ?? []).length).toBe(3);
    expect(onBlock).toMatch(/options:\s*\n\s*- anthropic\s*\n\s*- openai/);
  });

  it("no other workflow can start this one, and CI never runs the smoke config", () => {
    for (const file of readdirSync(path.join(root, ".github/workflows"))) {
      const text = read(`.github/workflows/${file}`);
      if (file !== "qa-ai-strategy-smoke.yml") {
        expect(text, file).not.toContain("vitest.smoke.config");
        expect(text, file).not.toContain("tests/smoke");
        expect(text, file).not.toContain("qa-ai-strategy-smoke");
      }
    }
  });
});

describe("guards on the job", () => {
  it("runs only from main, only when armed, and only with the exact confirmation phrase (same phrase as the code)", () => {
    const ifLine = code.match(/^\s+if: (.*)$/m)?.[1] ?? "";
    expect(ifLine).toContain("github.ref == 'refs/heads/main'");
    expect(ifLine).toContain("vars.AI_SMOKE_ENABLED == 'true'");
    expect(ifLine).toContain(`inputs.confirm == '${SMOKE_CONFIRM_PHRASE}'`);
    expect(SMOKE_CONFIRM_PHRASE).toBe("RUN-AI-STRATEGY-SMOKE-A");
  });

  it("uses the protected QA Environment, a short timeout and one-at-a-time concurrency without cancelling", () => {
    expect(code).toMatch(/^\s+environment: qa-ai-smoke$/m);
    const timeout = Number(code.match(/timeout-minutes: (\d+)/)?.[1]);
    expect(timeout).toBeGreaterThan(0);
    expect(timeout).toBeLessThanOrEqual(15);
    expect(code).toMatch(/concurrency:\s*\n\s+group: qa-ai-strategy-smoke\s*\n\s+cancel-in-progress: false/);
  });

  it("has read-only repository permissions and nothing else", () => {
    expect(code).toMatch(/^permissions:\s*\n\s+contents: read\s*$/m);
    expect(code).not.toMatch(/(write|id-token|packages|pull-requests|actions|checks|deployments):/);
  });

  it("never retries a step and never continues past a failure", () => {
    expect(code).not.toMatch(/continue-on-error/);
    expect(code).not.toMatch(/nick-fields\/retry|retry-action|attempts?:/i);
    expect(code).not.toMatch(/\|\|\s*true/);
  });
});

describe("secrets: one QA credential, only in the smoke step", () => {
  const smokeStepStart = code.indexOf("- name: Smoke AI Strategy");

  it("references only the two QA-specific key secrets", () => {
    const names = [...code.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1]);
    expect(new Set(names)).toEqual(new Set(["QA_AI_SMOKE_ANTHROPIC_API_KEY", "QA_AI_SMOKE_OPENAI_API_KEY"]));
  });

  it("does not use secrets.GITHUB_TOKEN-style or inherited secrets, and no secret is set at job level or before the smoke step", () => {
    expect(code).not.toMatch(/secrets:\s*inherit/);
    expect(smokeStepStart).toBeGreaterThan(0);
    expect(code.slice(0, smokeStepStart)).not.toContain("secrets.");
    expect(code.slice(0, smokeStepStart)).not.toMatch(/^\s{4}env:/m);
  });

  const smokeSteps = code
    .slice(smokeStepStart)
    .split(/^\s{6}- name: /m)
    .filter(Boolean)
    .map((chunk) => `- name: ${chunk}`);

  it("there are exactly two smoke steps, one per provider, each guarded by the provider input", () => {
    expect(smokeSteps).toHaveLength(2);
    expect(smokeSteps[0]).toMatch(/if: \$\{\{ inputs\.provider == 'anthropic' \}\}/);
    expect(smokeSteps[1]).toMatch(/if: \$\{\{ inputs\.provider == 'openai' \}\}/);
  });

  it("each smoke step carries ONLY its own provider's secret (a key can never go to the other vendor)", () => {
    expect([...smokeSteps[0].matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1])).toEqual(["QA_AI_SMOKE_ANTHROPIC_API_KEY"]);
    expect([...smokeSteps[1].matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1])).toEqual(["QA_AI_SMOKE_OPENAI_API_KEY"]);
  });

  it("no expression picks a secret with && / || (the earlier fallback form let a key land on the wrong vendor)", () => {
    for (const line of code.split("\n").filter((l) => l.includes("secrets."))) {
      expect(line, line).not.toMatch(/&&|\|\|/);
    }
  });

  it("each smoke step receives exactly the four AI_SMOKE_* variables and nothing else", () => {
    for (const step of smokeSteps) {
      const envBlock = step.slice(step.indexOf("env:"), step.indexOf("run:"));
      const names = [...envBlock.matchAll(/^\s{10}([A-Z0-9_]+):/gm)].map((m) => m[1]);
      expect(names.sort()).toEqual(["AI_SMOKE_API_KEY", "AI_SMOKE_CONFIRM", "AI_SMOKE_MODEL", "AI_SMOKE_PROVIDER"]);
    }
  });

  it("checkout, setup-node and npm ci get no env or secrets", () => {
    const before = code.slice(0, smokeStepStart);
    expect(before).not.toMatch(/\benv:/);
  });
});

describe("script injection and supply chain", () => {
  it("no run: line interpolates an expression (inputs reach the script only through env)", () => {
    const runLines = code.split("\n").filter((l) => /^\s+(- )?run:/.test(l));
    expect(runLines.length).toBeGreaterThan(0);
    for (const l of runLines) expect(l, l).not.toContain("${{");
  });

  it("every third-party action is pinned to a full 40-character commit SHA", () => {
    const uses = [...code.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u, u).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  });

  it("checkout does not persist credentials", () => {
    expect(code).toMatch(/persist-credentials: false/);
  });

  it("runs the dedicated smoke config, not the normal test suite", () => {
    expect(code).toContain("npx vitest run --config vitest.smoke.config.ts");
  });
});

describe("scope: nothing but the AI provider call", () => {
  it("the workflow never names Supabase, Auth, billing, payment, Netlify, Meta, Resend or the product's own AI variables", () => {
    for (const word of [/supabase/i, /netlify/i, /\bmeta\b/i, /payment/i, /billing/i, /doku/i, /resend/i, /tiktok/i]) {
      expect(code, String(word)).not.toMatch(word);
    }
    expect(code).not.toMatch(/(?<![A-Z_])(OPENAI|ANTHROPIC)_API_KEY/);
    expect(code).not.toMatch(/AI_(DEFAULT|FALLBACK|STRATEGY|STANDARD|FAST|CRITICAL)_/);
  });
});

describe("the normal test run cannot start the paid call", () => {
  it("vitest.config.ts includes tests/unit only", () => {
    const cfg = read("vitest.config.ts");
    expect(cfg).toContain('include: ["tests/unit/**/*.test.{ts,tsx}"]');
    expect(cfg).not.toContain("smoke");
  });

  it("the smoke config includes only tests/smoke, never retries and stops at the first failure", () => {
    const cfg = read("vitest.smoke.config.ts");
    expect(cfg).toContain('include: ["tests/smoke/**/*.smoke.test.ts"]');
    expect(cfg).toMatch(/retry: 0/);
    expect(cfg).toMatch(/bail: 1/);
  });

  it("the real smoke test lives outside tests/unit and is the only file in tests/smoke", () => {
    expect(readdirSync(path.join(root, "tests/smoke"))).toEqual(["ai-strategy.smoke.test.ts"]);
  });

  it("package.json gets no script that runs the smoke", () => {
    expect(read("package.json")).not.toMatch(/smoke/i);
  });
});
