import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  PLAN,
  assertFixedIdentity,
  extractConfirmationLinks,
  MAX_REDIRECTS,
  assertMaxEmailsPerRun,
  createEmailBudget,
  resolveRedirect,
  parseAuthenticationResults,
  runRealE2E as runRealE2EUntyped,
  validateConfirmationLink,
} from "../../../scripts/qa/real-e2e.mjs";

// Berkas .mjs bertipe lewat JSDoc yang sempit; tes memakai bentuk longgar agar dependensi palsu dan laporan mudah diperiksa.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Report = Record<string, any>;
const runRealE2E = runRealE2EUntyped as unknown as (deps: unknown) => Promise<{ exitCode: number; report: Report; json: string }>;

// Semua nilai PALSU. Tidak ada jaringan: seluruh dependensi adalah fungsi palsu di memori.
const FAKE_REF = "abcdefghij0123456789";
const SECRET_SRV = "FAKE-SECRET-VALUE-222";
const SECRET_PUB = "FAKE-PUBLISHABLE-VALUE-111";
const APP = "http://localhost:3000";
const SUPA = `https://${FAKE_REF}.supabase.co`;
const NOW = Date.parse("2026-11-14T00:00:00.000Z");
const DAY = 86_400_000;

const ENV: Record<string, string | undefined> = {
  QA2_CONFIRM: "RUN-QA-2-REAL-EMAIL",
  QA2_ACTIVATED: "true",
  QA_MAX_EMAILS_PER_RUN: "1",
  QA_SUPABASE_URL: SUPA,
  NEXT_PUBLIC_SUPABASE_URL: SUPA,
  QA_PROJECT_REF_EXPECTED: FAKE_REF,
  QA_SUPABASE_PUBLISHABLE_KEY: SECRET_PUB,
  QA_SUPABASE_SECRET_KEY: SECRET_SRV,
  QA_INBOX_ADDRESS: "qa-inbox@qa.tanyopo.com",
  QA_SENDER_EMAIL: "noreply@qa.tanyopo.com",
};

const GOOD_LINK = `${APP}/auth/confirm?token_hash=TOKENHASH123&type=signup&next=/onboarding`;
const AUTH_PASS = "mx.fake.invalid; spf=pass smtp.mailfrom=qa.tanyopo.com; dkim=pass header.d=qa.tanyopo.com; dmarc=pass header.from=qa.tanyopo.com";

type Overrides = {
  env?: Record<string, string | undefined>;
  html?: string;
  authResults?: string | null;
  trial?: { status: string; trial_ends_at: string } | null;
  hop?: (url: string, n: number) => { status: number; location?: string };
  duplicateOutcome?: string;
  extraMessage?: boolean;
  failOn?: string;
};

