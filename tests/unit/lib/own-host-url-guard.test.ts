import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  isOwnAppHostname,
  isOwnAppUrl,
  validateLandingUrl,
  resolveLandingUrl,
} from "@/lib/campaigns/meta-launch-preflight";
import {
  buildPurchaseDestination,
  checkLaunchDestination,
  safeWebsiteDefault,
  validateWebsiteUrl,
} from "@/lib/campaigns/purchase-destination";
import { productSchema } from "@/schemas/products";
import { BUDGET_WRITE_ENABLED_PLATFORMS } from "@/lib/campaigns/external-budget-guard";

const LINOE = "https://tanyopo-ai-prompter.netlify.app";
const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

describe("LINOE production host is blocked regardless of environment", () => {
  it.each([
    LINOE,
    `${LINOE}/`,
    `${LINOE}/promote?x=1#top`,
    "https://TANYOPO-AI-PROMPTER.NETLIFY.APP/",
    "https://tanyopo-ai-prompter.netlify.app./",
    "https://www.tanyopo-ai-prompter.netlify.app/",
    "https://main--tanyopo-ai-prompter.netlify.app/",
    "https://6adcb0940bd0f3dfb0854c41--tanyopo-ai-prompter.netlify.app/",
    "https://tanyopo.ai/",
  ])("rejects %s with an empty host list", (url) => {
    expect(validateLandingUrl(url, []).ok).toBe(false);
  });

  it("rejects it with no env, and with a different env", () => {
    expect(validateWebsiteUrl(LINOE, null).ok).toBe(false);
    expect(validateWebsiteUrl(LINOE, []).ok).toBe(false);
    expect(validateWebsiteUrl(LINOE, ["app.other-domain.com", "abcd.supabase.co"]).ok).toBe(false);
    expect(buildPurchaseDestination({ type: "WEBSITE", value: LINOE }, ["app.other-domain.com"]).ok).toBe(false);
  });

  it("is also refused at launch time and for stored destinations", () => {
    const stored = { purchase_destination: { version: 1, type: "WEBSITE", value: LINOE, link: LINOE } };
    expect(checkLaunchDestination(stored, ["app.other-domain.com"]).ok).toBe(false);
    expect(checkLaunchDestination(stored, null).ok).toBe(false);
    expect(resolveLandingUrl({ productUrl: LINOE }, ["app.other-domain.com"]).ok).toBe(false);
  });

  it("does not block seller sites (no false positives)", () => {
    for (const url of [
      "https://tokosaya.com/produk",
      "https://tokosaya.netlify.app/",
      "https://nottanyopo-ai-prompter.netlify.app/",
      "https://evil.example.com/tanyopo-ai-prompter.netlify.app",
      "https://example.com/?r=https://tanyopo-ai-prompter.netlify.app",
    ]) {
      expect(validateLandingUrl(url, ["app.other-domain.com"]).ok, url).toBe(true);
    }
  });

  it("host helpers", () => {
    expect(isOwnAppHostname("tanyopo-ai-prompter.netlify.app")).toBe(true);
    expect(isOwnAppHostname("tokosaya.com")).toBe(false);
    expect(isOwnAppHostname("app.other-domain.com", ["app.other-domain.com"])).toBe(true);
    expect(isOwnAppUrl("not a url")).toBe(false);
    expect(isOwnAppUrl(LINOE)).toBe(true);
  });
});

describe("no regression in the existing validator", () => {
  it.each([
    "http://tokosaya.com",
    "https://127.0.0.1/",
    "https://localhost/",
    "https://10.0.0.1/",
    "https://intranet/",
    "https://u:p@tokosaya.com/",
    "https://tokosaya.com:8443/",
    "https://abcd.supabase.co/",
    "ftp://tokosaya.com",
    "",
  ])("still rejects %j", (url) => {
    expect(validateLandingUrl(url, ["abcd.supabase.co"]).ok).toBe(false);
  });
  it("still returns a valid URL untouched", () => {
    const raw = "https://tokosaya.com/p?aff=ABC&x=1#frag";
    const r = validateLandingUrl(raw, []);
    expect(r.ok && r.value).toBe(raw);
  });
  it("env-derived own hosts are still honoured", () => {
    expect(validateLandingUrl("https://app.other-domain.com/", ["app.other-domain.com"]).ok).toBe(false);
  });
});

