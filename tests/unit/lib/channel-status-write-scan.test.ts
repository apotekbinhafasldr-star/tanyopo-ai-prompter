import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * H1 architecture guard. Every UPDATE of prompter_channel_campaigns.status in
 * application code must (a) filter by tenant and (b) name its source status
 * with .eq("status", ...). A new unconditional status write — the kind that
 * can turn a claimed/launched channel back into SCHEDULED/DRAFT — fails here.
 * (upsert/insert in syncChannelCampaigns never include `status`.)
 */
const ROOT = process.cwd();
const DIRS = ["app", "features", "lib", "services"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

interface Chain {
  file: string;
  text: string;
}

/** Each `.from("prompter_channel_campaigns")` expression up to the end of its statement. */
function channelChains(): Chain[] {
  const chains: Chain[] = [];
  for (const dir of DIRS) {
    for (const file of walk(path.join(ROOT, dir))) {
      const src = readFileSync(file, "utf8");
      let from = 0;
      for (;;) {
        const at = src.indexOf('.from("prompter_channel_campaigns")', from);
        if (at === -1) break;
        const end = src.indexOf(";", at);
        chains.push({ file: path.relative(ROOT, file), text: src.slice(at, end === -1 ? undefined : end) });
        from = at + 1;
      }
    }
  }
  return chains;
}

const statusWrites = () =>
  channelChains().filter((c) => /\.update\(\s*\{[^}]*\bstatus\b/.test(c.text));

describe("channel status writes are always conditional (H1)", () => {
  it("finds the known status writers (scan is not vacuous)", () => {
    const files = [...new Set(statusWrites().map((c) => c.file))];
    expect(files).toContain("services/channel-campaigns.ts");
    expect(files).toContain("features/campaigns/launch-actions.ts");
    expect(files).toContain("features/approvals/actions.ts");
  });

  it.each(statusWrites().map((c) => [c.file, c] as const))("%s: tenant + source-status filtered", (_file, chain) => {
    expect(chain.text).toMatch(/\.eq\("tenant_id",/);
    expect(chain.text).toMatch(/\.eq\("status",/);
  });

  it("no helper that sets channel status by master id alone remains", () => {
    for (const dir of DIRS) {
      for (const file of walk(path.join(ROOT, dir))) {
        expect(readFileSync(file, "utf8")).not.toContain("setChannelCampaignsStatus");
      }
    }
  });
});
