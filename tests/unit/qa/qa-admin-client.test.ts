import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createQaAdminClient, QaAdminError } from "../../../scripts/qa/qa-admin-client.mjs";
import { QA_SENDER_DOMAIN, isLockedQaAddress } from "../../../scripts/qa/real-e2e-guard.mjs";

// Semua nilai PALSU. Tidak ada jaringan nyata: fetch disuntik.
const REF = "gasdqsadnjoknisloaec";
const URL_OK = `https://${REF}.supabase.co`;
const SECRET = "FAKE-SECRET-KEY-VALUE-987";
const EMAIL = `qa-fixed@${QA_SENDER_DOMAIN}`;
const UID = "11111111-1111-4111-8111-111111111111";
const TID = "22222222-2222-4222-8222-222222222222";

type Call = { url: string; method: string; headers: Record<string, string> };
type Handler = (c: Call) => { status?: number; body?: unknown } | undefined;

function fakeFetch(handler: Handler) {
  const calls: Call[] = [];
  const impl = async (url: string, init: { method: string; headers: Record<string, string> }) => {
    const c = { url, method: init.method, headers: init.headers };
    calls.push(c);
    const r = handler(c) ?? { status: 200, body: [] };
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => JSON.stringify(r.body ?? []) };
  };
  return { impl, calls };
}

// Handler "dunia" QA: satu pengguna + profil + tenant.
function world(opts: { members?: string[]; users?: unknown[]; fail?: string } = {}) {
  return (c: Call) => {
    if (opts.fail && c.url.includes(opts.fail)) return { status: 500, body: { code: "XX000", message: SECRET } };
    if (c.url.includes("/auth/v1/admin/users?")) return { body: { users: opts.users ?? [{ id: UID, email: EMAIL }, { id: "other", email: "x@y.com" }] } };
    if (c.url.includes("/rest/v1/user_profiles?id=")) return { body: [{ id: UID, tenant_id: TID }] };
    if (c.url.includes("/rest/v1/user_profiles?tenant_id=")) return { body: (opts.members ?? [UID]).map((id) => ({ id })) };
    if (c.url.includes("/rest/v1/prompter_subscriptions") && c.method === "GET")
      return { body: [{ status: "TRIALING", plan: "FREE", current_period_end: "2026-12-01T00:00:00Z" }] };
    if (c.method === "DELETE" && c.url.includes("/rest/v1/prompter_subscriptions")) return { body: [{ tenant_id: TID }] };
    if (c.method === "DELETE" && c.url.includes("/rest/v1/tenants")) return { body: [{ id: TID }] };
    if (c.method === "DELETE" && c.url.includes("/auth/v1/admin/users/")) return { body: {} };
    return { body: [] };
  };
}

function make(handler: Handler = world(), over: Record<string, unknown> = {}) {
  const f = fakeFetch(handler);
  const client = createQaAdminClient({ url: URL_OK, secretKey: SECRET, expectedRef: REF, identityEmail: EMAIL, fetchImpl: f.impl as never, ...over } as never);
  return { client, ...f };
}

