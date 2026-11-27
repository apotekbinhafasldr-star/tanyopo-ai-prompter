// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const sha = (rel: string) => createHash("sha256").update(readFileSync(path.join(root, rel))).digest("hex");

const WF = ".github/workflows/production-migration.yml";
const CI = ".github/workflows/ci.yml";
const MANIFEST = "supabase/prod-packages/manifest.json";
const RUNNER = "supabase/prod-packages/tools/run_package.py";

interface FileEntry {
  path: string;
  sha256: string;
}
interface PackageEntry {
  version: string;
  migration: FileEntry;
  rollback: FileEntry;
  files: Record<string, FileEntry>;
}
interface Manifest {
  project_ref: string;
  migration_role: string;
  approved_privileged_role: boolean;
  packages: Record<string, PackageEntry>;
}

const noComments = (s: string) => s.replace(/^\s*#.*$/gm, "");

describe("Production Migration workflow — static guards (repository is PUBLIC)", () => {
  const wf = read(WF);
  const body = noComments(wf);

  it("runs only on workflow_dispatch: never on push, merge, pull request, schedule or any other trigger", () => {
    const onBlock = body.slice(body.indexOf("\non:"), body.indexOf("\npermissions:"));
    expect(onBlock).toMatch(/^ {2}workflow_dispatch:/m);
    expect(onBlock).not.toMatch(/^ {2}(push|pull_request|pull_request_target|schedule|workflow_run|workflow_call|repository_dispatch|release|issues|issue_comment|check_run|deployment)\s*:/m);
    expect(body.match(/workflow_dispatch:/g)).toHaveLength(1);
    expect(body).not.toMatch(/pull_request_target|workflow_run|issue_comment/);
  });

  it("is restricted to main and gated by the production-migration Environment, one run at a time", () => {
    expect(body).toMatch(/^ {4}if: github\.ref == 'refs\/heads\/main'$/m);
    expect(body).toMatch(/^ {4}environment: production-migration$/m);
    expect(body).toMatch(/concurrency:\n {2}group: production-migration\n {2}cancel-in-progress: false/);
    expect(body).toMatch(/timeout-minutes: \d+/);
  });

  it("has read-only token permissions and no third-party action at all", () => {
    expect(body).toMatch(/^permissions:\n {2}contents: read\n {2}actions: read$/m);
    expect(body).not.toMatch(/: write\b/);
    expect(body).not.toMatch(/^\s*-?\s*uses:/m);
  });

  it("never interpolates ${{ }} inside a script: every expression is an env mapping value (no script injection)", () => {
    for (const line of body.split("\n")) {
      if (!line.includes("${{")) continue;
      expect(line, line).toMatch(/^\s+[A-Z_]+: \$\{\{ [A-Za-z_.]+ \}\}$/);
    }
  });

  it("uses exactly one secret, only in the final 'Run package' step, after the approval proof", () => {
    const secrets = body.match(/secrets\.[A-Za-z_]+/g) ?? [];
    expect(secrets).toEqual(["secrets.MIGRATION_DB_PASSWORD"]);
    const iSecret = body.indexOf("secrets.MIGRATION_DB_PASSWORD");
    const iRun = body.indexOf("- name: Run package");
    const iApproval = body.indexOf("check_approval.py");
    expect(iApproval).toBeGreaterThan(0);
    expect(iRun).toBeGreaterThan(iApproval);
    expect(iSecret).toBeGreaterThan(iRun);
    expect(body).not.toMatch(/secrets: inherit|toJSON\(secrets\)/);
    expect(body).toMatch(/PGHOST: \$\{\{ vars\.MIGRATION_DB_HOST \}\}/);
    expect(body).toMatch(/PGUSER: \$\{\{ vars\.MIGRATION_DB_USER \}\}/);
  });

  it("requires the input SHA to equal the workflow commit AND the current tip of main", () => {
    expect(body).toMatch(/\^\[0-9a-f\]\{40\}\$/);
    expect(body).toMatch(/"\$INPUT_SHA" = "\$WORKFLOW_SHA"/);
    expect(body).toMatch(/git ls-remote .*refs\/heads\/main/);
    expect(body).toMatch(/"\$TIP" = "\$INPUT_SHA"/);
  });

  it("proves the Environment approval via the run's approvals before any secret step, and checks the package statically first", () => {
    expect(body).toMatch(/actions\/runs\/\$\{RUN_ID\}\/approvals/);
    expect(body).toMatch(/check_approval\.py .* production-migration/);
    expect(body.indexOf("Verify package")).toBeGreaterThan(body.indexOf("approvals"));
    expect(body).toMatch(/--mode check-only/);
    expect(body.match(/--target production/g)).toHaveLength(1);
  });

  it("contains no Supabase CLI, no db push / migration up, no service_role, no access token, no continue-on-error", () => {
    expect(body).not.toMatch(/db push|migration up|supabase (db|migration|link|login)|setup-cli|supabase\/setup/i);
    expect(body).not.toMatch(/service_role|SERVICE_ROLE|SUPABASE_ACCESS_TOKEN|SUPABASE_SECRET|DATABASE_URL/);
    expect(body).not.toMatch(/continue-on-error/);
    expect(body).not.toMatch(/\bset -x\b|--debug|ACTIONS_STEP_DEBUG/);
  });

  it("offers only the manifest package and the documented modes", () => {
    expect(body).toMatch(/options:\n {10}- p0-2\n/);
    for (const m of ["owner-audit", "verify-only", "apply", "record-ledger", "rollback"]) expect(body).toContain(`- ${m}`);
  });
});

describe("CI keeps the rehearsal secret-free", () => {
  const ci = read(CI);
  it("ci.yml references no secret at all and runs the rehearsal on PostgreSQL 17", () => {
    expect(ci).not.toMatch(/secrets\./);
    const job = ci.slice(ci.indexOf("  prod-migration-rehearsal:"));
    expect(job).toMatch(/image: postgres:17/);
    expect(job).toMatch(/REQUIRE_PG_MAJOR: "17"/);
    expect(job).toMatch(/rehearsal\.sh/);
    expect(job).not.toMatch(/MIGRATION_DB|SUPABASE/);
  });
});

describe("Manifest, runner and docs", () => {
  const manifest = JSON.parse(read(MANIFEST)) as Manifest;
  it("pins the project, the least-privileged migration role and every file checksum", () => {
    expect(manifest.project_ref).toBe("wjjyqovhmwenbcvbnkgx");
    expect(manifest.migration_role).toBe("linoe_migrator");
    expect(manifest.approved_privileged_role).toBe(false);
    expect(Object.keys(manifest.packages)).toEqual(["p0-2"]);
    const pkg = manifest.packages["p0-2"];
    expect(path.basename(pkg.migration.path).startsWith(pkg.version + "_")).toBe(true);
    for (const e of [pkg.migration, pkg.rollback, ...Object.values(pkg.files)]) {
      expect(existsSync(path.join(root, e.path)), e.path).toBe(true);
      expect(sha(e.path), e.path).toBe(e.sha256);
    }
    expect(Object.keys(pkg.files).sort()).toEqual(["A", "B", "C", "D", "E", "F", "S"]);
  });

  it("D takes created_by from the runner and B never writes the ledger", () => {
    const pkg = manifest.packages["p0-2"];
    expect(read(pkg.files.D.path)).toContain(":'created_by'");
    const b = read(pkg.files.B.path).replace(/--[^\n]*/g, "");
    expect(b).not.toMatch(/insert\s+into\s+supabase_migrations/i);
  });

  it("the runner refuses privileged roles, non-pooler hosts and transaction mode, and never prints a credential", () => {
    const src = read(RUNNER);
    expect(src).toMatch(/PRIV_ROLES/);
    expect(src).toMatch(/approved_privileged_role/);
    expect(src).toMatch(/pooler\\\.supabase\\\.com/);
    expect(src).toMatch(/port != "5432"/);
    expect(src).toMatch(/scrub\(/);
    expect(src).not.toMatch(/SUPABASE_ACCESS_TOKEN|SERVICE_ROLE_KEY|DATABASE_URL/);
    expect(src).not.toMatch(/db push|migration up/);
  });

  it("the operating guide exists and states the manual preconditions", () => {
    const doc = read("docs/PRODUCTION_MIGRATION.md");
    for (const needle of ["Required reviewers", "production-migration", "linoe_migrator", "owner-audit", "tanpa backfill", "STOP"]) {
      expect(doc, needle).toContain(needle);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// PR-1 (production pipeline v2). These tests only ADD constraints; none of the assertions above was loosened.
// ---------------------------------------------------------------------------------------------------------------------
describe("Pipeline v2 — workflow options follow the manifest, p0-2 entry stays pinned", () => {
  const manifest = JSON.parse(read(MANIFEST)) as Manifest;
  const body = noComments(read(WF));

  it("the package choice in the workflow is DERIVED from the manifest keys (no package can be offered that is not pinned)", () => {
    const m = body.match(/package:\n(?: {8}.*\n)*? {8}options:\n((?: {10}- .+\n)+)/);
    expect(m).not.toBeNull();
    const options = (m![1].match(/- (\S+)/g) ?? []).map((x) => x.slice(2));
    expect(options).toEqual(Object.keys(manifest.packages));
  });

  it("PR-1 adds no package: the production manifest still has only p0-2 and no allow-list or shape on it", () => {
    expect(Object.keys(manifest.packages)).toEqual(["p0-2"]);
    const p = manifest.packages["p0-2"] as unknown as Record<string, unknown>;
    for (const k of ["allow", "rollback_allow", "shape", "probes", "ledger_verify", "timeouts"]) expect(p[k], k).toBeUndefined();
    const canon = JSON.stringify(sortKeys(p));
    expect(createHash("sha256").update(canon).digest("hex")).toBe("dea14f3c671727745ac1240fdd0b5cf86c33bd00048c39fd0fb02a002d98753c");
  });

  it("the workflow does not mention the fixture, the probe or any new mode", () => {
    expect(body).not.toMatch(/fx-n|fixtures|privilege_probe|ledger_verify/);
    expect(body.match(/^ {10}- (owner-audit|verify-only|apply|record-ledger|rollback)$/gm)).toHaveLength(5);
  });
});

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
  return v;
}

interface AllowEntry {
  kind: string;
  schema: string;
  names?: string[];
  columns?: string[];
  objects?: string[];
  roles?: string[];
}
interface FxPackage {
  fixture: boolean;
  shape: string;
  migration: FileEntry;
  rollback: FileEntry;
  files: Record<string, FileEntry>;
  allow: AllowEntry[];
  rollback_allow: AllowEntry[];
}

describe("Pipeline v2 — synthetic fixture package (rehearsal only)", () => {
  const FXM = "supabase/prod-packages/tests/fixtures/manifest.json";
  const fx = JSON.parse(read(FXM)) as { packages: Record<string, FxPackage> };
  const pkg = fx.packages["fx-n"];

  it("every checksum of the fixture matches the bytes (run tests/fixtures/rehash.py after editing it)", () => {
    for (const e of [pkg.migration, pkg.rollback, ...Object.values(pkg.files as Record<string, FileEntry>)]) {
      expect(existsSync(path.join(root, e.path)), e.path).toBe(true);
      expect(sha(e.path), e.path).toBe(e.sha256);
    }
  });

  it("is shape N: B is the migration itself, E is the rollback itself, each with its own BEGIN/COMMIT", () => {
    expect(pkg.shape).toBe("native-txn");
    expect(pkg.files.B).toEqual(pkg.migration);
    expect(pkg.files.E).toEqual(pkg.rollback);
    for (const rel of [pkg.migration.path, pkg.rollback.path]) {
      const sql = read(rel).replace(/--[^\n]*/g, "").trim();
      expect(sql, rel).toMatch(/^begin;/i);
      expect(sql, rel).toMatch(/commit;$/i);
    }
  });

  it("the allow-lists are literal: schema public/storage only, no wildcard, no unused-looking entry kinds", () => {
    for (const list of [pkg.allow, pkg.rollback_allow] as AllowEntry[][]) {
      expect(list.length).toBeGreaterThan(0);
      for (const e of list) {
        expect(["public", "storage"], JSON.stringify(e)).toContain(e.schema);
        for (const v of [...(e.names ?? []), ...(e.columns ?? []), ...(e.objects ?? []), ...(e.roles ?? [])]) expect(v, JSON.stringify(e)).not.toMatch(/[*%?\\]/);
      }
    }
  });

  it("is invisible to production: not in the manifest, not in the workflow, and has only synthetic names", () => {
    expect(Object.keys((JSON.parse(read(MANIFEST)) as Manifest).packages)).not.toContain("fx-n");
    expect(read(WF)).not.toMatch(/fx-n/);
    expect(pkg.fixture).toBe(true);
    expect(read(pkg.migration.path)).toMatch(/FIXTURE SINTETIS/);
    expect(read(pkg.migration.path)).not.toMatch(/Tenant (baca|kelola|unggah)|product-media|prompter_/);
  });
});

describe("Pipeline v2 — public-log safety and file hygiene", () => {
  const manifest = JSON.parse(read(MANIFEST)) as Manifest;
  const fx = JSON.parse(read("supabase/prod-packages/tests/fixtures/manifest.json")) as { packages: Record<string, PackageEntry> };
  const readOnlyKeys = ["A", "C", "F", "S", "G"];
  const readOnlyFiles = [...Object.values(manifest.packages), ...Object.values(fx.packages)].flatMap((p) =>
    readOnlyKeys.filter((k) => p.files[k]).map((k) => p.files[k].path),
  );

  it("read-only package files never print names: every string_agg is hashed by md5, no policy/role/bucket name list", () => {
    expect(readOnlyFiles.length).toBeGreaterThan(8);
    for (const rel of readOnlyFiles) {
      const sql = read(rel).replace(/--[^\n]*/g, "");
      for (const m of sql.matchAll(/string_agg\(/g)) {
        expect(sql.slice(Math.max(0, m.index! - 80), m.index!), `${rel}: string_agg must sit inside md5(...)`).toMatch(/md5\(/);
      }
      expect(sql, rel).not.toMatch(/array_agg\(\s*(\w+\.)?(policyname|rolname|name|id)\b/i);
      expect(sql, rel).not.toMatch(/\bas\s+(nama|name|policyname|bucket)\b/i);
      expect(sql, rel).not.toMatch(/raise\s+(notice|warning|info)/i);
    }
  });

  it("the runner never reaches stderr/stdout except through the redacting helpers", () => {
    const src = read(RUNNER);
    expect(src).toMatch(/def safe_error\(/);
    expect(src).toMatch(/def check_log_safe\(/);
    expect(src).toMatch(/message text withheld: public log/);
    for (const line of src.split("\n")) {
      if (/\.stderr/.test(line)) expect(line, line).toMatch(/safe_error\(|returncode|capture_output/);
      if (/Stop\(.*(\.stdout|\.stderr)/.test(line)) expect(line, line).toMatch(/safe_error\(/);
    }
    expect(src).not.toMatch(/Stop\(f?["'][^"']*\{(r|row|out|rows|h|hdr)\b/);
  });

  it("the python tests include the AST guard and the rehearsal greps the log for CANARY names, object names and passwords", () => {
    expect(read("supabase/prod-packages/tests/test_tools_v2.py")).toMatch(/test_runner_source_never_prints_raw_results/);
    const r = read("supabase/prod-packages/tests/rehearsal.sh");
    expect(r).toMatch(/CANARY_OTHER_POLICY_zq81/);
    expect(r).toMatch(/no policy\/bucket\/table\/function name of another party, no password/);
    expect(r).toMatch(/SANDBOX/);
  });

  it("package files are LF only and .gitattributes pins LF for supabase/", () => {
    expect(read(".gitattributes")).toMatch(/^supabase\/\*\* text eol=lf$/m);
    const files = new Set<string>();
    for (const p of [...Object.values(manifest.packages), ...Object.values(fx.packages)]) {
      files.add(p.migration.path);
      files.add(p.rollback.path);
      for (const e of Object.values(p.files)) files.add(e.path);
    }
    for (const rel of [...files, "supabase/prod-packages/tools/privilege_probe_readonly.sql", "supabase/prod-packages/tools/ledger_verify_readonly.sql", "supabase/prod-packages/tools/run_package.py"]) {
      expect(readFileSync(path.join(root, rel), "utf8").includes("\r"), rel).toBe(false);
    }
  });

  it("the runner forbids what the allow-list can never lift (ownership, role switch, advisory locks, dynamic EXECUTE, psql meta-commands)", () => {
    const src = read(RUNNER);
    for (const needle of ["owner\\s+to", "session_replication_role", "pg_(try_)?advisory", "dynamic EXECUTE", "role membership grant", "psql meta-command", "ALTER DEFAULT PRIVILEGES"]) {
      expect(src, needle).toContain(needle);
    }
    expect(src).toMatch(/ALLOW_SCHEMAS = \("public", "storage"\)/);
    expect(src).toMatch(/stale allow-list entry/);
    expect(read(MANIFEST)).toMatch(/"approved_privileged_role": false/);
  });

  it("the runner never escalates: no CREATE/ALTER ROLE, no GRANT, no SET ROLE is executed by python code", () => {
    const src = read(RUNNER).split("\n").filter((l) => !/^\s*(#|\(r"|"""|FORBIDDEN)/.test(l)).join("\n");
    expect(src).not.toMatch(/f?"(create|alter)\s+role|f?"grant\s|"set\s+role/i);
    expect(src).toMatch(/No privilege escalation is attempted/);
  });

  it("the operating guide documents the v2 model (R1/R2, allow-list, public-log rule, Android steps, evidence class)", () => {
    const doc = read("docs/PRODUCTION_MIGRATION.md");
    for (const needle of ["R1", "R2", "Allow-list", "SANDBOX", "UNKNOWN", "HP Android", "log publik", "Privilege probe", "ROLLED_BACK", "APPROVE"]) {
      expect(doc, needle).toContain(needle);
    }
  });
});
