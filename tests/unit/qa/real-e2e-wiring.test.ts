/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as mod from "../../../scripts/qa/real-e2e.mjs";

// Semua nilai PALSU dan tanpa jaringan: seluruh factory dan dependensi adalah fungsi palsu di memori.
// Tipe sengaja longgar (pelajaran #153: .mjs bertipe JSDoc sempit).
const runMain = (mod as any).runMain as (o: any) => Promise<void>;
const runRealE2E = (mod as any).runRealE2E as (d: any) => Promise<{ exitCode: number; report: Record<string, any>; json: string }>;
const closeDriverOnce = (mod as any).closeDriverOnce as (d: any, env: any, s: string[]) => Promise<string | null>;

const FAKE_REF = "abcdefghij0123456789";
const SECRET_SRV = "FAKE-SECRET-VALUE-222";
const SECRET_PUB = "FAKE-PUBLISHABLE-VALUE-111";
const SECRET_TOKEN = "FAKE-INBOX-TOKEN-333";
const APP = "http://localhost:3000";
const SUPA = `https://${FAKE_REF}.supabase.co`;
const NOW = Date.parse("2026-11-14T00:00:00.000Z");
const DAY = 86_400_000;
const GUARD = { allowedRefs: [FAKE_REF] };

const ENV: Record<string, string | undefined> = {
  QA2_CONFIRM: "RUN-QA-2-REAL-EMAIL",
  QA2_ACTIVATED: "true",
  QA_MAX_EMAILS_PER_RUN: "1",
  QA_SUPABASE_URL: SUPA,
  NEXT_PUBLIC_SUPABASE_URL: SUPA,
  QA_PROJECT_REF_EXPECTED: FAKE_REF,
  QA_SUPABASE_PUBLISHABLE_KEY: SECRET_PUB,
  QA_SUPABASE_SECRET_KEY: SECRET_SRV,
  QA_INBOX_READ_TOKEN: SECRET_TOKEN,
  QA_INBOX_ADDRESS: "qa-inbox@qa.tanyopo.com",
  QA_SENDER_EMAIL: "noreply@qa.tanyopo.com",
};
const AUTH_PASS = "mx.fake.invalid; spf=pass smtp.mailfrom=qa.tanyopo.com; dkim=pass header.d=qa.tanyopo.com; dmarc=pass header.from=qa.tanyopo.com";
const LINK = `${APP}/auth/confirm?token_hash=TOKENHASH123&type=signup&next=/onboarding`;

type Opt = { failOn?: string; closeThrows?: string; deleteThrowsOnCleanup?: boolean; adminUrlThrows?: boolean };

function fakes(o: Opt = {}) {
  let exists = true;
  let findCalls = 0;
  let waits = 0;
  let hops = 0;
  const message = { subject: "Konfirmasi", html: `<a href="${LINK.replaceAll("&", "&amp;")}">x</a>`, headers: { "Authentication-Results": AUTH_PASS } };
  const maybeFail = (n: string) => {
    if (o.failOn === n) throw new Error(`gagal-${n}`);
  };
  const adminClient: any = {
    url: SUPA,
    findUserByEmail: vi.fn(async () => {
      findCalls += 1;
      if (o.deleteThrowsOnCleanup && findCalls >= 3) throw new Error("cleanup-gagal");
      return exists ? { id: "u1" } : null;
    }),
    deleteUser: vi.fn(async () => {
      exists = false;
    }),
    getTrial: vi.fn(async () => ({ status: "TRIALING", plan: "FREE", trial_ends_at: new Date(NOW + 14 * DAY).toISOString() })),
  };
  if (o.adminUrlThrows) Object.defineProperty(adminClient, "url", { get: () => { throw new Error(`boom ${SECRET_SRV}`); } });
  const inbox = {
    clear: vi.fn(async () => {}),
    waitForMessage: vi.fn(async () => {
      waits += 1;
      if (waits === 1) return message;
      throw new Error("timeout");
    }),
  };
  const driver = {
    signup: vi.fn(async () => {
      maybeFail("signup");
      return { outcome: "check-email" };
    }),
    signupDuplicate: vi.fn(async () => ({ outcome: "duplicate" })),
    fetchHop: vi.fn(async () => (hops++ === 0 ? { status: 302, location: "/onboarding" } : { status: 200 })),
    completeOnboarding: vi.fn(async () => ({ completed: true })),
    openDashboard: vi.fn(async () => ({ status: 200, url: `${APP}/dashboard` })),
    openBilling: vi.fn(async () => ({ status: 200 })),
    close: vi.fn(async () => {
      if (o.closeThrows) throw new Error(o.closeThrows);
    }),
  };
  return { adminClient, inbox, driver };
}