describe("konstruktor fail-closed", () => {
  const base = { secretKey: SECRET, expectedRef: REF, identityEmail: EMAIL, fetchImpl: fakeFetch(world()).impl };
  const bad: Array<[string, Record<string, unknown>]> = [
    ["host .supabase.com", { url: `https://${REF}.supabase.com` }],
    ["ref lain", { url: "https://abcdefghij0123456789.supabase.co", expectedRef: "abcdefghij0123456789" }],
    ["ref produksi bersama (umkmpro-ai)", { url: "https://wjjyqovhmwenbcvbnkgx.supabase.co", expectedRef: "wjjyqovhmwenbcvbnkgx" }],
    ["ref != expectedRef", { url: URL_OK, expectedRef: "abcdefghij0123456789" }],
    ["trailing slash", { url: `${URL_OK}/` }],
    ["path tambahan", { url: `${URL_OK}/rest/v1` }],
    ["http", { url: `http://${REF}.supabase.co` }],
    ["url userinfo", { url: `https://x@${REF}.supabase.co` }],
    ["url bukan string", { url: 5 }],
    ["secret kosong", { url: URL_OK, secretKey: "  " }],
    ["secret hilang", { url: URL_OK, secretKey: undefined }],
    ["plus-address", { url: URL_OK, identityEmail: `qa+1@${QA_SENDER_DOMAIN}` }],
    ["domain asing", { url: URL_OK, identityEmail: "qa@tanyopo.com" }],
    ["dua alamat", { url: URL_OK, identityEmail: `a@${QA_SENDER_DOMAIN},b@${QA_SENDER_DOMAIN}` }],
    ["tanpa fetch", { url: URL_OK, fetchImpl: 1 }],
  ];
  for (const [name, over] of bad) {
    it(`menolak ${name}`, () => {
      expect(() => createQaAdminClient({ ...base, ...over } as never)).toThrow(QaAdminError);
    });
  }
  it("galat konstruksi tidak memuat secret", () => {
    try {
      createQaAdminClient({ ...base, url: "https://abcdefghij0123456789.supabase.co" } as never);
    } catch (e) {
      expect(String((e as Error).message)).not.toContain(SECRET);
    }
  });
  it("validator identitas sama nilainya dengan guard", () => {
    for (const v of [EMAIL, `qa+x@${QA_SENDER_DOMAIN}`, "a@b.com", `A.B-c@${QA_SENDER_DOMAIN}`, `a@${QA_SENDER_DOMAIN}\n`, `a b@${QA_SENDER_DOMAIN}`]) {
      const expectOk = isLockedQaAddress(v);
      const ctor = () => createQaAdminClient({ ...base, url: URL_OK, identityEmail: v } as never);
      if (expectOk) expect(ctor).not.toThrow();
      else expect(ctor).toThrow();
    }
  });
});

describe("identitas terkunci", () => {
  const others = ["other@qa.tanyopo.com", "customer@gmail.com", `QA-FIXED@${QA_SENDER_DOMAIN}`, `qa-fixed+1@${QA_SENDER_DOMAIN}`, "", undefined, null, 5];
  it("findUserByEmail dan getTrial menolak email lain tanpa jaringan", async () => {
    const { client, calls } = make();
    for (const e of others) {
      await expect(client.findUserByEmail(e as never)).rejects.toThrow(QaAdminError);
      await expect(client.getTrial(e as never)).rejects.toThrow(QaAdminError);
    }
    expect(calls.length).toBe(0);
  });
  it("deleteUser menolak id non-UUID dan id pengguna lain (tanpa DELETE terkirim)", async () => {
    const { client, calls } = make();
    await expect(client.deleteUser("bukan-uuid")).rejects.toThrow(QaAdminError);
    await expect(client.deleteUser("33333333-3333-4333-8333-333333333333")).rejects.toThrow(QaAdminError);
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
  });
  it("tidak ada metode massal atau perpanjangan trial", () => {
    const { client } = make();
    expect(Object.keys(client).sort()).toEqual(["deleteUser", "findUserByEmail", "getTrial", "resetIdentity", "toJSON", "url"].sort());
    for (const k of Object.keys(client)) expect(k).not.toMatch(/^(list|all|bulk|extend|update|grant|create|set)|bulk|extend/i);
    expect(Object.isFrozen(client)).toBe(true);
  });
});

