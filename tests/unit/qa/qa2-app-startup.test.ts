// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as mod from "../../../scripts/qa/start-app-and-wait.mjs";
import { findRealQaViolations } from "../../../scripts/qa/real-e2e-guard.mjs";
import { ALLOWED_QA_PROJECT_REFS } from "../../../scripts/qa/qa-project-allowlist.mjs";

// Semua nilai PALSU dan tanpa jaringan/proses nyata: spawn, fetch, berkas, port, waktu, dan kill adalah fungsi palsu di memori.
// Tipe sengaja longgar (pelajaran #153: .mjs bertipe JSDoc sempit).
const m = mod as any;
const QA_REF = ALLOWED_QA_PROJECT_REFS[0] as string;
const QA_URL = `https://${QA_REF}.supabase.co`;
const PUB = "FAKE-PUBLISHABLE-VALUE-111";
const SRV = "FAKE-SECRET-VALUE-222";

const ENV: Record<string, string | undefined> = {
  QA2_CONFIRM: "RUN-QA-2-REAL-EMAIL",
  QA2_ACTIVATED: "true",
  QA_MAX_EMAILS_PER_RUN: "1",
  QA_SUPABASE_URL: QA_URL,
  NEXT_PUBLIC_SUPABASE_URL: QA_URL,
  QA_PROJECT_REF_EXPECTED: QA_REF,
  QA_SUPABASE_PUBLISHABLE_KEY: PUB,
  QA_SUPABASE_SECRET_KEY: SRV,
  QA_RESEND_SMTP_PASSWORD: "FAKE-SMTP-444",
  QA_INBOX_READ_TOKEN: "FAKE-INBOX-TOKEN-333",
  QA_INBOX_ADDRESS: "qa-linoe@qa.tanyopo.com",
  QA_SENDER_EMAIL: "noreply@qa.tanyopo.com",
  PATH: "/usr/bin",
  HOME: "/home/runner",
  GITHUB_RUN_ID: "123",
};

function refusal(env: Record<string, string | undefined>) {
  try {
    m.validateStartEnv(env);
  } catch (e) {
    return String((e as Error).message);
  }
  return null;
}

