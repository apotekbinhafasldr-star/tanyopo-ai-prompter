// @vitest-environment node
/**
 * QA/Security (2026-11-11) — the repository is PUBLIC and its Actions logs are public.
 *
 * Guards (no secret VALUE is ever printed: failures name file and kind only):
 *  1. no credential-shaped string (private key block, JWT, AWS/GitHub/Slack/Google/OpenAI-style key, long Supabase
 *     secret key) in any tracked-looking text file; no credentials embedded in a URL outside test fixtures;
 *  2. no `.env*` file other than `.env.example`, and `.env.example` has an empty value for every secret-ish key and
 *     leaves PAYMENT_LIVE_ENABLED empty (live payments stay OFF by default);
 *  3. CI (runs on pull_request from forks) uses no secrets and no pull_request_target; every workflow that does use a
 *     secret is workflow_dispatch-only, main-only, bound to a protected Environment, and passes inputs via env (no
 *     `${{ inputs.* }}` inside a `run:` script body, which would be script injection).
 *
 * Label: CODE + UNIT TEST. Scans the working tree only (git history was scanned separately, see the audit document).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SELF = "tests/unit/security/security-repo-hygiene.test.ts";
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".claude", "coverage", "out"]);
const TEXT = /\.(ts|tsx|js|mjs|cjs|json|md|toml|ya?ml|sql|sh|py|txt|css|html|example)$/;

function walk(dir = "", out: string[] = []): string[] {
  for (const name of readdirSync(path.join(ROOT, dir))) {
    if (SKIP_DIRS.has(name)) continue;
    const rel = dir ? `${dir}/${name}` : name;
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

const all = walk();
const textFiles = all.filter((f) => TEXT.test(f) && f !== "package-lock.json" && f !== SELF);
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const isTest = (f: string) => f.startsWith("tests/");

// Patterns are assembled from pieces so this file does not match itself or trip secret scanners.
const BEGIN = "-----" + "BEGIN ";
const SECRET_SHAPES: Array<[string, RegExp, boolean]> = [
  ["private-key-block", new RegExp(BEGIN + "[A-Z ]*PRIVATE KEY-----"), true],
  ["jwt", /eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/, true],
  ["aws-access-key", /AKIA[0-9A-Z]{16}/, true],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/, true],
  ["github-fine-grained", /github_pat_[A-Za-z0-9_]{30,}/, true],
  ["slack-token", /xox[baprs]-[A-Za-z0-9-]{10,}/, true],
  ["google-api-key", /AIza[0-9A-Za-z_-]{35}/, true],
  ["openai-style-key", /\bsk-[A-Za-z0-9_-]{32,}/, true],
  ["supabase-secret-key", /sb_secret_[A-Za-z0-9_-]{28,}/, true],
  ["meta-access-token", /\bEAA[A-Za-z0-9]{50,}/, true],
  // Credentials inside a URL are legitimate only as negative-test fixtures.
  ["url-with-credentials", /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@"'`]+:[^\s/:@"'`]{3,}@[a-z0-9.-]+/i, false],
];

describe("security: no credential-shaped strings in the working tree", () => {
  it("scans a non-trivial number of files", () => {
    expect(textFiles.length).toBeGreaterThan(500);
  });

  it.each(SECRET_SHAPES)("%s", (kind, pattern, appliesToTests) => {
    const hits = textFiles.filter((f) => (appliesToTests || !isTest(f)) && pattern.test(read(f)));
    expect(hits, `${kind} found in (values deliberately not shown)`).toEqual([]);
  });
});

describe("security: environment files", () => {
  it("only .env.example is committed", () => {
    const envFiles = all.filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith(".env.example"));
    expect(envFiles).toEqual([]);
  });

  it(".gitignore keeps real env files out", () => {
    expect(read(".gitignore")).toMatch(/^\.env\*?$/m);
  });

  it(".env.example has no value for any secret-ish key", () => {
    const filled = read(".env.example")
      .split("\n")
      .filter((l) => /^[A-Z0-9_]*(SECRET|TOKEN|PASSWORD|API_KEY|SECRET_KEY|ENCRYPTION_KEY|PUBLISHABLE_KEY)[A-Z0-9_]*=\S/.test(l))
      .map((l) => l.split("=")[0]);
    expect(filled).toEqual([]);
  });

  it(".env.example leaves live payments OFF (empty), and the webhook sweeper off", () => {
    const env = read(".env.example");
    expect(env).toMatch(/^PAYMENT_LIVE_ENABLED=\s*$/m);
    expect(env).toMatch(/^PAYMENT_SWEEPER_ENABLED=\s*$/m);
  });
});

describe("security: GitHub Actions on a public repository", () => {
  const workflows = all.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f));

  it("finds the workflows", () => {
    expect(workflows.length).toBeGreaterThanOrEqual(3);
  });

  it("no workflow uses pull_request_target or workflow_run triggers (they run with secrets on fork-controlled code)", () => {
    for (const f of workflows) expect(read(f), f).not.toMatch(/^\s*(pull_request_target|workflow_run)\s*:/m);
  });

  it("the CI workflow (runs on pull_request) references no secret", () => {
    expect(read(".github/workflows/ci.yml")).not.toMatch(/secrets\./);
  });

  it.each(workflows.filter((f) => /secrets\./.test(readFileSync(path.join(ROOT, f), "utf8"))))(
    "%s: secret-using workflow is manual-only, main-only and Environment-bound",
    (f) => {
      const src = read(f);
      const on = src.slice(src.search(/^on:/m), src.search(/^permissions:/m));
      expect(on).toMatch(/workflow_dispatch:/);
      expect(on).not.toMatch(/\b(push|pull_request|schedule)\s*:/);
      expect(src).toMatch(/if:\s*github\.ref == 'refs\/heads\/main'/);
      expect(src).toMatch(/environment:\s*[\w-]+/);
    },
  );

  it.each(workflows)("%s: no ${{ inputs.* }} / github.event.* interpolated inside a run script", (f) => {
    const src = read(f);
    const lines = src.split("\n");
    let inRun = false;
    let runIndent = 0;
    const offenders: number[] = [];
    lines.forEach((line, i) => {
      const indent = line.length - line.trimStart().length;
      if (/^\s*-?\s*run:\s*[|>]/.test(line)) {
        inRun = true;
        runIndent = indent;
        return;
      }
      if (/^\s*-?\s*run:\s*\S/.test(line) && /\$\{\{\s*(inputs|github\.event)\./.test(line)) offenders.push(i + 1);
      if (inRun) {
        if (line.trim() !== "" && indent <= runIndent) inRun = false;
        else if (/\$\{\{\s*(inputs|github\.event)\./.test(line)) offenders.push(i + 1);
      }
    });
    expect(offenders, `script-injection-prone interpolation at lines`).toEqual([]);
  });
});
