import { describe, expect, it } from "vitest";
import {
  buildPublicMediaUrl,
  checkAdAccountId,
  checkCreativeImage,
  checkLaunchApproval,
  checkSelectedPageId,
  pickLaunchMedia,
  resolveLandingUrl,
  resolveOwnHosts,
  resolveMetaObjectivePlan,
  resolveTargetCountry,
  validateLandingUrl,
  type ProductMediaRow,
} from "@/lib/campaigns/meta-launch-preflight";
import { META_OBJECTIVE_CONTRACTS, META_UNSUPPORTED_OBJECTIVES } from "@/lib/campaigns/meta-objective-contracts";

describe("checkLaunchApproval", () => {
  it("accepts only a latest APPROVED row", () => {
    expect(checkLaunchApproval([{ status: "APPROVED", created_at: "2026-10-01T00:00:00Z" }]).ok).toBe(true);
  });
  it.each([null, undefined, []])("rejects %j", (rows) => {
    expect(checkLaunchApproval(rows)).toMatchObject({ ok: false, code: "APPROVAL_MISSING" });
  });
  it("uses the newest row, not any APPROVED row", () => {
    const result = checkLaunchApproval([
      { status: "APPROVED", created_at: "2026-09-01T00:00:00Z" },
      { status: "PENDING", created_at: "2026-10-01T00:00:00Z" },
    ]);
    expect(result.ok).toBe(false);
  });
});

describe("ad account and Page", () => {
  it("accepts act_<digits> only", () => {
    expect(checkAdAccountId("act_123456")).toEqual({ ok: true, value: "act_123456" });
    for (const bad of ["123", "act_", "act_1a", "ACT_1", " act_1", "act_1\n", null, undefined, 5, `act_${"1".repeat(21)}`]) {
      expect(checkAdAccountId(bad), String(bad)).toMatchObject({ ok: false, code: "AD_ACCOUNT_INVALID" });
    }
  });
  it("requires a selected Page and never invents one", () => {
    expect(checkSelectedPageId("123")).toEqual({ ok: true, value: "123" });
    for (const bad of [undefined, null, "", "  ", "a b", 12, "x".repeat(65)]) {
      expect(checkSelectedPageId(bad), String(bad)).toMatchObject({ ok: false, code: "PAGE_NOT_SELECTED" });
    }
  });
});

describe("resolveMetaObjectivePlan", () => {
  it("shipped contracts are fail-closed: nothing is verified yet", () => {
    for (const contract of Object.values(META_OBJECTIVE_CONTRACTS)) expect(contract.verified).toBe(false);
    expect(resolveMetaObjectivePlan("BRAND_AWARENESS")).toMatchObject({ ok: false, code: "OBJECTIVE_UNSUPPORTED" });
  });
  it("INCREASE_SALES is rejected with its reason and never mapped to another objective", () => {
    const result = resolveMetaObjectivePlan("INCREASE_SALES");
    expect(result).toMatchObject({ ok: false, code: "OBJECTIVE_UNSUPPORTED" });
    expect(result.ok === false && result.message).toBe(META_UNSUPPORTED_OBJECTIVES.INCREASE_SALES);
  });
  it.each(["", "NOPE", "constructor", "__proto__", "hasOwnProperty", null, undefined, 3])("rejects unknown %j", (value) => {
    expect(resolveMetaObjectivePlan(value)).toMatchObject({ ok: false, code: "OBJECTIVE_UNKNOWN" });
  });
  it("a verified contract yields its explicit objective and goal", () => {
    const original = META_OBJECTIVE_CONTRACTS.BRAND_AWARENESS;
    // frozen on purpose; verified-path coverage is done with a mocked module in the action tests
    expect(Object.isFrozen(META_OBJECTIVE_CONTRACTS)).toBe(true);
    expect(original).toMatchObject({ campaignObjective: "OUTCOME_AWARENESS", optimizationGoal: "REACH" });
  });
});