describe("wizard default (safeWebsiteDefault)", () => {
  it("product with LINOE URL gives an empty default", () => {
    expect(safeWebsiteDefault(LINOE, null)).toBeNull();
    expect(safeWebsiteDefault(LINOE, [])).toBeNull();
    expect(safeWebsiteDefault(LINOE, ["app.other-domain.com"])).toBeNull();
  });
  it("empty, missing or unusable values give an empty default", () => {
    expect(safeWebsiteDefault(null, [])).toBeNull();
    expect(safeWebsiteDefault(undefined, [])).toBeNull();
    expect(safeWebsiteDefault("   ", [])).toBeNull();
    expect(safeWebsiteDefault("http://tokosaya.com", [])).toBeNull();
  });
  it("a valid seller URL is kept as is", () => {
    expect(safeWebsiteDefault("https://tokosaya.com/produk?id=1", ["app.other-domain.com"])).toBe(
      "https://tokosaya.com/produk?id=1",
    );
  });
  it("quick and full wizard get the same, server-sanitised products", () => {
    const page = read("app/(app)/promote/page.tsx");
    expect(page).toMatch(/safeWebsiteDefault\(p\.website_url, ownHosts\)/);
    expect(page.match(/products=\{productOptions\}/g)?.length).toBe(2);
    expect(page).not.toMatch(/products=\{products \?\? \[\]\}/);
    expect(page).toMatch(/\.eq\("tenant_id", session\.tenantId\)/);
  });
});

describe("product form", () => {
  const base = { name: "Produk Uji", productType: "APPLICATION" };
  it("rejects LINOE URL on create/edit schema", () => {
    for (const url of [LINOE, `${LINOE}/x`, "https://main--tanyopo-ai-prompter.netlify.app"]) {
      expect(productSchema.safeParse({ ...base, websiteUrl: url }).success, url).toBe(false);
    }
  });
  it("accepts a seller URL and an empty URL", () => {
    expect(productSchema.safeParse({ ...base, websiteUrl: "https://tokosaya.com" }).success).toBe(true);
    expect(productSchema.safeParse({ ...base, websiteUrl: "" }).success).toBe(true);
    expect(productSchema.safeParse({ ...base }).success).toBe(true);
  });
  it("create and update both check env-configured own hosts and keep tenant scoping", () => {
    const src = read("features/products/actions.ts");
    expect(src.match(/ownWebsiteUrlError\(parsed\.data\.websiteUrl\)/g)?.length).toBe(2);
    expect(src).toMatch(/\.eq\("id", productId\)\s*\.eq\("tenant_id", session\.tenantId\)/);
  });
});

describe("scope guards", () => {
  it("paid-ad gate is still default-deny", () => {
    expect(BUDGET_WRITE_ENABLED_PLATFORMS).toEqual([]);
  });
  it("PR #54 behaviour is intact: purchase destination key and launch gate", () => {
    const launch = read("features/campaigns/launch-actions.ts");
    expect(launch).toMatch(/earlyDestination/);
    expect(launch).toMatch(/withUtm\(dest\.link/);
    expect(read("lib/campaigns/purchase-destination.ts")).toMatch(/PURCHASE_DESTINATION_KEY = "purchase_destination"/);
  });
  it("no billing, trial or AI quota code is imported by the touched modules", () => {
    for (const f of ["lib/campaigns/meta-launch-preflight.ts", "schemas/products.ts"]) {
      expect(read(f)).not.toMatch(/billing|trial|ai-jobs|@\/services/i);
    }
  });
});