function deps(o: Opt = {}, env = ENV) {
  const f = fakes(o);
  return { f, d: { env, appUrl: APP, guardOptions: GUARD, password: "PW-FAKE-PASSWORD-999", probeTimeoutMs: 1, clock: { now: () => NOW }, ...f } };
}

function mainHarness(o: Opt & { env?: Record<string, string | undefined>; argv?: string[]; inboxThrows?: string; adminThrows?: string; driverThrows?: string } = {}) {
  const f = fakes(o);
  const factories = {
    createQaAdminClient: vi.fn((opts: any) => {
      void opts;
      if (o.adminThrows) throw new Error(o.adminThrows);
      return f.adminClient;
    }),
    createRealDriver: vi.fn((opts: any) => {
      void opts;
      if (o.driverThrows) throw new Error(o.driverThrows);
      return f.driver;
    }),
    createInboxAdapter: vi.fn((kind: string, opts: any) => {
      void kind;
      void opts;
      if (o.inboxThrows) throw new Error(o.inboxThrows);
      return f.inbox;
    }),
    fetch: vi.fn(),
    now: () => NOW,
  };
  const exit = vi.fn();
  const out: string[] = [];
  const io = { log: (s: string) => out.push(s), error: (s: string) => out.push(s) };
  const run = () => runMain({ argv: o.argv ?? [], env: o.env ?? ENV, factories, exit, io, guardOptions: GUARD });
  const built = () => factories.createQaAdminClient.mock.calls.length + factories.createRealDriver.mock.calls.length + factories.createInboxAdapter.mock.calls.length;
  return { f, factories, exit, out, run, built };
}

describe("runMain: default inert dan fail-closed", () => {
  it("tanpa QA2_ACTIVATED=true: exit 3, tidak ada konstruksi, tidak ada dependensi dipanggil", async () => {
    const h = mainHarness({ env: { ...ENV, QA2_ACTIVATED: undefined } });
    await h.run();
    expect(h.exit).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledWith(3);
    expect(h.built()).toBe(0);
    expect(h.f.driver.close).not.toHaveBeenCalled();
    expect(h.f.driver.signup).not.toHaveBeenCalled();
    expect(h.f.adminClient.findUserByEmail).not.toHaveBeenCalled();
    expect(h.out.join("\n")).toContain("QA-2 NOT ACTIVATED");
  });

  it('QA2_ACTIVATED selain "true" (mis. "1", "TRUE") tetap inert', async () => {
    for (const v of ["1", "TRUE", "yes", ""]) {
      const h = mainHarness({ env: { ...ENV, QA2_ACTIVATED: v } });
      await h.run();
      expect(h.exit).toHaveBeenCalledWith(3);
      expect(h.built()).toBe(0);
    }
  });

  it("guard gagal: exit 2 tanpa konstruksi", async () => {
    const h = mainHarness({ env: { ...ENV, QA_SUPABASE_SECRET_KEY: undefined } });
    await h.run();
    expect(h.exit).toHaveBeenCalledWith(2);
    expect(h.exit).toHaveBeenCalledTimes(1);
    expect(h.built()).toBe(0);
  });

  it("lingkungan produksi/hosting ditolak: exit 2 tanpa konstruksi", async () => {
    const h = mainHarness({ env: { ...ENV, NETLIFY: "true" } });
    await h.run();
    expect(h.exit).toHaveBeenCalledWith(2);
    expect(h.built()).toBe(0);
  });

  it('QA_MAX_EMAILS_PER_RUN tetap wajib persis "1"', async () => {
    for (const v of [undefined, "2", "0", "01", " 1"]) {
      const h = mainHarness({ env: { ...ENV, QA_MAX_EMAILS_PER_RUN: v } });
      await h.run();
      expect(h.exit).toHaveBeenCalledWith(2);
      expect(h.built()).toBe(0);
    }
  });

  it("--guard-only: exit 0 tanpa konstruksi", async () => {
    const h = mainHarness({ argv: ["--guard-only"] });
    await h.run();
    expect(h.exit).toHaveBeenCalledWith(0);
    expect(h.built()).toBe(0);
  });

  it("QA_APP_URL ke host produksi atau non-lokal http ditolak: exit 2 tanpa konstruksi", async () => {
    for (const url of ["https://app.tanyopo.com", "https://x.netlify.app", "http://example.test", "not a url"]) {
      const h = mainHarness({ env: { ...ENV, QA_APP_URL: url } });
      await h.run();
      expect(h.exit).toHaveBeenCalledWith(2);
      expect(h.built()).toBe(0);
    }
  });
});