describe("operasi", () => {
  it("findUserByEmail mengembalikan hanya identitas, kecocokan eksak", async () => {
    const { client, calls } = make();
    expect(await client.findUserByEmail(EMAIL)).toEqual({ id: UID });
    expect(calls[0].url).toBe(`${URL_OK}/auth/v1/admin/users?filter=${encodeURIComponent(EMAIL)}&page=1&per_page=20`);
    expect(calls[0].method).toBe("GET");
  });
  it("findUserByEmail null bila tidak ada; galat bila halaman penuh tanpa cocok", async () => {
    expect(await make(world({ users: [] })).client.findUserByEmail(EMAIL)).toBeNull();
    const full = Array.from({ length: 20 }, (_, i) => ({ id: String(i), email: `u${i}@x.com` }));
    await expect(make(world({ users: full })).client.findUserByEmail(EMAIL)).rejects.toThrow(/ambigu/);
  });
  it("reset: semua request berfilter identitas/tenant hasil lookup, urutan aman", async () => {
    const { client, calls } = make();
    const r = await client.resetIdentity();
    expect(r).toEqual({ deleted: true, userId: UID, tenantId: TID });
    const dels = calls.filter((c) => c.method === "DELETE").map((c) => c.url.replace(URL_OK, ""));
    expect(dels).toEqual([
      `/rest/v1/prompter_subscriptions?tenant_id=eq.${TID}&select=tenant_id`,
      `/rest/v1/tenants?id=eq.${TID}&select=id`,
      `/auth/v1/admin/users/${UID}`,
    ]);
    for (const c of calls) {
      expect(c.url.startsWith(`${URL_OK}/`)).toBe(true);
      if (c.url.includes("/rest/v1/")) expect(c.url).toMatch(new RegExp(`[?&](id|tenant_id)=eq\\.(${UID}|${TID})(&|$)`));
    }
  });
  it("deleteUser(id identitas) menjalankan reset yang sama", async () => {
    const { client, calls } = make();
    await client.deleteUser(UID);
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(3);
  });
  it("reset idempoten: tanpa pengguna = tidak ada DELETE", async () => {
    const { client, calls } = make(world({ users: [] }));
    expect(await client.resetIdentity()).toEqual({ deleted: false, userId: null, tenantId: null });
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });
  it("tenant dengan anggota lain: batal tanpa DELETE (jangan menebak)", async () => {
    const { client, calls } = make(world({ members: [UID, "44444444-4444-4444-8444-444444444444"] }));
    await expect(client.resetIdentity()).rejects.toThrow(/UNKNOWN/);
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });
  it("getTrial hanya membaca; memetakan current_period_end ke trial_ends_at", async () => {
    const { client, calls } = make();
    expect(await client.getTrial(EMAIL)).toEqual({ status: "TRIALING", plan: "FREE", trial_ends_at: "2026-12-01T00:00:00Z" });
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(calls[calls.length - 1].url).toContain(`prompter_subscriptions?tenant_id=eq.${TID}`);
  });
  it("kredensial dikirim sebagai header, bukan di URL", async () => {
    const { client, calls } = make();
    await client.findUserByEmail(EMAIL);
    expect(calls[0].headers.apikey).toBe(SECRET);
    expect(calls[0].url).not.toContain(SECRET);
  });
});

describe("secret tidak bocor", () => {
  it("tidak di JSON, String, inspect, atau properti", () => {
    const { client } = make();
    expect(JSON.stringify(client)).not.toContain(SECRET);
    expect(String(client)).not.toContain(SECRET);
    expect(JSON.stringify(Object.getOwnPropertyDescriptors(client), (_k, v) => (typeof v === "function" ? "fn" : v))).not.toContain(SECRET);
    for (const v of Object.values(client)) expect(v).not.toBe(SECRET);
  });
  it("tidak di galat HTTP (badan respons berisi secret), galat jaringan, maupun console", async () => {
    const logged: string[] = [];
    const orig = [console.log, console.error, console.warn];
    console.log = console.error = console.warn = (...a: unknown[]) => void logged.push(a.join(" "));
    try {
      const a = make(world({ fail: "/auth/v1/admin/users?" }));
      const e1 = await a.client.findUserByEmail(EMAIL).catch((e: Error) => e);
      expect(String((e1 as Error).message)).toMatch(/HTTP 500/);
      const f = async () => {
        throw new Error(`koneksi gagal ${SECRET}`);
      };
      const b = make(world(), { fetchImpl: f });
      const e2 = await b.client.findUserByEmail(EMAIL).catch((e: Error) => e);
      for (const e of [e1, e2]) {
        expect(String((e as Error).message)).not.toContain(SECRET);
        expect(String((e as Error).stack ?? "").includes(SECRET)).toBe(false);
      }
    } finally {
      [console.log, console.error, console.warn] = orig;
    }
    expect(logged.join("\n")).not.toContain(SECRET);
  });
});

