import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { LEGAL_LINKS } from "@/features/legal/legal-meta";

// Cross-file consistency guards for the crawl surface. They read source text on purpose (no page modules are
// imported), so they stay cheap and cannot be broken by unrelated UI imports.
const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

function pageFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(root, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(path.join(root, rel)).isDirectory()) out.push(...pageFiles(rel));
    else if (/^(page|layout)\.tsx$/.test(name)) out.push(rel);
  }
  return out;
}

function proxyPublicPaths(): string[] {
  const m = read("proxy.ts").match(/const PUBLIC_PATHS = \[([^\]]*)\]/);
  expect(m, "PUBLIC_PATHS literal not found in proxy.ts").not.toBeNull();
  return [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

describe("sitemap legal pages vs the rest of the code", () => {
  it("every legal link is reachable without a session (listed in proxy PUBLIC_PATHS)", () => {
    const publicPaths = proxyPublicPaths();
    for (const l of LEGAL_LINKS) expect(publicPaths, l.href).toContain(l.href);
  });

  it("every legal link has a page whose legalMetadata path equals its route (canonical cannot drift from the sitemap)", () => {
    for (const l of LEGAL_LINKS) {
      const src = read(`app/(legal)${l.href}/page.tsx`);
      expect(src, l.href).toContain("legalMetadata(");
      expect(src, l.href).toContain(`path: "${l.href}"`);
    }
  });

  it("sitemap URLs are unique and none is covered by a robots.txt disallow rule", () => {
    const urls = sitemap().map((e) => e.url);
    expect(new Set(urls).size).toBe(urls.length);
    const rule = (robots().rules as { disallow?: string | string[] } | { disallow?: string | string[] }[]);
    const first = Array.isArray(rule) ? rule[0] : rule;
    const disallow = ([] as string[]).concat(first.disallow ?? []);
    for (const u of urls) {
      const p = new URL(u).pathname;
      expect(disallow.some((d) => p.startsWith(d)), u).toBe(false);
    }
  });

  it("sitemap and robots point at the same origin", () => {
    const origin = new URL(String(robots().sitemap)).origin;
    for (const e of sitemap()) expect(new URL(e.url).origin).toBe(origin);
  });
});

describe("authenticated and non-public areas never ask to be indexed", () => {
  const noindexLayouts = [
    "app/(app)/layout.tsx",
    "app/(auth)/layout.tsx",
    "app/admin/layout.tsx",
    "app/demo/layout.tsx",
    "app/onboarding/page.tsx",
    "app/ops/payments/page.tsx",
  ];

  it.each(noindexLayouts)("%s declares robots noindex,nofollow", (file) => {
    expect(read(file)).toMatch(/robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
  });

  it("no page or layout in those areas sets index: true", () => {
    for (const dir of ["app/(app)", "app/(auth)", "app/admin", "app/demo", "app/ops"]) {
      for (const f of pageFiles(dir)) expect(read(f), f).not.toMatch(/index:\s*true/);
    }
    expect(read("app/onboarding/page.tsx")).not.toMatch(/index:\s*true/);
  });
});