describe("runMain: wiring nyata (factory suntikan)", () => {
  it("meneruskan opsi persis ke tiga factory, appUrl bawaan localhost:3000, lalu exit dengan kode runRealE2E", async () => {
    const h = mainHarness();
    await h.run();
    expect(h.factories.createQaAdminClient).toHaveBeenCalledWith({
      url: SUPA,
      secretKey: SECRET_SRV,
      expectedRef: FAKE_REF,
      identityEmail: "qa-inbox@qa.tanyopo.com",
    });
    const dOpts = h.factories.createRealDriver.mock.calls[0][0];
    expect(dOpts).toMatchObject({ appUrl: APP, qaSupabaseUrl: SUPA });
    expect(dOpts.allowedOrigins).toEqual([APP, SUPA]);
    expect(dOpts.browser).toBeUndefined(); // driver mengimpor playwright sendiri (gagal tertutup bila tak ada)
    expect(h.factories.createInboxAdapter).toHaveBeenCalledWith("resend", { fetch: h.factories.fetch, token: SECRET_TOKEN, address: "qa-inbox@qa.tanyopo.com" });
    expect(h.exit).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledWith(0);
    expect(h.f.driver.signup).toHaveBeenCalledTimes(1); // batas 1 email
    expect(h.f.driver.close).toHaveBeenCalledTimes(1);
  });

  it("QA_APP_URL lokal dipakai bila ada", async () => {
    const h = mainHarness({ env: { ...ENV, QA_APP_URL: "http://127.0.0.1:3100" } });
    await h.run();
    expect(h.factories.createRealDriver.mock.calls[0][0].appUrl).toBe("http://127.0.0.1:3100");
  });

  it("run gagal: exit 1 dan driver ditutup sekali", async () => {
    const h = mainHarness({ failOn: "signup" });
    await h.run();
    expect(h.exit).toHaveBeenCalledWith(1);
    expect(h.f.driver.close).toHaveBeenCalledTimes(1);
  });

  it("konstruksi parsial: inbox gagal setelah driver dibuat -> driver ditutup, exit 2, tanpa efek samping", async () => {
    const h = mainHarness({ inboxThrows: "INBOX_MISCONFIGURED: parameter wajib kosong (token)" });
    await h.run();
    expect(h.exit).toHaveBeenCalledWith(2);
    expect(h.f.driver.close).toHaveBeenCalledTimes(1);
    expect(h.f.driver.signup).not.toHaveBeenCalled();
    expect(h.f.adminClient.findUserByEmail).not.toHaveBeenCalled();
    expect(h.f.adminClient.deleteUser).not.toHaveBeenCalled();
  });

  it("admin client gagal: driver tidak pernah dibuat, exit 2", async () => {
    const h = mainHarness({ adminThrows: "ref url tidak ada di allowlist proyek QA" });
    await h.run();
    expect(h.exit).toHaveBeenCalledWith(2);
    expect(h.factories.createRealDriver).not.toHaveBeenCalled();
    expect(h.factories.createInboxAdapter).not.toHaveBeenCalled();
  });

  it("driver gagal dibangun (mis. allowlist): exit 2, tanpa inbox", async () => {
    const h = mainHarness({ driverThrows: "DRIVER REFUSED: x" });
    await h.run();
    expect(h.exit).toHaveBeenCalledWith(2);
    expect(h.factories.createInboxAdapter).not.toHaveBeenCalled();
  });

  it("inbox NOT_IMPLEMENTED: exit 3 dan driver ditutup", async () => {
    const h = mainHarness({ inboxThrows: "NOT_IMPLEMENTED: provider not chosen" });
    await h.run();
    expect(h.exit).toHaveBeenCalledWith(3);
    expect(h.f.driver.close).toHaveBeenCalledTimes(1);
  });

  it("kesalahan tak terduga (throw di runRealE2E): exit 1, driver ditutup sekali, secret tersamar", async () => {
    const h = mainHarness({ adminUrlThrows: true });
    await h.run();
    expect(h.exit).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledWith(1);
    expect(h.f.driver.close).toHaveBeenCalledTimes(1);
    expect(h.out.join("\n")).not.toContain(SECRET_SRV);
  });

  it("close gagal tidak menutupi hasil (PASS tetap exit 0) dan galatnya dicatat tanpa secret/URL", async () => {
    const h = mainHarness({ closeThrows: `gagal tutup ${SECRET_SRV} https://x.example/path?token=${SECRET_TOKEN}` });
    await h.run();
    expect(h.exit).toHaveBeenCalledWith(0);
    const all = h.out.join("\n");
    expect(all).toContain("closeError");
    for (const s of [SECRET_SRV, SECRET_TOKEN, SECRET_PUB, "PW-FAKE-PASSWORD-999", "TOKENHASH123", "x.example"]) expect(all).not.toContain(s);
  });

  it("secret tidak bocor ke output saat konstruksi gagal membawa secret di pesan", async () => {
    const h = mainHarness({ inboxThrows: `bocor ${SECRET_TOKEN} dan ${SECRET_SRV}` });
    await h.run();
    const all = h.out.join("\n");
    expect(all).not.toContain(SECRET_TOKEN);
    expect(all).not.toContain(SECRET_SRV);
  });

  it("secret tidak bocor pada run sukses (stdout/stderr)", async () => {
    const h = mainHarness();
    await h.run();
    const all = h.out.join("\n");
    for (const s of [SECRET_SRV, SECRET_TOKEN, SECRET_PUB, "PW-FAKE-PASSWORD-999", "TOKENHASH123"]) expect(all).not.toContain(s);
  });
});