describe("timeout dan batas ukuran, tanpa retry", () => {
  it("timeout menggugurkan permintaan dan tidak mengulang", async () => {
    let n = 0;
    const hang = (_u: string, init: { signal: AbortSignal }) =>
      new Promise((_res, rej) => {
        n++;
        init.signal.addEventListener("abort", () => rej(new Error("abort")));
      });
    const { client } = make(world(), { fetchImpl: hang, timeoutMs: 20 });
    await expect(client.findUserByEmail(EMAIL)).rejects.toThrow(/timeout/);
    expect(n).toBe(1);
  });
  it("respons terlalu besar ditolak", async () => {
    const big = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => "x".repeat(2000) });
    const { client } = make(world(), { fetchImpl: big, maxBytes: 1000 });
    await expect(client.findUserByEmail(EMAIL)).rejects.toThrow(/batas ukuran/);
  });
  it("HTTP 500 pada DELETE tidak diulang", async () => {
    const { client, calls } = make(world({ fail: "/rest/v1/tenants" }));
    await expect(client.resetIdentity()).rejects.toThrow(/HTTP 500/);
    expect(calls.filter((c) => c.url.includes("/rest/v1/tenants") && c.method === "DELETE")).toHaveLength(1);
    expect(calls.some((c) => c.url.includes("/auth/v1/admin/users/"))).toBe(false);
  });
});

describe("statis: hanya runner server-side", () => {
  const root = path.resolve(__dirname, "../../..");
  function walk(dir: string, out: string[] = []): string[] {
    for (const n of readdirSync(dir)) {
      if (n === "node_modules" || n === ".next") continue;
      const p = path.join(dir, n);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx|js|jsx|mjs|cjs|json)$/.test(n)) out.push(p);
    }
    return out;
  }
  it("tidak ada berkas aplikasi yang mengimpor/mereferensikan qa-admin-client", () => {
    for (const d of ["app", "components", "features", "lib", "services", "proxy.ts"]) {
      const p = path.join(root, d);
      let files: string[];
      try {
        files = statSync(p).isDirectory() ? walk(p) : [p];
      } catch {
        continue;
      }
      for (const f of files) {
        const src = readFileSync(f, "utf8");
        expect(src.includes("qa-admin-client"), f).toBe(false);
        expect(src.includes("createQaAdminClient"), f).toBe(false);
        expect(src.includes("QA_SUPABASE_SECRET_KEY"), f).toBe(false);
      }
    }
  });
  it("sumber client tidak membaca env dan tidak memakai NEXT_PUBLIC_*", () => {
    const src = readFileSync(path.join(root, "scripts/qa/qa-admin-client.mjs"), "utf8");
    expect(src).not.toMatch(/process\.env/);
    expect(src).not.toMatch(/NEXT_PUBLIC_/);
    expect(src).not.toMatch(/wjjyqovhmwenbcvbnkgx/);
  });
  it("real-e2e.mjs memuat client ini (wiring), tetapi hanya dibangun setelah cek QA2_ACTIVATED", () => {
    const src = readFileSync(path.join(root, "scripts/qa/real-e2e.mjs"), "utf8");
    expect(src.includes("qa-admin-client")).toBe(true);
    const body = src.slice(src.indexOf("export async function runMain"));
    expect(body.indexOf('env.QA2_ACTIVATED !== "true"')).toBeGreaterThan(0);
    expect(body.indexOf('env.QA2_ACTIVATED !== "true"')).toBeLessThan(body.indexOf("factories.createQaAdminClient("));
  });
  it("tidak ada NEXT_PUBLIC_* yang memuat secret QA di berkas konfigurasi", () => {
    for (const f of ["netlify.toml", ".env.example", "next.config.ts"]) {
      let src = "";
      try {
        src = readFileSync(path.join(root, f), "utf8");
      } catch {
        continue;
      }
      expect(src).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(SECRET|SERVICE)/);
      expect(src).not.toMatch(/QA_SUPABASE_SECRET_KEY/);
    }
  });
});