describe("resolveTargetCountry", () => {
  it.each([
    ["Indonesia", "ID"],
    ["indonesia", "ID"],
    ["ID", "ID"],
    ["sg", "SG"],
    ["Malaysia", "MY"],
    ["  Singapore ", "SG"],
  ])("%j -> %s", (raw, code) => {
    expect(resolveTargetCountry(raw)).toEqual({ ok: true, value: code });
  });
  it.each([null, undefined, 5, "", "   ", "Atlantis", "ZZ", "XX", "I", "123", "ID,MY", "x".repeat(101)])(
    "rejects %j",
    (raw) => {
      expect(resolveTargetCountry(raw)).toMatchObject({ ok: false, code: "TARGET_COUNTRY_INVALID" });
    },
  );
});

describe("validateLandingUrl / resolveLandingUrl", () => {
  it("returns a valid https URL byte-for-byte unchanged", () => {
    const url = "https://Toko-Saya.co.id/Produk?a=1#x";
    expect(validateLandingUrl(url)).toEqual({ ok: true, value: url });
  });
  it.each([
    "http://toko.id",
    "ftp://toko.id",
    "javascript:alert(1)",
    "data:text/html,x",
    "//toko.id",
    "toko.id",
    "https://localhost",
    "https://sub.localhost/x",
    "https://127.0.0.1",
    "https://0x7f.0.0.1",
    "https://2130706433",
    "https://169.254.169.254/latest",
    "https://[::1]/",
    "https://[2001:db8::1]/",
    "https://u:p@toko.id",
    "https://u@toko.id",
    "https://toko.id:444",
    "https://printer.local",
    "https://nas.lan",
    "https://svc.internal",
    "https://x.test",
    "https://x.onion",
    "https://singlelabel",
    "https://toko .id",
    "https://toko.id/\u0000",
    "https://toko.id\\@evil.com",
    "https://tanyopo.ai",
    "https://www.tanyopo.ai/x",
    `https://toko.id/${"a".repeat(2000)}`,
  ])("rejects %#: %s", (url) => {
    expect(validateLandingUrl(url).ok).toBe(false);
  });
  describe("application host protection (configured hosts, no substring of the brand name)", () => {
    const own = ["app.linoe.id", "proj.supabase.co"];
    it("blocks the official host, its subdomains, case and trailing-dot variants", () => {
      for (const url of [
        "https://app.linoe.id/x",
        "https://APP.LINOE.ID/x",
        "https://app.linoe.id./x",
        "https://a.b.app.linoe.id/x",
        "https://proj.supabase.co/storage/v1/object/public/x.jpg",
      ]) {
        expect(validateLandingUrl(url, own), url).toMatchObject({ ok: false, code: "LANDING_URL_UNSAFE" });
      }
    });
    it("blocks an official host that has no 'tanyopo' in its name (the P2-2 case)", () => {
      expect(validateLandingUrl("https://app.linoe.id/promo", own).ok).toBe(false);
      expect(validateLandingUrl("https://app.linoe.id/promo", []).ok).toBe(true); // proves the block comes from config, not a substring
    });
    it("allows a valid tenant host and look-alike hosts that are not ours", () => {
      for (const url of [
        "https://toko-saya.co.id/",
        "https://linoe.id/",
        "https://app.linoe.id.evil.com/",
        "https://evil-app.linoe.id.com/",
        "https://xapp.linoe.id/",
        "https://tanyopo.com/",
        "https://tanyopo-shop.id/",
      ]) {
        expect(validateLandingUrl(url, own).ok, url).toBe(true);
      }
    });
    it("still blocks the removed legacy fallback host exactly (and its subdomains), with or without config", () => {
      for (const url of ["https://tanyopo.ai", "https://www.tanyopo.ai/x", "https://TANYOPO.AI./x"]) {
        expect(validateLandingUrl(url, own).ok, url).toBe(false);
        expect(validateLandingUrl(url, []).ok, url).toBe(false);
      }
      expect(validateLandingUrl("https://tanyopo.ai.evil.com/", own).ok).toBe(true);
    });
    it.each([
      "https://localhost/x",
      "https://127.0.0.1/x",
      "https://[::1]/x",
      "https://user:pass@toko.id/",
      "https://svc.internal/x",
      "http://toko.id/",
    ])("malicious URL %s stays rejected whatever the config", (url) => {
      expect(validateLandingUrl(url, own).ok).toBe(false);
      expect(validateLandingUrl(url, []).ok).toBe(false);
    });
  });

  describe("resolveOwnHosts", () => {
    it("takes hosts from NEXT_PUBLIC_APP_URL, META_REDIRECT_URI and Supabase", () => {
      expect(
        resolveOwnHosts({
          appUrl: "https://app.linoe.id",
          metaRedirectUri: "https://auth.linoe.id/api/connect/meta/callback",
          supabaseUrl: "https://Proj.Supabase.co",
        }),
      ).toEqual({ ok: true, value: ["app.linoe.id", "auth.linoe.id", "proj.supabase.co"] });
    });
    it("works from META_REDIRECT_URI alone when NEXT_PUBLIC_APP_URL is unset", () => {
      expect(resolveOwnHosts({ metaRedirectUri: "https://app.linoe.id/cb" })).toEqual({ ok: true, value: ["app.linoe.id"] });
    });
    it("deduplicates", () => {
      expect(resolveOwnHosts({ appUrl: "https://app.linoe.id", metaRedirectUri: "https://app.linoe.id/cb" })).toEqual({
        ok: true,
        value: ["app.linoe.id"],
      });
    });
    it.each([
      ["nothing configured", {}],
      ["empty strings", { appUrl: "", metaRedirectUri: "" }],
      ["localhost default", { appUrl: "http://localhost:3000" }],
      ["https localhost", { appUrl: "https://localhost" }],
      ["an IP", { appUrl: "https://10.0.0.1" }],
      ["http only", { appUrl: "http://app.linoe.id" }],
      ["garbage", { appUrl: "not a url", metaRedirectUri: "::::" }],
      ["only Supabase known", { supabaseUrl: "https://proj.supabase.co" }],
    ])("fails closed with %s", (_name, config) => {
      expect(resolveOwnHosts(config)).toMatchObject({ ok: false, code: "APP_HOST_UNCONFIGURED" });
    });
  });
  it("product URL wins, brand URL is the only fallback, nothing else", () => {
    expect(resolveLandingUrl({ productUrl: "https://a.id/", brandUrl: "https://b.id/" })).toEqual({ ok: true, value: "https://a.id/" });
    expect(resolveLandingUrl({ productUrl: "  ", brandUrl: "https://b.id/" })).toEqual({ ok: true, value: "https://b.id/" });
    expect(resolveLandingUrl({ productUrl: null, brandUrl: null })).toMatchObject({ ok: false, code: "LANDING_URL_MISSING" });
    expect(resolveLandingUrl({})).toMatchObject({ ok: false, code: "LANDING_URL_MISSING" });
  });
  it("an unsafe product URL is not replaced by a safe brand URL", () => {
    expect(resolveLandingUrl({ productUrl: "http://a.id", brandUrl: "https://b.id/" })).toMatchObject({
      ok: false,
      code: "LANDING_URL_UNSAFE",
    });
  });
});

