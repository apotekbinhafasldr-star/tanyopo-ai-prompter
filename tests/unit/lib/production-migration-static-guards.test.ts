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