function build(o: Overrides = {}) {
  const calls: string[] = [];
  const log = (name: string) => calls.push(name);
  let userExists = true;
  const message = {
    subject: "Konfirmasi",
    html: o.html ?? `<a href="${GOOD_LINK.replaceAll("&", "&amp;")}">Konfirmasi</a>`,
    headers: o.authResults === null ? {} : { "Authentication-Results": o.authResults ?? AUTH_PASS },
  };
  let waits = 0;
  let hops = 0;
  const maybeFail = (name: string) => {
    if (o.failOn === name) throw new Error(`gagal-${name}`);
  };
  const deps = {
    env: o.env ?? ENV,
    appUrl: APP,
    guardOptions: { allowedRefs: [FAKE_REF] },
    password: "PW-FAKE-PASSWORD-999",
    probeTimeoutMs: 1,
    clock: { now: () => NOW },
    adminClient: {
      url: SUPA,
      findUserByEmail: vi.fn(async () => {
        log("admin.find");
        return userExists ? { id: "u1" } : null;
      }),
      deleteUser: vi.fn(async () => {
        log("admin.delete");
        userExists = false;
      }),
      getTrial: vi.fn(async () => {
        log("admin.getTrial");
        return o.trial === undefined ? { status: "TRIALING", plan: "FREE", trial_ends_at: new Date(NOW + 14 * DAY).toISOString() } : o.trial;
      }),
    },
    inbox: {
      clear: vi.fn(async () => {
        log("inbox.clear");
      }),
      waitForMessage: vi.fn(async () => {
        waits += 1;
        if (waits === 1) {
          log("inbox.wait");
          maybeFail("wait");
          return message;
        }
        log("inbox.probe");
        if (o.extraMessage) return { ...message, subject: "Email tak terduga" };
        throw new Error("timeout");
      }),
    },
    driver: {
      signup: vi.fn(async () => {
        log("driver.signup");
        maybeFail("signup");
        return { outcome: "check-email" };
      }),
      signupDuplicate: vi.fn(async () => {
        log("driver.signupDuplicate");
        return { outcome: o.duplicateOutcome ?? "duplicate" };
      }),
      fetchHop: vi.fn(async (url: string) => {
        log("driver.fetchHop");
        const n = hops++;
        if (o.hop) return o.hop(url, n);
        return n === 0 ? { status: 302, location: "/onboarding" } : { status: 200 };
      }),
      completeOnboarding: vi.fn(async () => {
        log("driver.onboarding");
        return { completed: true };
      }),
      openDashboard: vi.fn(async () => {
        log("driver.dashboard");
        return { status: 200, url: `${APP}/dashboard` };
      }),
      openBilling: vi.fn(async () => {
        log("driver.billing");
        return { status: 200 };
      }),
    },
  };
  return { deps, calls };
}

const firstIndex = (calls: string[], name: string) => calls.indexOf(name);