describe("runRealE2E: driver.close() di semua jalur, tepat sekali", () => {
  it("sukses", async () => {
    const { f, d } = deps();
    const r = await runRealE2E(d);
    expect(r.exitCode).toBe(0);
    expect(f.driver.close).toHaveBeenCalledTimes(1);
    expect(r.report.closeError).toBeUndefined();
  });

  it("gagal di tengah langkah (signup throw)", async () => {
    const { f, d } = deps({ failOn: "signup" });
    const r = await runRealE2E(d);
    expect(r.exitCode).toBe(1);
    expect(f.driver.close).toHaveBeenCalledTimes(1);
  });

  it("cleanup gagal (langkah 11 throw)", async () => {
    const { f, d } = deps({ deleteThrowsOnCleanup: true });
    const r = await runRealE2E(d);
    expect(r.exitCode).toBe(1);
    expect(f.driver.close).toHaveBeenCalledTimes(1);
  });

  it("close gagal tidak menutupi hasil: PASS tetap PASS, galat tercatat tanpa secret", async () => {
    const { f, d } = deps({ closeThrows: `err ${SECRET_SRV} https://evil.example/x` });
    const r = await runRealE2E(d);
    expect(r.exitCode).toBe(0);
    expect(r.report.result).toBe("PASS");
    expect(r.report.closeError).toContain("[REDACTED");
    expect(r.json).not.toContain(SECRET_SRV);
    expect(r.json).not.toContain("evil.example");
    expect(f.driver.close).toHaveBeenCalledTimes(1);
  });

  it("close gagal pada run FAIL: hasil FAIL dan pesan galat asli tetap", async () => {
    const { d } = deps({ failOn: "signup", closeThrows: "close-rusak" });
    const r = await runRealE2E(d);
    expect(r.exitCode).toBe(1);
    expect(r.report.error).toContain("gagal-signup");
    expect(r.report.closeError).toContain("close-rusak");
  });

  it("run refused/NOT_ACTIVATED tidak menyentuh dependensi (termasuk close)", async () => {
    for (const env of [{ ...ENV, QA2_ACTIVATED: undefined }, { ...ENV, QA_MAX_EMAILS_PER_RUN: "2" }]) {
      const { f, d } = deps({}, env);
      const r = await runRealE2E(d);
      expect([2, 3]).toContain(r.exitCode);
      expect(f.driver.close).not.toHaveBeenCalled();
      expect(f.driver.signup).not.toHaveBeenCalled();
      expect(f.adminClient.findUserByEmail).not.toHaveBeenCalled();
    }
  });

  it("driver tanpa close (tiruan lama) tetap berjalan", async () => {
    const { f, d } = deps();
    delete (f.driver as any).close;
    const r = await runRealE2E(d);
    expect(r.exitCode).toBe(0);
  });
});

