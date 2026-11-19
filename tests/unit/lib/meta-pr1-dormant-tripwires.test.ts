import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * PR-1 tripwires. The new Meta connector methods are DORMANT: nothing in
 * production code may call them in a way that could start spending or send a
 * validate-only request. A later PR that adds a real caller must change these
 * tests on purpose, in review.
 *
 * (The S1 gate list staying `[]` is already locked by meta-launch-order.test.ts
 * and one-click-ads-mock-e2e-gate-closed.test.ts, so it is not duplicated here.)
 */

const ROOT = process.cwd();
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "tests", "docs", "public", "supabase", ".netlify"]);
/** The connector and its type declarations define these names; every other production file is scanned. */
const DEFINING_FILES = new Set(["lib/connectors/meta-connector.ts", "lib/connectors/types.ts"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry)) out.push(full);
  }
  return out;
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");

const sources = walk(ROOT).map((file) => ({ file: rel(file), text: readFileSync(file, "utf8") }));
const productionSources = sources.filter(({ file }) => !DEFINING_FILES.has(file));

/** Top-level arguments of the call whose "(" is at `open`, honouring nesting and quotes. */
function callArguments(text: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === "\\") current += text[++i] ?? "";
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      current += ch;
    } else if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      if (depth > 1) current += ch;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) {
        if (current.trim() !== "") args.push(current.trim());
        return args;
      }
      current += ch;
    } else if (ch === "," && depth === 1) {
      args.push(current.trim());
      current = "";
    } else if (depth >= 1) {
      current += ch;
    }
  }
  return args; // unterminated: let the caller's checks fail closed
}

/**
 * Every use of `setEntityStatus` in `text` that is NOT a direct call with the
 * status as a "PAUSED" or "ARCHIVED" string literal. An indirect use (a
 * reference, a string key, a variable status) cannot be proven safe, so it is a
 * violation too.
 */