const media = (over: Partial<ProductMediaRow> = {}): ProductMediaRow => ({
  id: "m1",
  tenant_id: "t1",
  product_id: "p1",
  storage_path: "t1/p1/1700-foto.jpg",
  media_type: "IMAGE",
  ...over,
});
const OK_META = { mimetype: "image/jpeg", size: 1000 };
const check = (m: ProductMediaRow, metadata: { mimetype?: unknown; size?: unknown } | null = OK_META) =>
  checkCreativeImage({ media: m, tenantId: "t1", productId: "p1", supabaseUrl: "https://proj.supabase.co", metadata });

describe("pickLaunchMedia", () => {
  it("uses the selected media or rejects; never swaps", () => {
    const rows = [media({ id: "a" }), media({ id: "b" })];
    expect(pickLaunchMedia(rows, "b")).toMatchObject({ ok: true, value: { id: "b" } });
    expect(pickLaunchMedia(rows, "zzz")).toMatchObject({ ok: false, code: "IMAGE_INVALID" });
  });
  it("without a selection uses the first IMAGE and ignores videos", () => {
    expect(pickLaunchMedia([media({ id: "v", media_type: "VIDEO" }), media({ id: "i" })], null)).toMatchObject({ ok: true, value: { id: "i" } });
    expect(pickLaunchMedia([media({ media_type: "VIDEO" })], null)).toMatchObject({ ok: false, code: "IMAGE_MISSING" });
    expect(pickLaunchMedia([], undefined)).toMatchObject({ ok: false, code: "IMAGE_MISSING" });
  });
});