describe("closeDriverOnce: idempoten", () => {
  it("pemanggilan berulang hanya memanggil close() sekali dan mengembalikan hasil sama", async () => {
    const close = vi.fn(async () => {
      throw new Error("sekali");
    });
    const drv = { close };
    const a = await closeDriverOnce(drv, ENV, []);
    const b = await closeDriverOnce(drv, ENV, []);
    expect(close).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(a).toContain("sekali");
  });

  it("main + runRealE2E pada driver yang sama = satu close", async () => {
    const h = mainHarness();
    await h.run();
    expect(h.f.driver.close).toHaveBeenCalledTimes(1);
  });

  it("nilai non-driver diabaikan", async () => {
    expect(await closeDriverOnce(null, ENV, [])).toBeNull();
    expect(await closeDriverOnce({}, ENV, [])).toBeNull();
  });
});

describe("tanpa jaringan nyata dan workflow statis", () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

  it("real-e2e.mjs tidak memanggil fetch/process.exit langsung di runMain; exit hanya di entri", () => {
    const src = read("scripts/qa/real-e2e.mjs");
    const body = src.slice(src.indexOf("export async function runMain"), src.indexOf("function main(argv)"));
    expect(body).not.toMatch(/process\.exit|\bfetch\(/);
  });

  const wf = read(".github/workflows/qa-real-e2e.yml");
  const steps = wf
    .slice(wf.indexOf("\n    steps:\n"))
    .split(/\n      - /)
    .slice(1);
  const install = steps.find((s) => s.includes("name: Pasang Playwright"));

  it("langkah pasang Playwright ada, versi PERSIS, sebelum Guard dan E2E", () => {
    expect(install).toBeDefined();
    expect(install).toMatch(/npm install --no-save --no-package-lock playwright@\d+\.\d+\.\d+\s*$/m);
    expect(install).not.toMatch(/playwright@[\^~]|playwright@latest|playwright@next|playwright@\*/);
    expect(install).toContain("npx playwright install --with-deps chromium");
    const idx = (n: string) => steps.findIndex((s) => s.includes(n));
    expect(idx("name: Pasang Playwright")).toBeGreaterThan(idx("run: npm ci"));
    expect(idx("name: Pasang Playwright")).toBeLessThan(idx("name: Guard"));
    expect(idx("name: Guard")).toBeLessThan(idx("name: QA-2 real email E2E"));
  });

  it("langkah pasang Playwright tanpa secret/env; hanya Guard dan E2E yang punya secret", () => {
    expect(install).not.toMatch(/secrets\.|\benv:|QA_|vars\./);
    const withSecrets = steps.filter((s) => /secrets\./.test(s));
    expect(withSecrets).toHaveLength(2);
    expect(withSecrets[0]).toContain("name: Guard");
    expect(withSecrets[1]).toContain("name: QA-2 real email E2E");
  });

  it("workflow tetap workflow_dispatch saja dengan if main + QA2_ENABLED + frasa konfirmasi", () => {
    expect(wf).toMatch(/^on:\s*\n\s+workflow_dispatch:/m);
    expect(wf).not.toMatch(/^\s+(push|pull_request|pull_request_target|schedule|workflow_run|repository_dispatch):/m);
    expect(wf).toContain("github.ref == 'refs/heads/main'");
    expect(wf).toContain("vars.QA2_ENABLED == 'true'");
    expect(wf).toContain("inputs.confirm == 'RUN-QA-2-REAL-EMAIL'");
  });

  it("package.json dan package-lock.json tidak memuat playwright (dipasang hanya di workflow QA-2)", () => {
    expect(read("package.json")).not.toMatch(/playwright/i);
    expect(read("package-lock.json")).not.toMatch(/"node_modules\/playwright/);
  });
});
