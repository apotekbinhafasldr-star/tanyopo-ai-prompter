import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tripwire for the diagnostic workflow: it must stay manual, secret-free, cost-free and unable to print the raw values.
 * Read as text (no YAML parser dependency). Comments are stripped before looking for behaviour.
 */
const raw = readFileSync(path.join(process.cwd(), ".github/workflows/qa-ai-smoke-diagnose.yml"), "utf8");
const code = raw
  .split("\n")
  .map((l) => l.replace(/(^|\s)#.*$/, ""))
  .join("\n");

describe("qa-ai-smoke-diagnose workflow", () => {
  it("is workflow_dispatch only", () => {
    const onBlock = code.slice(code.indexOf("\non:"), code.indexOf("\npermissions:"));
    expect(onBlock).toMatch(/workflow_dispatch:/);
    expect(onBlock.match(/^\s{2}[a-z_]+:/gm)).toHaveLength(1);
  });

  it("has no job-level if, a single job, and contents: none", () => {
    expect(code).toMatch(/^permissions:\s*\n\s+contents: none\s*$/m);
    expect(code.match(/^\s{2}[a-z0-9_-]+:\s*$/gm)?.filter((l) => /^\s{2}diagnose:/.test(l))).toHaveLength(1);
    expect(code.match(/^\s{4}if:/gm)).toBeNull();
    expect(code.match(/^\s{4}[a-z-]+:/gm)?.some((l) => l.trim().startsWith("environment"))).toBeFalsy();
  });

  it("uses no secret, Environment, checkout, npm, API call or third-party action", () => {
    expect(code).not.toMatch(/secrets\./);
    expect(code).not.toMatch(/\benvironment:/);
    expect(code).not.toMatch(/\buses:/);
    expect(code).not.toMatch(/\b(npm|npx|vitest|node|curl|wget)\b/);
    expect(code).not.toMatch(/supabase|netlify|openai|anthropic|payment|meta\b/i);
  });

  it("mirrors the three terms of the smoke if exactly", () => {
    expect(code).toContain("REF_OK: ${{ github.ref == 'refs/heads/main' }}");
    expect(code).toContain("VAR_OK: ${{ vars.AI_SMOKE_ENABLED == 'true' }}");
    expect(code).toContain("CONFIRM_OK: ${{ inputs.confirm == 'RUN-AI-STRATEGY-SMOKE-A' }}");
  });

  it("raw values reach the script only through env and are never printed", () => {
    const runLines = code.split("\n").filter((l) => /^\s+run:/.test(l));
    expect(runLines.length).toBeGreaterThan(0);
    expect(code.slice(code.indexOf("run: |"))).not.toContain("${{");
    for (const name of ["VAR_RAW", "CONFIRM_RAW"]) {
      const uses = [...code.matchAll(new RegExp(`.*\\$\\{?#?${name}.*`, "g"))].map((m) => m[0]);
      for (const line of uses) expect(line, line).toMatch(/\$\{#|printf '%s' "\$\w+" \| wc -c/);
    }
  });

  it("has no command that could dump the environment or trace values", () => {
    expect(code).not.toMatch(/\b(printenv|declare|set -x)\b|export -p|^\s*env\s*$/m);
    expect(code).not.toMatch(/echo[^\n]*\$\{?(VAR_RAW|CONFIRM_RAW)\b/);
  });

  it("does not touch the smoke workflow or its files", () => {
    expect(code).not.toMatch(/qa-ai-strategy-smoke|vitest\.smoke|tests\/smoke/);
  });
});