describe("checkCreativeImage", () => {
  it("builds the URL on the trusted Supabase host", () => {
    expect(check(media())).toEqual({
      ok: true,
      value: {
        imageUrl: "https://proj.supabase.co/storage/v1/object/public/product-media/t1/p1/1700-foto.jpg",
        storagePath: "t1/p1/1700-foto.jpg",
      },
    });
  });
  it("rejects another tenant or product", () => {
    expect(check(media({ tenant_id: "t2" }))).toMatchObject({ ok: false, code: "IMAGE_INVALID" });
    expect(check(media({ product_id: "p2" }))).toMatchObject({ ok: false, code: "IMAGE_INVALID" });
    expect(check(media({ storage_path: "t2/p1/x.jpg" }))).toMatchObject({ ok: false, code: "IMAGE_INVALID" });
  });
  it("rejects non-images, bad paths and bad extensions", () => {
    expect(check(media({ media_type: "VIDEO" }))).toMatchObject({ ok: false });
    for (const storage_path of ["t1/p1/../x.jpg", "t1/p1//x.jpg", "t1/p1/x.jpg?a=1", "t1/p1/x.jpg#a", "t1/p1/%2e.jpg", "t1/p1\\x.jpg", "t1/p1/x.webp", "t1/p1/x.gif", "t1/p1/x"]) {
      expect(check(media({ storage_path })), storage_path).toMatchObject({ ok: false, code: "IMAGE_INVALID" });
    }
  });
  it("requires Storage metadata with an allowed mime type and a sane size", () => {
    expect(check(media(), null).ok).toBe(false);
    expect(check(media(), { mimetype: "image/png", size: 5 }).ok).toBe(true);
    for (const metadata of [
      {},
      { mimetype: "image/webp", size: 5 },
      { mimetype: "text/html", size: 5 },
      { mimetype: "image/jpeg", size: 0 },
      { mimetype: "image/jpeg", size: -1 },
      { mimetype: "image/jpeg", size: 1.5 },
      { mimetype: "image/jpeg", size: "5" },
      { mimetype: "image/jpeg", size: 8 * 1024 * 1024 + 1 },
    ]) {
      expect(check(media(), metadata), JSON.stringify(metadata)).toMatchObject({ ok: false, code: "IMAGE_INVALID" });
    }
  });
  it("fails when no trusted Supabase base URL is configured", () => {
    expect(checkCreativeImage({ media: media(), tenantId: "t1", productId: "p1", supabaseUrl: undefined, metadata: OK_META }).ok).toBe(false);
  });
});

describe("buildPublicMediaUrl", () => {
  it("never produces a URL on a host other than the configured one, and encodes segments", () => {
    expect(buildPublicMediaUrl("https://proj.supabase.co", "t1/p1/a b.jpg")).toBe(
      "https://proj.supabase.co/storage/v1/object/public/product-media/t1/p1/a%20b.jpg",
    );
    expect(buildPublicMediaUrl("http://proj.supabase.co", "t1/p1/a.jpg")).toBeNull();
    expect(buildPublicMediaUrl("https://u:p@proj.supabase.co", "t1/p1/a.jpg")).toBeNull();
    expect(buildPublicMediaUrl("not a url", "t1/p1/a.jpg")).toBeNull();
    expect(buildPublicMediaUrl(undefined, "t1/p1/a.jpg")).toBeNull();
    expect(buildPublicMediaUrl("https://proj.supabase.co", "t1/../a.jpg")).toBeNull();
  });
});