describe("runRealE2E: alur sukses dengan dependensi palsu", () => {
  it("menjalankan 11 langkah PLAN berurutan, laporan PASS, 1 email, cleanup di akhir", async () => {
    const { deps, calls } = build();
    const r = await runRealE2E(deps);
    expect(r.exitCode).toBe(0);
    expect(r.report.result).toBe("PASS");
    expect(r.report.steps.map((s: { n: number }) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(r.report.steps.every((s: { ok: boolean }) => s.ok)).toBe(true);
    expect(PLAN).toHaveLength(11);
    expect(r.report.emailsExpected).toBe(1);
    expect(calls.slice(0, 5)).toEqual(["admin.find", "admin.delete", "admin.find", "inbox.clear", "driver.signup"]);
    const order = ["inbox.clear", "driver.signup", "inbox.wait", "driver.fetchHop", "driver.onboarding", "driver.dashboard", "driver.billing", "admin.getTrial"];
    const idx = order.map((n) => firstIndex(calls, n));
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(calls[calls.length - 1]).toBe("admin.find");
    expect(deps.driver.signup).toHaveBeenCalledTimes(1); // satu-satunya signup yang boleh mengirim email
    expect(deps.driver.signupDuplicate).toHaveBeenCalledTimes(1);
    expect(deps.driver.fetchHop).toHaveBeenCalledTimes(2);
    expect(r.report.emailsRequested).toBe(1);
    expect(deps.inbox.waitForMessage).toHaveBeenCalledTimes(2); // 1 menunggu + 1 probe
  });

  it("laporan JSON tidak memuat secret, kata sandi, atau token tautan", async () => {
    const { deps } = build();
    const r = await runRealE2E(deps);
    expect(() => JSON.parse(r.json)).not.toThrow();
    for (const s of [SECRET_SRV, SECRET_PUB, "PW-FAKE-PASSWORD-999", "TOKENHASH123"]) expect(r.json).not.toContain(s);
  });

  it("secret yang bocor lewat pesan error dependensi disamarkan", async () => {
    const { deps } = build();
    deps.driver.signup.mockImplementationOnce(async () => {
      throw new Error(`boom ${SECRET_SRV}`);
    });
    const r = await runRealE2E(deps);
    expect(r.exitCode).toBe(1);
    expect(r.json).not.toContain(SECRET_SRV);
    expect(r.json).toContain("[REDACTED:QA_SUPABASE_SECRET_KEY]");
  });
});

describe("runRealE2E: inert secara default", () => {
  it("tanpa QA2_ACTIVATED=true: exit 3 dan tidak ada dependensi dipanggil", async () => {
    for (const activated of [undefined, "false", "1", ""]) {
      const { deps, calls } = build({ env: { ...ENV, QA2_ACTIVATED: activated } });
      const r = await runRealE2E(deps);
      expect(r.exitCode).toBe(3);
      expect(r.report.result).toBe("NOT_ACTIVATED");
      expect(calls).toEqual([]);
      expect(deps.adminClient.findUserByEmail).not.toHaveBeenCalled();
      expect(deps.inbox.clear).not.toHaveBeenCalled();
      expect(deps.driver.signup).not.toHaveBeenCalled();
    }
  });

  it("tidak ada pemanggilan jaringan (fetch) saat tidak aktif maupun saat berjalan dengan dependensi palsu", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("jaringan terlarang");
    });
    vi.stubGlobal("fetch", fetchSpy);
    try {
      await runRealE2E(build({ env: { ...ENV, QA2_ACTIVATED: undefined } }).deps);
      await runRealE2E(build().deps);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("guard gagal (env tidak lengkap): REFUSED exit 2 tanpa menyentuh dependensi", async () => {
    const { deps, calls } = build({ env: { ...ENV, QA_SUPABASE_SECRET_KEY: undefined } });
    const r = await runRealE2E(deps);
    expect(r.exitCode).toBe(2);
    expect(calls).toEqual([]);
  });

  it("ref di luar allowlist ditolak sebelum reset", async () => {
    const { deps, calls } = build();
    deps.guardOptions = { allowedRefs: ["zzzzzzzzzzzzzzzzzzzz"] };
    const r = await runRealE2E(deps);
    expect(r.exitCode).toBe(2);
    expect(calls).toEqual([]);
  });

  it("adminClient yang menunjuk URL lain (bukan proyek QA) ditolak sebelum reset", async () => {
    const { deps, calls } = build();
    deps.adminClient.url = "https://aaaaaaaaaaaaaaaaaaaa.supabase.co";
    const r = await runRealE2E(deps);
    expect(r.exitCode).toBe(2);
    expect(calls).toEqual([]);
  });
});

describe("identitas QA tetap", () => {
  it("plus-addressing ditolak sebelum dependensi apa pun dipanggil", async () => {
    const { deps, calls } = build({ env: { ...ENV, QA_INBOX_ADDRESS: "qa-inbox+run42@qa.tanyopo.com" } });
    const r = await runRealE2E(deps);
    expect(r.exitCode).toBe(2);
    expect(r.report.error).toContain("plus-address");
    expect(calls).toEqual([]);
  });

  it("inbox di domain asing (bukan qa.tanyopo.com) ditolak guard sebelum dependensi apa pun dipanggil", async () => {
    for (const addr of ["qa-inbox@fake-inbox.invalid", "qa-inbox@tanyopo.com", "qa-inbox@x.qa.tanyopo.com"]) {
      const { deps, calls } = build({ env: { ...ENV, QA_INBOX_ADDRESS: addr } });
      const r = await runRealE2E(deps);
      expect(r.exitCode).toBe(2);
      expect(r.report.error).toContain("QA_INBOX_ADDRESS");
      expect(calls).toEqual([]);
    }
  });

  it("assertFixedIdentity: hanya alamat polos, huruf kecil", () => {
    expect(assertFixedIdentity("QA-Inbox@QA.Tanyopo.com")).toBe("qa-inbox@qa.tanyopo.com");
    expect(() => assertFixedIdentity("a+b@x.invalid")).toThrow(/plus/);
    expect(() => assertFixedIdentity("")).toThrow();
    expect(() => assertFixedIdentity(undefined)).toThrow();
  });

  it("email yang dipakai di semua pemanggilan adalah QA_INBOX_ADDRESS", async () => {
    const { deps } = build();
    await runRealE2E(deps);
    for (const c of [...deps.driver.signup.mock.calls, ...deps.driver.signupDuplicate.mock.calls]) expect((c as unknown as [{ email: string }])[0].email).toBe("qa-inbox@qa.tanyopo.com");
    expect(deps.adminClient.findUserByEmail).toHaveBeenCalledWith("qa-inbox@qa.tanyopo.com");
  });
});

describe("validasi tautan konfirmasi", () => {
  const ORIGINS = [APP, SUPA];

  it("menerima tautan aplikasi uji dan tautan verify Supabase QA", () => {
    expect(() => validateConfirmationLink(GOOD_LINK, ORIGINS)).not.toThrow();
    expect(() => validateConfirmationLink(`${SUPA}/auth/v1/verify?token=t&type=signup&redirect_to=${encodeURIComponent(`${APP}/onboarding`)}`, ORIGINS)).not.toThrow();
  });

  it("menolak host asing, userinfo, dan redirect ke produksi", () => {
    expect(() => validateConfirmationLink("https://evil.example/auth/confirm?token_hash=x", ORIGINS)).toThrow(/ditolak/);
    expect(() => validateConfirmationLink("https://app.tanyopo.com/auth/confirm?token_hash=x", ORIGINS)).toThrow(/ditolak/);
    expect(() => validateConfirmationLink(`http://localhost:3000@evil.example/auth/confirm?token_hash=x`, ORIGINS)).toThrow(/ditolak/);
    expect(() => validateConfirmationLink(`${SUPA}/auth/v1/verify?token=t&redirect_to=https://app.tanyopo.com/onboarding`, ORIGINS)).toThrow(/redirect/);
    expect(() => validateConfirmationLink(`${APP}/auth/confirm?token_hash=x&type=signup&next=//evil.example`, ORIGINS)).toThrow(/redirect/);
  });

  it("extractConfirmationLinks membaca &amp; dan hanya path konfirmasi", () => {
    const html = `<a href="https://x.invalid/unsub">x</a><a href="${APP}/auth/confirm?token_hash=a&amp;type=signup">ok</a>`;
    expect(extractConfirmationLinks(html)).toEqual([`${APP}/auth/confirm?token_hash=a&type=signup`]);
    expect(extractConfirmationLinks("tanpa tautan")).toEqual([]);
  });

  it("run: tautan host asing ditolak, TIDAK diikuti, cleanup tetap jalan", async () => {
    const { deps, calls } = build({ html: `<a href="https://evil.example/auth/confirm?token_hash=x&type=signup">k</a>` });
    const r = await runRealE2E(deps);
    expect(r.exitCode).toBe(1);
    expect(deps.driver.fetchHop).not.toHaveBeenCalled();
    expect(r.report.steps.find((s: { n: number }) => s.n === 6).ok).toBe(false);
    expect(calls[calls.length - 1]).toBe("admin.find");
    expect(r.report.steps[r.report.steps.length - 1].n).toBe(11);
  });

  it("run: satu tautan asing di antara tautan valid tetap menggagalkan run", async () => {
    const html = `<a href="${GOOD_LINK}">a</a><a href="https://evil.example/auth/confirm?token_hash=x">b</a>`;
    const r = await runRealE2E(build({ html }).deps);
    expect(r.exitCode).toBe(1);
  });

  it("run: redirect yang berakhir di produksi ditolak", async () => {
    const { deps } = build({ hop: () => ({ status: 302, location: "https://app.tanyopo.com/onboarding" }) });
    const r = await runRealE2E(deps);
    expect(r.exitCode).toBe(1);
    expect(r.report.error).toContain("redirect ditolak");
    expect(deps.driver.fetchHop).toHaveBeenCalledTimes(1); // berhenti SEBELUM request kedua
    expect(deps.driver.openDashboard).not.toHaveBeenCalled();
  });

  it("run: redirect relatif ke /onboarding diterima (2 hop)", async () => {
    const { deps } = build();
    const r = await runRealE2E(deps);
    expect(r.exitCode).toBe(0);
    expect(r.report.redirectHops).toBe(1);
  });

  it("run: redirect lintas asal yang diizinkan (Supabase QA -> app) diterima", async () => {
    const { deps } = build({ hop: (_u, n) => (n === 0 ? { status: 303, location: `${APP}/onboarding?x=1` } : { status: 200 }) });
    expect((await runRealE2E(deps)).exitCode).toBe(0);
  });

  for (const [label, location] of [
    ["host asing", "https://evil.example/x"],
    ["host hosting produksi", "https://linoe.netlify.app/x"],
    ["userinfo", "http://localhost:3000@evil.example/x"],
    ["userinfo di host yang diizinkan", "http://user:pw@localhost:3000/onboarding"],
    ["skema javascript:", "javascript:alert(1)"],
    ["skema data:", "data:text/html,hi"],
    ["protokol-relatif ke host asing", "//evil.example/x"],
  ] as const) {
    it(`run: redirect ${label} dihentikan sebelum request kedua`, async () => {
      const { deps, calls } = build({ hop: () => ({ status: 302, location }) });
      const r = await runRealE2E(deps);
      expect(r.exitCode).toBe(1);
      expect(deps.driver.fetchHop).toHaveBeenCalledTimes(1);
      expect(r.report.error).toContain("redirect ditolak");
      expect(calls[calls.length - 1]).toBe("admin.find"); // cleanup tetap
    });
  }

  it("run: batas MAX_REDIRECTS terlampaui -> gagal", async () => {
    const { deps } = build({ hop: (_u, n) => ({ status: 302, location: `/step-${n}` }) });
    const r = await runRealE2E(deps);
    expect(r.exitCode).toBe(1);
    expect(r.report.error).toContain("melebihi batas");
    expect(deps.driver.fetchHop).toHaveBeenCalledTimes(MAX_REDIRECTS + 1);
  });

  it("run: loop redirect ditolak", async () => {
    const { deps } = build({ hop: (_u, n) => ({ status: 302, location: n % 2 === 0 ? "/a" : "/b" }) });
    const r = await runRealE2E(deps);
    expect(r.exitCode).toBe(1);
    expect(r.report.error).toContain("loop");
    expect(deps.driver.fetchHop).toHaveBeenCalledTimes(3);
  });

  it("run: 3xx tanpa Location atau status 4xx -> gagal", async () => {
    expect((await runRealE2E(build({ hop: () => ({ status: 302 }) }).deps)).exitCode).toBe(1);
    expect((await runRealE2E(build({ hop: () => ({ status: 403 }) }).deps)).exitCode).toBe(1);
  });
});

describe("resolveRedirect dan QA_MAX_EMAILS_PER_RUN", () => {
  it("resolveRedirect: relatif diselesaikan terhadap URL saat ini", () => {
    expect(resolveRedirect("/onboarding", `${APP}/auth/confirm?a=1`, [APP])).toBe(`${APP}/onboarding`);
    expect(() => resolveRedirect("https://evil.example", APP, [APP])).toThrow(/ditolak/);
  });

  it("assertMaxEmailsPerRun hanya menerima persis \"1\"", () => {
    expect(assertMaxEmailsPerRun({ QA_MAX_EMAILS_PER_RUN: "1" })).toBe(1);
    for (const v of [undefined, "", "0", "2", " 1", "1 ", "01", "true"]) expect(() => assertMaxEmailsPerRun({ QA_MAX_EMAILS_PER_RUN: v })).toThrow(/QA_MAX_EMAILS_PER_RUN/);
  });

  it("run: variabel hilang/kosong/bukan 1 -> REFUSED sebelum langkah apa pun (termasuk saat tidak aktif)", async () => {
    for (const v of [undefined, "", "2", "0"]) {
      for (const activated of ["true", undefined]) {
        const { deps, calls } = build({ env: { ...ENV, QA_MAX_EMAILS_PER_RUN: v, QA2_ACTIVATED: activated } });
        const r = await runRealE2E(deps);
        expect(r.exitCode).toBe(2);
        expect(r.report.error).toContain("QA_MAX_EMAILS_PER_RUN");
        expect(calls).toEqual([]);
      }
    }
  });

  it("anggaran email: pemanggilan signup kedua gagal dan tidak diteruskan ke driver", async () => {
    const budget = createEmailBudget(1);
    const send = vi.fn(async () => "sent");
    await budget.spend(send);
    await expect(budget.spend(send)).rejects.toThrow(/batas email/);
    expect(send).toHaveBeenCalledTimes(1);
    expect(budget.used).toBe(1);
  });
});


describe("parseAuthenticationResults", () => {
  it("membaca SPF/DKIM/DMARC pass", () => {
    expect(parseAuthenticationResults(AUTH_PASS)).toEqual({ spf: "pass", dkim: "pass", dmarc: "pass" });
  });
  it("fail, softfail, dan tidak ada ditandai apa adanya", () => {
    expect(parseAuthenticationResults("x; spf=fail; dkim=pass; dmarc=pass").spf).toBe("fail");
    expect(parseAuthenticationResults("x; spf=softfail; dkim=none").spf).toBe("softfail");
    expect(parseAuthenticationResults("x; spf=pass").dkim).toBe("none");
    expect(parseAuthenticationResults(undefined)).toEqual({ spf: "none", dkim: "none", dmarc: "none" });
  });
  it("komentar dalam kurung tidak dianggap hasil; satu dkim fail menggagalkan walau ada pass", () => {
    expect(parseAuthenticationResults("x; spf=fail (spf=pass di komentar); dkim=pass; dmarc=pass").spf).toBe("fail");
    expect(parseAuthenticationResults("x; spf=pass; dkim=pass header.d=a; dkim=fail header.d=b; dmarc=pass").dkim).toBe("fail");
  });
  it("tidak peka huruf besar", () => {
    expect(parseAuthenticationResults("X; SPF=PASS; DKIM=Pass; DMARC=pass")).toEqual({ spf: "pass", dkim: "pass", dmarc: "pass" });
  });

  for (const [label, header] of [
    ["SPF fail", "x; spf=fail; dkim=pass; dmarc=pass"],
    ["DKIM fail", "x; spf=pass; dkim=fail; dmarc=pass"],
    ["DMARC fail", "x; spf=pass; dkim=pass; dmarc=fail"],
    ["DKIM tidak ada", "x; spf=pass; dmarc=pass"],
  ] as const) {
    it(`run gagal bila ${label}; tautan tidak diikuti; cleanup jalan`, async () => {
      const { deps, calls } = build({ authResults: header });
      const r = await runRealE2E(deps);
      expect(r.exitCode).toBe(1);
      expect(r.report.steps.find((s: { n: number }) => s.n === 5).ok).toBe(false);
      expect(deps.driver.fetchHop).not.toHaveBeenCalled();
      expect(calls[calls.length - 1]).toBe("admin.find");
    });
  }

  it("run gagal bila header Authentication-Results tidak ada", async () => {
    const { deps } = build({ authResults: null });
    const r = await runRealE2E(deps);
    expect(r.exitCode).toBe(1);
    expect(r.report.error).toContain("Authentication-Results");
  });
});

describe("trial dan duplikat", () => {
  it("trial_ends_at jauh dari now+14 hari -> gagal", async () => {
    const { deps } = build({ trial: { status: "TRIALING", trial_ends_at: new Date(NOW + 30 * DAY).toISOString() } });
    const r = await runRealE2E(deps);
    expect(r.exitCode).toBe(1);
    expect(r.report.error).toContain("trial bukan 14 hari");
    expect(deps.driver.signupDuplicate).not.toHaveBeenCalled(); // langkah 10 tidak jalan
  });

  it("status trial bukan TRIALING atau langganan tidak ada -> gagal", async () => {
    expect((await runRealE2E(build({ trial: { status: "ACTIVE", trial_ends_at: new Date(NOW + 14 * DAY).toISOString() } }).deps)).exitCode).toBe(1);
    expect((await runRealE2E(build({ trial: null }).deps)).exitCode).toBe(1);
  });

  it("toleransi: selisih beberapa jam masih lolos", async () => {
    const { deps } = build({ trial: { status: "TRIALING", trial_ends_at: new Date(NOW + 14 * DAY + 3_600_000).toISOString() } });
    expect((await runRealE2E(deps)).exitCode).toBe(0);
  });

  it("pendaftaran duplikat yang tidak ditolak -> gagal", async () => {
    const { deps } = build({ duplicateOutcome: "check-email" });
    const r = await runRealE2E(deps);
    expect(r.exitCode).toBe(1);
    expect(r.report.error).toContain("duplikat");
  });
});

describe("batas biaya dan cleanup", () => {
  it("pesan tak terduga di inbox setelah duplikat -> ABORT", async () => {
    const { deps } = build({ extraMessage: true });
    const r = await runRealE2E(deps);
    expect(r.exitCode).toBe(1);
    expect(r.report.error).toContain("ABORT");
    expect(r.report.unexpectedInboxMessage).toBe(true);
  });

  it("signup tidak pernah diulang (tanpa retry) bila gagal", async () => {
    const { deps } = build({ failOn: "signup" });
    const r = await runRealE2E(deps);
    expect(r.exitCode).toBe(1);
    expect(deps.driver.signup).toHaveBeenCalledTimes(1);
    expect(deps.inbox.waitForMessage).not.toHaveBeenCalled();
  });

  it("cleanup selalu jalan saat langkah gagal (inbox timeout)", async () => {
    const { deps, calls } = build({ failOn: "wait" });
    const r = await runRealE2E(deps);
    expect(r.exitCode).toBe(1);
    expect(calls[calls.length - 1]).toBe("admin.find");
    expect(deps.adminClient.deleteUser).toHaveBeenCalled(); // reset awal + cleanup
    expect(r.report.steps[r.report.steps.length - 1]).toMatchObject({ n: 11, ok: true });
    expect(r.report.notRun).toEqual([5, 6, 7, 8, 9, 10]);
  });

  it("kegagalan cleanup membuat run gagal walau langkah lain lolos", async () => {
    const { deps } = build();
    let n = 0;
    deps.adminClient.findUserByEmail.mockImplementation(async () => {
      n += 1;
      if (n === 2) return null; // verifikasi reset (pencarian ke-1 menemukan, ke-2 sudah kosong)
      if (n >= 3) throw new Error("admin down"); // cleanup
      return { id: "u1" };
    });
    const r = await runRealE2E(deps);
    expect(r.exitCode).toBe(1);
    expect(r.report.steps[r.report.steps.length - 1]).toMatchObject({ n: 11, ok: false });
  });

  it("reset idempoten: pengguna sudah tidak ada -> tidak ada penghapusan di langkah 1", async () => {
    const { deps } = build();
    deps.adminClient.findUserByEmail.mockResolvedValue(null);
    const r = await runRealE2E(deps);
    expect(r.report.steps[0].detail).toContain("tidak ada");
    expect(deps.adminClient.deleteUser).not.toHaveBeenCalled();
  });
});

describe("workflow statis: QA_MAX_EMAILS_PER_RUN", () => {
  const wf = readFileSync(path.join(process.cwd(), ".github/workflows/qa-real-e2e.yml"), "utf8");
  const steps = wf.slice(wf.indexOf("\n    steps:\n")).split(/\n      - /).filter((x) => /^name: (Guard|QA-2 real email E2E)/.test(x));

  it('literal "1" pada langkah Guard dan E2E, bukan secret dan bukan var', () => {
    expect(steps).toHaveLength(2);
    for (const s of steps) expect(s).toMatch(/^\s+QA_MAX_EMAILS_PER_RUN: "1"$/m);
    expect([...wf.matchAll(/QA_MAX_EMAILS_PER_RUN:\s*(.*)$/gm)].map((m) => m[1].trim())).toEqual(['"1"', '"1"']);
    expect(wf).not.toMatch(/(secrets|vars)\.QA_MAX_EMAILS_PER_RUN/);
  });
});
