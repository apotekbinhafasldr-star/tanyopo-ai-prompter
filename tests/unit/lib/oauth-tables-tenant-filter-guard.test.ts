import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Architecture guard: every application query on prompter_oauth_credentials
 * and prompter_connected_accounts must carry a tenant_id condition (a
 * `.eq("tenant_id", ...)` filter or, for writes, a `tenant_id:` value in the
 * payload). Both tables are reached by the service role, which bypasses RLS,
 * so the filter is the only thing keeping one tenant from another's rows.
 * A new, unfiltered query fails this test.
 */

const ROOT = process.cwd();
const SCAN_DIRS = ["app", "components", "features", "lib", "services"];
// Any quote style, so a query written with ' or ` cannot slip past the scan.
const FROM = /\.from\(\s*["'`](prompter_oauth_credentials|prompter_connected_accounts)["'`]\s*\)/g;

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("tenant_id filter on OAuth tables", () => {
  const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
  const sites: { file: string; line: number; table: string; statement: string }[] = [];

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(FROM)) {
      const start = m.index ?? 0;
      // The statement ends at the next ";" or at the next .from( (whichever is
      // first), so a filter belonging to a neighbouring query never counts.
      const nextFrom = text.indexOf(".from(", start + 1);
      const semi = text.indexOf(";", start);
      const end = [nextFrom, semi].filter((i) => i !== -1).reduce((x, y) => Math.min(x, y), Infinity);
      sites.push({
        file: path.relative(ROOT, file),
        line: text.slice(0, start).split("\n").length,
        table: m[1],
        statement: text.slice(start, Number.isFinite(end) ? end : undefined),
      });
    }
  }

  it("finds the known call sites (the scan is not vacuous)", () => {
    expect(sites.filter((s) => s.table === "prompter_oauth_credentials").length).toBeGreaterThanOrEqual(6);
    expect(sites.filter((s) => s.table === "prompter_connected_accounts").length).toBeGreaterThanOrEqual(10);
  });

  it.each(sites.map((s) => [`${s.file}:${s.line} ${s.table}`, s] as const))("%s has a tenant_id condition", (_name, site) => {
    // Writes that carry values (insert/upsert) must put tenant_id in the payload;
    // select/update/delete must filter with .eq("tenant_id", ...). A tenant_id
    // merely written into an update payload is not a filter.
    const isValueWrite = /\.(insert|upsert)\(/.test(site.statement);
    expect(site.statement).toMatch(isValueWrite ? /tenant_id:/ : /\.eq\(\s*"tenant_id"/);
  });

  it("every credentials read is also bound to a connection id (never tenant alone)", () => {
    const reads = sites.filter((s) => s.table === "prompter_oauth_credentials" && /\.select\(/.test(s.statement));
    expect(reads.length).toBeGreaterThanOrEqual(5);
    for (const r of reads) expect(r.statement, `${r.file}:${r.line}`).toMatch(/\.eq\(\s*"connected_account_id"/);
  });

  it("the OAuth callback writes credentials with the session tenant", () => {
    const upsert = sites.find((s) => s.file.endsWith("oauth-callback.ts") && s.table === "prompter_oauth_credentials");
    expect(upsert?.statement).toMatch(/\.upsert\(\s*\{\s*tenant_id:\s*session\.tenantId/);
  });
});