function unsafeSetEntityStatusUses(text: string): string[] {
  const violations: string[] = [];
  for (const match of text.matchAll(/\bsetEntityStatus\b/g)) {
    const end = (match.index ?? 0) + match[0].length;
    const rest = text.slice(end);
    const open = /^\s*(\?\.)?\s*\(/.exec(rest);
    if (!open) {
      violations.push(`indirect use: ${text.slice(match.index, end + 20).replace(/\s+/g, " ")}`);
      continue;
    }
    const args = callArguments(text, end + open[0].length - 1);
    if (args.length !== 3 || !/^["'](PAUSED|ARCHIVED)["']$/.test(args[2])) {
      violations.push(`status argument is not a PAUSED/ARCHIVED literal: ${JSON.stringify(args)}`);
    }
  }
  return violations;
}

/** Any use of a `validateOnly` property/shorthand that is not literally `false`. */
function validateOnlyUses(text: string): string[] {
  return [...text.matchAll(/\bvalidateOnly\b\s*(:(?!\s*false\b)|(?=[,}]))/g)].map((m) =>
    text.slice(m.index, (m.index ?? 0) + 30).replace(/\s+/g, " "),
  );
}

describe("PR-1 tripwire (i): no production code sets a Meta object to ACTIVE", () => {
  it("the scan is not vacuous (it walks the repository's production code)", () => {
    expect(productionSources.length).toBeGreaterThan(50);
    expect(productionSources.map(({ file }) => file)).toContain("features/campaigns/launch-actions.ts");
    expect(sources.map(({ file }) => file)).toContain("lib/connectors/meta-connector.ts");
  });

  it("no production file other than the connector uses setEntityStatus with anything but a PAUSED/ARCHIVED literal", () => {
    const offenders = productionSources.flatMap(({ file, text }) => unsafeSetEntityStatusUses(text).map((v) => `${file}: ${v}`));
    expect(offenders).toEqual([]);
  });

  it("inside the connector, every this.setEntityStatus call passes PAUSED (pauseObject only)", () => {
    const text = sources.find(({ file }) => file === "lib/connectors/meta-connector.ts")!.text;
    const calls = [...text.matchAll(/this\.setEntityStatus\s*\(/g)];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const args = callArguments(text, (call.index ?? 0) + call[0].length - 1);
      expect(args[2]).toBe('"PAUSED"');
    }
  });

  it("the connector never writes an ACTIVE status literal (it must only be a caller-supplied value)", () => {
    const text = sources.find(({ file }) => file === "lib/connectors/meta-connector.ts")!.text;
    expect(text).not.toMatch(/status\s*:\s*["']ACTIVE["']/);
  });

  it("scanner self-check: flags ACTIVE, variables, references and string keys; accepts PAUSED/ARCHIVED", () => {
    expect(unsafeSetEntityStatusUses('c.setEntityStatus(t, id, "ACTIVE")')).toHaveLength(1);
    expect(unsafeSetEntityStatusUses("c.setEntityStatus(t, id, status)")).toHaveLength(1);
    expect(unsafeSetEntityStatusUses("c.setEntityStatus(t, id, cond ? 'PAUSED' : 'ACTIVE')")).toHaveLength(1);
    expect(unsafeSetEntityStatusUses('c.setEntityStatus?.(t, id, "ACTIVE")')).toHaveLength(1);
    expect(unsafeSetEntityStatusUses("const f = c.setEntityStatus; f(t, id, x)")).toHaveLength(1);
    expect(unsafeSetEntityStatusUses('c["setEntityStatus"](t, id, "ACTIVE")')).toHaveLength(1);
    expect(unsafeSetEntityStatusUses('c.setEntityStatus(t, id, "ACTIVE", extra)')).toHaveLength(1);
    expect(unsafeSetEntityStatusUses('c.setEntityStatus(\n  t,\n  id,\n  "ACTIVE",\n)')).toHaveLength(1);
    expect(unsafeSetEntityStatusUses('c.setEntityStatus(t, fn(a, b), "PAUSED")')).toEqual([]);
    expect(unsafeSetEntityStatusUses("c.setEntityStatus(t, id, 'ARCHIVED')")).toEqual([]);
    expect(unsafeSetEntityStatusUses("no mention here")).toEqual([]);
  });
});

describe("PR-1 tripwire (iii): no production caller of validateOnly: true", () => {
  it("no production file outside the connector and its types uses validateOnly (other than false)", () => {
    const offenders = productionSources.flatMap(({ file, text }) => validateOnlyUses(text).map((v) => `${file}: ${v}`));
    expect(offenders).toEqual([]);
  });

  it("the launch path does not mention validate-only at all", () => {
    for (const file of ["features/campaigns/launch-actions.ts", "features/approvals/actions.ts"]) {
      const text = sources.find((s) => s.file === file)?.text ?? "";
      expect(text, file).not.toMatch(/validateOnly|validate_only|execution_options/);
    }
  });

  it("the connector only adds execution_options through the validate-only option", () => {
    const text = sources.find(({ file }) => file === "lib/connectors/meta-connector.ts")!.text;
    expect(text.match(/execution_options/g)?.length).toBe(1);
    expect(text).toContain("...(validateOnly ? VALIDATE_ONLY_FIELDS : {})");
  });

  it("scanner self-check: flags true, variables and shorthand; accepts false and declarations without a value", () => {
    expect(validateOnlyUses("c.createAd(t, a, i, { validateOnly: true })")).toHaveLength(1);
    expect(validateOnlyUses("c.createAd(t, a, i, { validateOnly: flag })")).toHaveLength(1);
    expect(validateOnlyUses("c.createAd(t, a, i, { validateOnly })")).toHaveLength(1);
    expect(validateOnlyUses("c.createAd(t, a, i, {validateOnly:true})")).toHaveLength(1);
    expect(validateOnlyUses("c.createAd(t, a, i, { validateOnly: false })")).toEqual([]);
    expect(validateOnlyUses("nothing")).toEqual([]);
  });
});
