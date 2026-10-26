import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("@/lib/env", () => ({
  publicEnv: { supabaseUrl: "https://example.supabase.co", supabasePublishableKey: "pk" },
}));
vi.mock("@/components/brand/linoe-logo", () => ({ LinoeLogo: () => null }));

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { getSiteOrigin, PRODUCTION_ORIGIN } from "@/lib/seo/site-url";
import { isPublicAsset } from "@/proxy";
import { metadata as authMetadata } from "@/app/(auth)/layout";
import { LEGAL_LINKS } from "@/features/legal/legal-meta";

afterEach(() => vi.unstubAllEnvs());

type RobotsRule = { userAgent?: string | string[]; allow?: string | string[]; disallow?: string | string[] };
function rulesOf(): RobotsRule[] {
  const r = robots().rules as RobotsRule | RobotsRule[];
  return Array.isArray(r) ? r : [r];
}

function stubOrigin(appUrl: string | undefined, netlifyUrl: string | undefined) {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", appUrl ?? "");
  vi.stubEnv("URL", netlifyUrl ?? "");
}

describe("getSiteOrigin — never localhost, only a public https origin", () => {
  it("uses NEXT_PUBLIC_APP_URL when it is a valid public https URL, dropping any path", () => {
    expect(getSiteOrigin({ NEXT_PUBLIC_APP_URL: "https://linoe.example.com/some/path?x=1" })).toBe("https://linoe.example.com");
  });
  it("ignores the app's localhost default and falls back to Netlify's URL", () => {
    expect(getSiteOrigin({ NEXT_PUBLIC_APP_URL: "http://localhost:3000", URL: "https://site.netlify.app" })).toBe("https://site.netlify.app");
  });
  it("rejects http, localhost variants, .local and garbage, ending on the production origin", () => {
    for (const bad of ["http://example.com", "https://localhost", "https://127.0.0.1", "https://printer.local", "not a url", ""]) {
      expect(getSiteOrigin({ NEXT_PUBLIC_APP_URL: bad, URL: bad })).toBe(PRODUCTION_ORIGIN);
    }
  });
  it("with nothing configured, uses the production origin (never localhost)", () => {
    expect(getSiteOrigin({})).toBe(PRODUCTION_ORIGIN);
    expect(PRODUCTION_ORIGIN).toMatch(/^https:\/\//);
    expect(PRODUCTION_ORIGIN).not.toMatch(/localhost/);
  });
});

describe("robots.txt", () => {
  it("allows the site, points at the sitemap on the production origin", () => {
    stubOrigin(undefined, undefined);
    const r = robots();
    expect(r.sitemap).toBe(`${PRODUCTION_ORIGIN}/sitemap.xml`);
    expect(String(r.sitemap)).not.toMatch(/localhost/);
    const rules = rulesOf();
    expect(rules).toHaveLength(1);
    expect(rules[0].userAgent).toBe("*");
    expect(rules[0].allow).toBe("/");
  });

  it("disallows only /api/ and /auth/, and nothing crawlers need: pages with noindex, /demo, and Next assets stay crawlable", () => {
    const rule = rulesOf()[0];
    const disallow = ([] as string[]).concat(rule.disallow ?? []);
    expect(disallow.sort()).toEqual(["/api/", "/auth/"]);
    for (const mustStayCrawlable of ["/login", "/register", "/forgot-password", "/onboarding", "/demo", "/_next/static/", "/", "/privacy", "/terms", "/refund", "/data-deletion"]) {
      expect(disallow.some((d) => mustStayCrawlable.startsWith(d)), mustStayCrawlable).toBe(false);
    }
  });
});

describe("sitemap.xml", () => {
  it("lists exactly the landing and the four legal pages, absolute https URLs on the production origin", () => {
    stubOrigin(undefined, undefined);
    const urls = sitemap().map((e) => e.url);
    expect(urls).toEqual([
      PRODUCTION_ORIGIN,
      `${PRODUCTION_ORIGIN}/privacy`,
      `${PRODUCTION_ORIGIN}/terms`,
      `${PRODUCTION_ORIGIN}/refund`,
      `${PRODUCTION_ORIGIN}/data-deletion`,
    ]);
    expect(urls.length).toBe(1 + LEGAL_LINKS.length);
  });

  it("never contains private, API, demo, auth, onboarding or tenant pages, and never localhost", () => {
    stubOrigin("http://localhost:3000", undefined);
    const urls = sitemap().map((e) => e.url);
    for (const u of urls) {
      expect(u).toMatch(/^https:\/\//);
      expect(u).not.toMatch(/localhost|\/api|\/demo|\/dashboard|\/login|\/register|\/onboarding|\/billing|\/campaigns|\/products|\/settings|\/approvals|\/auth/);
    }
  });

  it("uses the configured public origin when one is set", () => {
    stubOrigin("https://linoe.example.com", undefined);
    expect(sitemap()[0].url).toBe("https://linoe.example.com");
    expect(robots().sitemap).toBe("https://linoe.example.com/sitemap.xml");
  });

  it("invents no lastModified date", () => {
    for (const e of sitemap()) expect(e.lastModified).toBeUndefined();
  });
});

describe("crawl files are reachable without a session (proxy)", () => {
  it("/robots.txt and /sitemap.xml are public, by exact match only", () => {
    expect(isPublicAsset("/robots.txt")).toBe(true);
    expect(isPublicAsset("/sitemap.xml")).toBe(true);
    expect(isPublicAsset("/robots.txt/x")).toBe(false);
    expect(isPublicAsset("/sitemap.xmlx")).toBe(false);
  });
  it("protected areas are still gated", () => {
    for (const p of ["/dashboard", "/billing", "/campaigns", "/products", "/settings", "/approvals", "/onboarding"]) {
      expect(isPublicAsset(p), p).toBe(false);
    }
  });
});

describe("indexing directives", () => {
  it("the auth route group (login, register, forgot/reset password, session error) is noindex", () => {
    expect(authMetadata.robots).toEqual({ index: false, follow: false });
  });

  it("onboarding is noindex (source check)", () => {
    const src = readFileSync("app/onboarding/page.tsx", "utf8");
    expect(src).toMatch(/robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
  });

  it("the auth pages keep their own titles and do not override the group's noindex (source check)", () => {
    for (const f of ["login", "register", "forgot-password", "reset-password", "session-error"]) {
      const src = readFileSync(`app/(auth)/${f}/page.tsx`, "utf8");
      expect(src, f).toMatch(/title:/);
      expect(src, f).not.toMatch(/index:\s*true/);
    }
  });

  it("the landing and the legal pages stay indexable (source check)", () => {
    const landing = readFileSync("app/(marketing)/page.tsx", "utf8");
    expect(landing).not.toMatch(/noindex|index:\s*false/);
    const rootLayout = readFileSync("app/layout.tsx", "utf8");
    expect(rootLayout).not.toMatch(/noindex|index:\s*false/);
    const legalMeta = readFileSync("features/legal/legal-meta.ts", "utf8");
    expect(legalMeta).toMatch(/robots:\s*\{\s*index:\s*true,\s*follow:\s*true\s*\}/);
  });

  it("the root document language is Indonesian", () => {
    const rootLayout = readFileSync("app/layout.tsx", "utf8");
    expect(rootLayout).toContain('lang="id"');
    expect(rootLayout).not.toContain('lang="en"');
  });

  it("the demo tree stays noindex and is not touched", () => {
    expect(readFileSync("app/demo/layout.tsx", "utf8")).toMatch(/robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
  });
});