describe("validasi env fail-closed", () => {
  it("env QA yang benar diterima dan mengembalikan ref allowlist", () => {
    const v = m.validateStartEnv(ENV);
    expect(v).toEqual({ qaUrl: QA_URL, ref: QA_REF, publishableKey: PUB });
  });

  it("menolak URL proyek lain (ref bukan allowlist, ref produksi/bersama, .supabase.com)", () => {
    for (const url of [
      "https://abcdefghij0123456789.supabase.co",
      "https://wjjyqovhmwenbcvbnkgx.supabase.co",
      `https://${QA_REF}.supabase.com`,
      `https://${QA_REF}.supabase.co/`,
      `${QA_URL}/rest/v1`,
      "http://localhost:54321",
    ]) {
      expect(refusal({ ...ENV, QA_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_URL: url, QA_PROJECT_REF_EXPECTED: QA_REF }), url).not.toBeNull();
    }
    expect(refusal({ ...ENV, QA_INBOX_ADDRESS: "qa@pooler.supabase.com" })).not.toBeNull();
  });

  it("menolak NEXT_PUBLIC_SUPABASE_URL yang tidak persis sama dengan QA_SUPABASE_URL", () => {
    expect(refusal({ ...ENV, NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghij0123456789.supabase.co" })).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(refusal({ ...ENV, NEXT_PUBLIC_SUPABASE_URL: undefined })).not.toBeNull();
  });

  it.each([
    "DATABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SECRET_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "RESEND_API_KEY",
    "RESEND_ALERT_API_KEY",
    "PAYMENT_LIVE_ENABLED",
    "PAYMENT_PROVIDER_API_KEY",
    "ADMIN_CENTER_ENABLED",
    "EMAIL_OTP_ENABLED",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "AI_DEFAULT_PROVIDER",
    "META_APP_SECRET",
    "TIKTOK_APP_SECRET",
    "X_CLIENT_SECRET",
    "TOKEN_ENCRYPTION_KEY",
    "JOBS_PROCESSOR_SECRET",
    "DEMO_SESSION_SECRET",
    "UMKMPRO_SERVICE_TOKEN",
    "PAYMENT_SWEEPER_SECRET",
    "NETLIFY_AUTH_TOKEN",
    "VERCEL_TOKEN",
  ])("menolak variabel produksi/fitur berbayar terisi: %s (hanya nama di pesan)", (name) => {
    const r = refusal({ ...ENV, [name]: "FAKE-VALUE-999" });
    expect(r).not.toBeNull();
    expect(r).toContain(name);
    expect(r).not.toContain("FAKE-VALUE-999");
  });

  it("variabel kosong tidak dihitung terisi", () => {
    expect(refusal({ ...ENV, PAYMENT_LIVE_ENABLED: "", ADMIN_CENTER_ENABLED: "" })).toBeNull();
  });

  it("selaras dengan guard real-e2e: nama yang ditolak guard juga ditolak di sini", () => {
    for (const name of ["PGHOST", "SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD", "SUPABASE_SERVICE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "DOKU_SECRET", "MIDTRANS_KEY", "RESEND_X"]) {
      const env = { ...ENV, [name]: "x" };
      expect(findRealQaViolations(env).length, name).toBeGreaterThan(0);
      expect(refusal(env), name).not.toBeNull();
    }
  });

  it("menolak publishable key kosong dan lingkungan hosting/produksi", () => {
    expect(refusal({ ...ENV, QA_SUPABASE_PUBLISHABLE_KEY: "" })).not.toBeNull();
    expect(refusal({ ...ENV, NODE_ENV: "production" })).not.toBeNull();
  });
});

describe("env proses anak dibangun dari nol", () => {
  const child = m.buildChildEnv(ENV, { qaUrl: QA_URL, publishableKey: PUB });

  it("hanya NEXT_PUBLIC_* QA, URL aplikasi lokal, host/port, dan PATH dasar", () => {
    expect(child).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/runner",
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_PUBLIC_SUPABASE_URL: QA_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUB,
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      PORT: "3000",
      HOSTNAME: "127.0.0.1",
    });
  });

  it("tanpa kunci server, secret QA lain, atau variabel runner", () => {
    const json = JSON.stringify(child);
    for (const secret of [SRV, "FAKE-SMTP-444", "FAKE-INBOX-TOKEN-333", "qa-linoe@qa.tanyopo.com"]) expect(json).not.toContain(secret);
    expect(Object.keys(child).some((k) => k.startsWith("QA_") || k.startsWith("GITHUB_") || k === "SUPABASE_SECRET_KEY")).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------------------------
// Dependensi palsu
// ------------------------------------------------------------------------------------------------------------------
type FetchPlan = (url: string, call: number) => { status: number; body?: any } | Error;

function makeDeps(o: { files?: Record<string, string>; fetchPlan?: FetchPlan; portBusy?: boolean; childExitsAt?: number; pid?: number; buildCode?: number | null } = {}) {
  const files: Record<string, string> = { ...(o.files ?? {}) };
  let clock = 0;
  let calls = 0;
  const killed: Array<[number, string | number]> = [];
  const spawned: Array<{ cmd: string; args: string[]; opts: any }> = [];
  const listeners: Record<string, Array<() => void>> = {};
  let alive = true;
  const childObj: any = {
    pid: "pid" in o ? o.pid : 4242,
    once: (ev: string, cb: () => void) => void (listeners[ev] = [...(listeners[ev] ?? []), cb]),
    unref: vi.fn(),
    kill: vi.fn(),
  };
  const deps = {
    spawn: vi.fn((cmd: string, args: string[], opts: any) => {
      spawned.push({ cmd, args, opts });
      return childObj;
    }),
    fetch: vi.fn(async (url: string) => {
      calls += 1;
      const r = (o.fetchPlan ?? (() => ({ status: 200, body: { status: "ok" } })))(url, calls);
      if (r instanceof Error) throw r;
      return { status: r.status, json: async () => r.body };
    }),
    sleep: vi.fn(async (ms: number) => {
      clock += ms;
      if (o.childExitsAt !== undefined && clock >= o.childExitsAt && alive) {
        alive = false;
        for (const cb of listeners.exit ?? []) cb();
      }
    }),
    now: () => clock,
    portInUse: vi.fn(async () => o.portBusy === true),
    kill: vi.fn((pid: number, sig: string | number) => {
      killed.push([pid, sig]);
      if (sig === 0) throw new Error("ESRCH");
    }),
    fs: {
      existsSync: (p: string) => p in files,
      mkdirSync: vi.fn(),
      readFileSync: (p: string) => {
        if (!(p in files)) throw new Error("ENOENT");
        return files[p];
      },
      writeFileSync: (p: string, c: string) => void (files[p] = c),
      rmSync: (p: string) => void delete files[p],
      openLog: vi.fn(() => 7),
      closeLog: vi.fn(),
    },
    waitForExit: vi.fn(async () => (o.buildCode === undefined ? 0 : o.buildCode)),
  };
  return { deps, files, killed, spawned, childObj, listeners };
}

const MARKER = { [m.BUILD_MARKER]: JSON.stringify({ ref: QA_REF, appUrl: "http://localhost:3000" }) };

describe("readiness fail-closed", () => {
  it("sukses setelah beberapa percobaan dengan backoff naik dan berbatas", async () => {
    const sleeps: number[] = [];
    let n = 0;
    await m.waitForReady({
      fetch: async () => ({ status: ++n < 6 ? 503 : 200, json: async () => ({ status: "ok" }) }),
      sleep: async (ms: number) => void sleeps.push(ms),
      now: () => 0,
      isAlive: () => true,
    });
    expect(sleeps.slice(0, 5)).toEqual([500, 750, 1125, 1688, 2532]);
    expect(Math.max(...sleeps)).toBeLessThanOrEqual(3000);
  });

  it("memeriksa /api/health lalu /login, keduanya wajib 200", async () => {
    const urls: string[] = [];
    await m.waitForReady({
      fetch: async (u: string) => (urls.push(u), { status: 200, json: async () => ({ status: "ok" }) }),
      sleep: async () => {},
      now: () => 0,
      isAlive: () => true,
    });
    expect(urls).toEqual(["http://127.0.0.1:3000/api/health", "http://127.0.0.1:3000/login"]);
  });

  it("batas waktu -> melempar (tidak pernah sukses diam-diam)", async () => {
    let t = 0;
    await expect(
      m.waitForReady({
        fetch: async () => ({ status: 503, json: async () => ({}) }),
        sleep: async (ms: number) => void (t += ms),
        now: () => t,
        isAlive: () => true,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(/habis waktu/);
  });

  it("galat jaringan, body health bukan ok, atau redirect -> tidak dianggap siap", async () => {
    for (const plan of [
      () => {
        throw new Error("ECONNREFUSED");
      },
      () => ({ status: 200, json: async () => ({ status: "degraded" }) }),
      () => ({ status: 307, json: async () => ({}) }),
    ]) {
      let t = 0;
      await expect(
        m.waitForReady({ fetch: async () => (plan as any)(), sleep: async (ms: number) => void (t += ms), now: () => t, isAlive: () => true, timeoutMs: 3000 }),
      ).rejects.toThrow(/habis waktu/);
    }
  });

  it("proses anak mati -> gagal segera", async () => {
    await expect(m.waitForReady({ fetch: async () => ({ status: 200, json: async () => ({ status: "ok" }) }), sleep: async () => {}, now: () => 0, isAlive: () => false })).rejects.toThrow(/berhenti/);
  });
});

describe("startAppAndWait: sukses, kegagalan, dan pembersihan", () => {
  it("sukses: spawn di 127.0.0.1:3000 dalam grup terpisah, pid tertulis, server dibiarkan hidup", async () => {
    const t = makeDeps({ files: { ...MARKER } });
    const r = await m.startAppAndWait(ENV, t.deps);
    expect(r).toEqual({ pid: 4242 });
    expect(t.spawned).toHaveLength(1);
    expect(t.spawned[0].cmd).toBe("npm");
    expect(t.spawned[0].args).toEqual(["run", "start", "--", "-H", "127.0.0.1", "-p", "3000"]);
    expect(t.spawned[0].opts.detached).toBe(true);
    expect(t.files[m.PID_FILE]).toBe("4242");
    expect(t.killed).toEqual([]);
    expect(t.childObj.unref).toHaveBeenCalled();
    expect(t.deps.fs.closeLog).toHaveBeenCalledWith(7);
  });

  it("env anak yang diteruskan ke spawn tidak memuat secret QA maupun variabel runner", async () => {
    const t = makeDeps({ files: { ...MARKER } });
    await m.startAppAndWait(ENV, t.deps);
    const json = JSON.stringify(t.spawned[0].opts.env);
    for (const secret of [SRV, "FAKE-SMTP-444", "FAKE-INBOX-TOKEN-333", "GITHUB_RUN_ID"]) expect(json).not.toContain(secret);
    expect(t.spawned[0].opts.env.NEXT_PUBLIC_SUPABASE_URL).toBe(QA_URL);
  });

  it("readiness habis waktu -> grup proses dimatikan (SIGTERM lalu cek/SIGKILL), pid dihapus, melempar", async () => {
    const t = makeDeps({ files: { ...MARKER }, fetchPlan: () => ({ status: 503 }) });
    await expect(m.startAppAndWait(ENV, t.deps, { readyTimeoutMs: 4000 })).rejects.toThrow(/habis waktu/);
    expect(t.killed[0]).toEqual([-4242, "SIGTERM"]);
    expect(t.killed.map((k) => k[0])).toEqual([-4242, -4242]);
    expect(m.PID_FILE in t.files).toBe(false);
    expect(t.deps.fs.closeLog).toHaveBeenCalledWith(7);
  });

  it("proses anak mati sebelum siap -> melempar dan tetap membersihkan", async () => {
    const t = makeDeps({ files: { ...MARKER }, fetchPlan: () => new Error("ECONNREFUSED"), childExitsAt: 500 });
    await expect(m.startAppAndWait(ENV, t.deps)).rejects.toThrow(/berhenti/);
    expect(t.killed.some((k) => k[0] === -4242)).toBe(true);
    expect(m.PID_FILE in t.files).toBe(false);
  });

  it("spawn tanpa pid valid (atau pid 1) -> ditolak dan tidak ada kill ke pid berbahaya", async () => {
    for (const pid of [null as any, 1, 0, -5]) {
      const t = makeDeps({ files: { ...MARKER }, pid });
      await expect(m.startAppAndWait(ENV, t.deps)).rejects.toThrow(/tidak terbentuk/);
      expect(t.killed).toEqual([]);
      expect(m.PID_FILE in t.files).toBe(false);
    }
  });

  it("port sudah dipakai -> ditolak tanpa spawn", async () => {
    const t = makeDeps({ files: { ...MARKER }, portBusy: true });
    await expect(m.startAppAndWait(ENV, t.deps)).rejects.toThrow(/port 3000/);
    expect(t.deps.spawn).not.toHaveBeenCalled();
  });

  it("penanda build tidak ada atau untuk ref lain -> ditolak tanpa spawn", async () => {
    const none = makeDeps();
    await expect(m.startAppAndWait(ENV, none.deps)).rejects.toThrow(/penanda build/);
    const other = makeDeps({ files: { [m.BUILD_MARKER]: JSON.stringify({ ref: "abcdefghij0123456789" }) } });
    await expect(m.startAppAndWait(ENV, other.deps)).rejects.toThrow(/ref penanda berbeda/);
    expect(none.deps.spawn).not.toHaveBeenCalled();
    expect(other.deps.spawn).not.toHaveBeenCalled();
  });

  it("env produksi atau berkas .env di repo -> ditolak sebelum spawn dan fetch", async () => {
    const bad = makeDeps({ files: { ...MARKER } });
    await expect(m.startAppAndWait({ ...ENV, DATABASE_URL: "postgres://x" }, bad.deps)).rejects.toThrow(/REFUSED/);
    const envfile = makeDeps({ files: { ...MARKER, ".env.production": "X=1" } });
    await expect(m.startAppAndWait(ENV, envfile.deps)).rejects.toThrow(/\.env\.production/);
    for (const t of [bad, envfile]) {
      expect(t.deps.spawn).not.toHaveBeenCalled();
      expect(t.deps.fetch).not.toHaveBeenCalled();
    }
  });
});

describe("buildApp", () => {
  it("menjalankan npm run build dengan env anak minimal lalu menulis penanda ref QA", async () => {
    const t = makeDeps();
    await m.buildApp(ENV, t.deps);
    expect(t.spawned[0].cmd).toBe("npm");
    expect(t.spawned[0].args).toEqual(["run", "build"]);
    expect(t.spawned[0].opts.env.NEXT_PUBLIC_SUPABASE_URL).toBe(QA_URL);
    expect(JSON.stringify(t.spawned[0].opts.env)).not.toContain(SRV);
    expect(JSON.parse(t.files[m.BUILD_MARKER])).toEqual({ ref: QA_REF, appUrl: "http://localhost:3000" });
  });

  it("build gagal atau habis waktu -> melempar dan tidak menulis penanda", async () => {
    for (const buildCode of [1, null]) {
      const t = makeDeps({ buildCode });
      await expect(m.buildApp(ENV, t.deps)).rejects.toThrow(/build/);
      expect(m.BUILD_MARKER in t.files).toBe(false);
    }
  });

  it("env tidak valid -> ditolak sebelum build", async () => {
    const t = makeDeps();
    await expect(m.buildApp({ ...ENV, PAYMENT_LIVE_ENABLED: "true" }, t.deps)).rejects.toThrow(/PAYMENT_LIVE_ENABLED/);
    expect(t.deps.spawn).not.toHaveBeenCalled();
  });
});

describe("stopApp dan killGroup", () => {
  it("mematikan grup proses dari berkas pid lalu menghapusnya", async () => {
    const t = makeDeps({ files: { [m.PID_FILE]: "4242\n" } });
    expect(await m.stopApp(t.deps)).toBe(true);
    expect(t.killed[0]).toEqual([-4242, "SIGTERM"]);
    expect(m.PID_FILE in t.files).toBe(false);
  });

  it("aman diulang: tanpa berkas pid -> tidak ada kill", async () => {
    const t = makeDeps();
    expect(await m.stopApp(t.deps)).toBe(false);
    expect(t.killed).toEqual([]);
  });

  it.each(["1", "0", "-1", "abc", "", "4242abc", "1.5"])("isi pid tidak valid %j -> tidak ada kill", async (content) => {
    const t = makeDeps({ files: { [m.PID_FILE]: content } });
    await m.stopApp(t.deps);
    expect(t.killed).toEqual([]);
  });
});

describe("runMain: kode keluar dan penyamaran", () => {
  const run = async (argv: string[], t: ReturnType<typeof makeDeps>, env = ENV) => {
    const out: string[] = [];
    let code = -1;
    await m.runMain({ argv, env, deps: t.deps, exit: (c: number) => (code = c), io: { log: (s: string) => out.push(s), error: (s: string) => out.push(s) } });
    return { code, out: out.join("\n") };
  };

  it("start sukses = 0; env ditolak = 2; readiness gagal = 1 dengan tail log tersamar", async () => {
    expect((await run(["start"], makeDeps({ files: { ...MARKER } }))).code).toBe(0);
    expect((await run(["start"], makeDeps({ files: { ...MARKER } }), { ...ENV, DATABASE_URL: "x" })).code).toBe(2);
    const t = makeDeps({ files: { ...MARKER, [m.LOG_FILE]: `boom ${SRV} selesai` }, fetchPlan: () => ({ status: 503 }) });
    t.deps.sleep = vi.fn(async () => {
      throw new Error(`gagal ${SRV}`);
    });
    const r = await run(["start"], t);
    expect(r.code).toBe(1);
    expect(r.out).not.toContain(SRV);
    expect(r.out).toContain("[REDACTED:QA_SUPABASE_SECRET_KEY]");
  });

  it("perintah tak dikenal = 2; stop selalu 0", async () => {
    expect((await run(["nonsense"], makeDeps())).code).toBe(2);
    expect((await run([], makeDeps())).code).toBe(2);
    expect((await run(["stop"], makeDeps())).code).toBe(0);
  });

  it("build gagal = 1; stop tidak butuh env QA", async () => {
    expect((await run(["build"], makeDeps({ buildCode: 2 }))).code).toBe(1);
    expect((await run(["stop"], makeDeps({ files: { [m.PID_FILE]: "99" } }), {})).code).toBe(0);
  });
});

describe("statis: skrip tanpa jaringan nyata dan tanpa efek di impor", () => {
  const src = readFileSync(path.join(process.cwd(), "scripts/qa/start-app-and-wait.mjs"), "utf8");
  it("memakai ALLOWED_QA_PROJECT_REFS lewat guard, tanpa URL luar, tanpa dependensi npm", () => {
    expect(src).toContain('from "./real-e2e-guard.mjs"');
    expect(src).not.toMatch(/https?:\/\/(?!127\.0\.0\.1|localhost)[a-z]/i);
    for (const line of src.match(/^import .* from "([^"]+)"/gm) ?? []) expect(line).toMatch(/from "(node:[a-z_]+|\.\/[\w.-]+)"/);
  });
  it("main hanya berjalan bila dipanggil langsung (impor tidak menjalankan apa pun)", () => {
    expect(src).toContain("process.argv[1] === fileURLToPath(import.meta.url)");
    expect(src.indexOf("process.exit(")).toBeGreaterThan(src.indexOf("process.argv[1] === fileURLToPath"));
  });
});

describe("statis: workflow qa-real-e2e.yml", () => {
  const wf = readFileSync(path.join(process.cwd(), ".github/workflows/qa-real-e2e.yml"), "utf8");
  const stepsStart = wf.indexOf("\n    steps:\n");
  const steps = wf.slice(stepsStart).split(/\n      - /).slice(1);
  const e2e = steps.find((s) => s.startsWith("name: QA-2 real email E2E")) as string;
  const stop = steps.find((s) => s.startsWith("name: Hentikan aplikasi QA")) as string;
  const idx = (needle: string) => e2e.indexOf(needle);

  it("urutan di langkah E2E: trap stop, build, start (readiness), baru E2E", () => {
    expect(e2e).toBeDefined();
    const trap = idx("trap 'node scripts/qa/start-app-and-wait.mjs stop");
    const build = idx("node scripts/qa/start-app-and-wait.mjs build");
    const start = idx("node scripts/qa/start-app-and-wait.mjs start");
    const run = idx("node scripts/qa/real-e2e.mjs\n");
    expect(trap).toBeGreaterThan(-1);
    expect(trap).toBeLessThan(build);
    expect(build).toBeLessThan(start);
    expect(start).toBeLessThan(run);
    expect(e2e).toContain("EXIT");
  });

  it("langkah berurutan: npm ci < Playwright < Guard < E2E < Hentikan; Hentikan always() tanpa env/secret", () => {
    const at = (n: string) => steps.findIndex((s) => s.includes(n));
    expect(at("run: npm ci")).toBeLessThan(at("name: Pasang Playwright"));
    expect(at("name: Pasang Playwright")).toBeLessThan(at("name: Guard"));
    expect(at("name: Guard")).toBeLessThan(at("name: QA-2 real email E2E"));
    expect(at("name: QA-2 real email E2E")).toBeLessThan(at("name: Hentikan aplikasi QA"));
    expect(stop).toBeDefined();
    expect(stop).toMatch(/if: \$\{\{ always\(\) \}\}/);
    expect(stop).not.toMatch(/secrets\.|\benv:|vars\./);
    expect(stop).toContain("start-app-and-wait.mjs stop");
  });

  it("secret hanya di langkah Guard dan E2E; Guard tidak menjalankan aplikasi; tidak ada secret di tingkat job", () => {
    const withSecrets = steps.filter((s) => /secrets\./.test(s));
    expect(withSecrets.map((s) => s.split("\n")[0])).toEqual(["name: Guard (hanya proyek QA, tanpa kredensial produksi)", "name: QA-2 real email E2E"]);
    expect(withSecrets[0]).not.toContain("start-app-and-wait");
    expect(wf.slice(0, stepsStart)).not.toMatch(/secrets\.|\n\s+env:/);
  });

  it("tetap workflow_dispatch saja, if main + QA2_ENABLED + frasa + environment, timeout-minutes diset", () => {
    expect(wf).toMatch(/^on:\s*\n\s+workflow_dispatch:/m);
    expect(wf).not.toMatch(/^\s+(push|pull_request|pull_request_target|schedule|workflow_run|repository_dispatch):/m);
    expect(wf).toContain("github.ref == 'refs/heads/main'");
    expect(wf).toContain("vars.QA2_ENABLED == 'true'");
    expect(wf).toContain("inputs.confirm == 'RUN-QA-2-REAL-EMAIL'");
    expect(wf).toContain("environment: qa-real-email");
    expect(wf).toMatch(/timeout-minutes: (?:[1-9]|[12]\d|30)\s*$/m);
  });

  it("semua action dipin ke SHA 40 hex; QA2_ENABLED/ACTIVATED tidak pernah di-set literal true", () => {
    const uses = [...wf.matchAll(/^\s*- uses: (\S+)(.*)$/gm)];
    expect(uses.length).toBeGreaterThanOrEqual(2);
    for (const u of uses) expect(u[1]).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
    expect(wf).not.toMatch(/QA2_ENABLED:\s*['"]?true/i);
    expect(wf).not.toMatch(/QA2_ACTIVATED:\s*['"]?true/i);
    expect(wf).not.toMatch(/(vars|secrets)\.QA2_ACTIVATED/);
  });

  it("tanpa langkah pengirim email, hosting, atau variabel produksi di workflow", () => {
    expect(wf).not.toMatch(/netlify|deploy\s|SERVICE_ROLE|DATABASE_URL|RESEND_API_KEY|api\.resend\.com|sendmail|smtp\.resend/i);
    expect(wf).not.toMatch(/curl\s|signup|register/i);
    expect(wf).not.toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY|(?<![A-Z_])SUPABASE_SECRET_KEY:/);
  });
});
