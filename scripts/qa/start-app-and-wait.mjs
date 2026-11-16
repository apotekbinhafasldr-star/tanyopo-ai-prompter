import { spawn as nodeSpawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";
import { assertRealQaEnv, redact } from "./real-e2e-guard.mjs";

// QA-2: bangun dan jalankan aplikasi LOKAL (next start) yang menunjuk proyek Supabase QA, lalu tunggu siap. Fail-closed.
// Node murni, tanpa dependensi baru. Tiga sub-perintah: build | start | stop (lihat docs/QA2_APP_STARTUP.md).
//  * Semua efek (spawn, fetch, berkas, port, waktu) lewat parameter agar dapat diuji tanpa jaringan.
//  * Env proses anak DIBANGUN DARI NOL (daftar putih). Tidak ada variabel runner/produksi yang ikut; env kosong = fitur mati.
//  * Aplikasi TIDAK diberi kunci server (SUPABASE_SECRET_KEY): jalur signup -> konfirmasi -> onboarding -> dashboard -> trial
//    tidak memakainya (createAdminClient tidak dipanggil di sana). QA_SUPABASE_SECRET_KEY hanya dipakai orkestrator E2E.

export const APP_HOST = "127.0.0.1";
export const APP_PORT = 3000;
export const APP_ORIGIN = `http://${APP_HOST}:${APP_PORT}`;
// Sama dengan Site URL proyek QA dan NEXT_PUBLIC_APP_URL di QA-1 (docs/QA2_AUTH_SMTP_CONFIG.md bagian 4).
export const APP_PUBLIC_URL = `http://localhost:${APP_PORT}`;
export const OUTPUT_DIR = "qa-output";
export const PID_FILE = `${OUTPUT_DIR}/start-app.pid`;
export const LOG_FILE = `${OUTPUT_DIR}/server.log`;
export const BUILD_MARKER = ".next/qa2-build.json";
export const BUILD_TIMEOUT_MS = 15 * 60_000;
export const READY_TIMEOUT_MS = 120_000;
export const READY_PATHS = Object.freeze(["/api/health", "/login"]);

// Variabel yang membuka fitur/integrasi berbayar atau produksi pada aplikasi: tidak boleh terisi saat start-app.
// (Guard real-e2e menolak sebagian lewat daftar sendiri; ini menambah semua nama yang dibaca lib/env.ts dan flag fitur.)
const APP_BLOCKED_NAMES = [
  "SUPABASE_SECRET_KEY",
  "TOKEN_ENCRYPTION_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "UMKMPRO_SERVICE_TOKEN",
  "JOBS_PROCESSOR_SECRET",
  "DEMO_SESSION_SECRET",
  "CHECKOUT_ALLOWED_ORIGINS",
  "PREVIEW_BASIC_AUTH_USER",
  "PREVIEW_BASIC_AUTH_PASSWORD",
  "ADMIN_CENTER_ENABLED",
  "EMAIL_OTP_ENABLED",
  "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
];
const APP_BLOCKED_PREFIXES = ["PAYMENT_", "AI_", "ALERT_EMAIL_", "META_", "TIKTOK_", "X_", "DOKU_", "MIDTRANS_", "RESEND_", "NETLIFY_", "VERCEL_"];
const ENV_FILE_NAMES = [".env", ".env.local", ".env.production", ".env.production.local", ".env.development", ".env.development.local", ".env.test", ".env.test.local"];
// Satu-satunya variabel runner yang diteruskan ke proses anak (selain yang dibangun di buildChildEnv).
const PASS_THROUGH = ["PATH", "HOME", "LANG", "TMPDIR", "TEMP", "TMP"];

/**
 * Memvalidasi env untuk build/start. Fail-closed; pesan hanya memuat NAMA variabel. Murni.
 * @param {Record<string, string | undefined>} env
 * @param {{ allowedRefs?: readonly string[] }} [options]
 * @returns {{ qaUrl: string, ref: string, publishableKey: string }}
 */
export function validateStartEnv(env, options = {}) {
  // Guard penuh QA-2: URL/ref QA (allowlist terkunci), NEXT_PUBLIC_SUPABASE_URL == QA_SUPABASE_URL, tanpa .supabase.com,
  // tanpa DATABASE_URL/SERVICE_ROLE/RESEND_*/dst.
  assertRealQaEnv(env, options);
  const violations = [];
  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== "string" || value === "") continue;
    if (APP_BLOCKED_NAMES.includes(name) || APP_BLOCKED_PREFIXES.some((p) => name.startsWith(p))) {
      violations.push(`variabel aplikasi terisi (fitur harus mati): ${name}`);
    }
  }
  const publishableKey = env.QA_SUPABASE_PUBLISHABLE_KEY;
  if (typeof publishableKey !== "string" || publishableKey.trim() === "") violations.push("QA_SUPABASE_PUBLISHABLE_KEY wajib diisi");
  if (env.NODE_ENV === "production" || env.NETLIFY || env.VERCEL) violations.push("lingkungan produksi/hosting terdeteksi");
  if (violations.length > 0) throw new Error(`QA-2 START REFUSED:\n - ${violations.join("\n - ")}`);
  const qaUrl = String(env.QA_SUPABASE_URL);
  const ref = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/.exec(qaUrl)?.[1];
  if (!ref) throw new Error("QA-2 START REFUSED:\n - QA_SUPABASE_URL tidak berformat proyek QA");
  return { qaUrl, ref, publishableKey: String(publishableKey) };
}

/**
 * Env proses anak (build/start), dibangun dari nol: hanya NEXT_PUBLIC_* QA, URL aplikasi lokal, host/port, dan PATH dasar.
 * @param {Record<string, string | undefined>} env
 * @param {{ qaUrl: string, publishableKey: string }} v
 * @returns {Record<string, string>}
 */
export function buildChildEnv(env, v) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const name of PASS_THROUGH) if (typeof env[name] === "string") out[name] = /** @type {string} */ (env[name]);
  out.NEXT_TELEMETRY_DISABLED = "1";
  out.NEXT_PUBLIC_SUPABASE_URL = v.qaUrl;
  out.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = v.publishableKey;
  out.NEXT_PUBLIC_APP_URL = APP_PUBLIC_URL;
  out.PORT = String(APP_PORT);
  out.HOSTNAME = APP_HOST;
  return out;
}

/** @param {number} ms @returns {Promise<void>} */
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @param {number} port @returns {Promise<boolean>} true bila ada yang mendengarkan */
function realPortInUse(port) {
  return new Promise((resolve) => {
    const s = connect({ host: APP_HOST, port });
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("error", () => resolve(false));
  });
}

/**
 * Menunggu aplikasi siap, fail-closed: tiap path di READY_PATHS wajib 200 (/api/health juga wajib {status:"ok"}).
 * Backoff 0,5 s dikali 1,5 sampai maks 3 s; berhenti segera bila proses anak mati; melempar saat batas waktu.
 * @param {{ fetch: typeof fetch, sleep: (ms: number) => Promise<void>, now: () => number, isAlive: () => boolean, timeoutMs?: number, paths?: readonly string[] }} o
 */
export async function waitForReady(o) {
  const timeoutMs = o.timeoutMs ?? READY_TIMEOUT_MS;
  const paths = o.paths ?? READY_PATHS;
  const deadline = o.now() + timeoutMs;
  let delay = 500;
  let last = "belum ada respons";
  for (;;) {
    if (!o.isAlive()) throw new Error("proses aplikasi berhenti sebelum siap");
    let allOk = true;
    for (const p of paths) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 5000);
      try {
        const res = await o.fetch(`${APP_ORIGIN}${p}`, { redirect: "manual", signal: ac.signal });
        let ok = res.status === 200;
        if (ok && p === "/api/health") {
          const body = /** @type {any} */ (await res.json().catch(() => null));
          ok = body?.status === "ok";
        }
        if (!ok) {
          allOk = false;
          last = `${p} -> ${res.status}`;
          break;
        }
      } catch (err) {
        allOk = false;
        last = `${p} -> ${err instanceof Error ? err.name : "galat"}`;
        break;
      } finally {
        clearTimeout(timer);
      }
    }
    if (allOk) return;
    if (o.now() + delay > deadline) throw new Error(`readiness habis waktu setelah ${timeoutMs} ms (terakhir: ${last})`);
    await o.sleep(delay);
    delay = Math.min(Math.round(delay * 1.5), 3000);
  }
}

/**
 * Mematikan satu grup proses dengan aman: hanya pid bilangan bulat > 1. SIGTERM dulu, SIGKILL bila masih hidup. Tidak pernah melempar.
 * @param {number} pid
 * @param {{ kill: (pid: number, sig: string | number) => void, sleep: (ms: number) => Promise<void> }} d
 */
export async function killGroup(pid, d) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    d.kill(-pid, "SIGTERM");
  } catch {
    return false; // sudah tidak ada
  }
  await d.sleep(1500);
  try {
    d.kill(-pid, 0);
    d.kill(-pid, "SIGKILL");
  } catch {
    /* sudah mati */
  }
  return true;
}

/**
 * @typedef {{ spawn: typeof nodeSpawn, fetch: typeof fetch, sleep: (ms: number) => Promise<void>, now: () => number,
 *   portInUse: (port: number) => Promise<boolean>, kill: (pid: number, sig: string | number) => void,
 *   fs: { existsSync: (p: string) => boolean, mkdirSync: (p: string) => void, readFileSync: (p: string) => string,
 *         writeFileSync: (p: string, c: string) => void, rmSync: (p: string) => void, openLog: (p: string) => number, closeLog: (fd: number) => void },
 *   waitForExit: (child: any, ms: number) => Promise<number | null> }} Deps
 */

/** @returns {Deps} */
export function realDeps() {
  return {
    spawn: nodeSpawn,
    fetch: globalThis.fetch,
    sleep: realSleep,
    now: () => Date.now(),
    portInUse: realPortInUse,
    kill: (pid, sig) => process.kill(pid, /** @type {any} */ (sig)),
    fs: {
      existsSync,
      mkdirSync: (p) => void mkdirSync(p, { recursive: true }),
      readFileSync: (p) => readFileSync(p, "utf8"),
      writeFileSync: (p, c) => writeFileSync(p, c),
      rmSync: (p) => rmSync(p, { force: true }),
      openLog: (p) => openSync(p, "a"),
      closeLog: (fd) => closeSync(fd),
    },
    waitForExit: (child, ms) =>
      new Promise((resolve) => {
        const t = setTimeout(() => resolve(null), ms);
        child.once("exit", (code) => {
          clearTimeout(t);
          resolve(code ?? 1);
        });
        child.once("error", () => {
          clearTimeout(t);
          resolve(1);
        });
      }),
  };
}

/** @param {Deps} d */
function assertNoEnvFiles(d) {
  for (const name of ENV_FILE_NAMES) {
    if (d.fs.existsSync(name)) throw new Error(`QA-2 START REFUSED:\n - berkas ${name} ada di repo (bisa menyuntik env produksi ke build)`);
  }
}

/**
 * build: `npm run build` dengan env QA publik saja, lalu tulis penanda ref proyek QA ke .next/qa2-build.json.
 * @param {Record<string, string | undefined>} env
 * @param {Deps} d
 * @param {{ allowedRefs?: readonly string[] }} [options]
 */
export async function buildApp(env, d, options = {}) {
  const v = validateStartEnv(env, options);
  assertNoEnvFiles(d);
  const child = d.spawn("npm", ["run", "build"], { env: buildChildEnv(env, v), stdio: "inherit" });
  const code = await d.waitForExit(child, BUILD_TIMEOUT_MS);
  if (code !== 0) {
    try {
      child.kill?.("SIGKILL");
    } catch {
      /* abaikan */
    }
    throw new Error(code === null ? "build habis waktu" : `build gagal (kode ${code})`);
  }
  d.fs.writeFileSync(BUILD_MARKER, JSON.stringify({ ref: v.ref, appUrl: APP_PUBLIC_URL }));
}

/**
 * start: validasi, cek penanda build, pastikan port bebas, jalankan `npm run start` di 127.0.0.1:3000 (grup proses terpisah),
 * tulis pid SEGERA, tunggu siap. Gagal di jalur mana pun = grup proses dimatikan lalu melempar. Sukses: server tetap hidup.
 * @param {Record<string, string | undefined>} env
 * @param {Deps} d
 * @param {{ allowedRefs?: readonly string[], readyTimeoutMs?: number, onChild?: (c: any) => void }} [options]
 */
export async function startAppAndWait(env, d, options = {}) {
  const v = validateStartEnv(env, options);
  assertNoEnvFiles(d);
  let marker;
  try {
    marker = JSON.parse(d.fs.readFileSync(BUILD_MARKER));
  } catch {
    throw new Error("penanda build QA tidak ada: jalankan `build` lebih dulu");
  }
  if (marker?.ref !== v.ref) throw new Error("build tidak dibuat untuk proyek QA ini (ref penanda berbeda)");
  if (await d.portInUse(APP_PORT)) throw new Error(`port ${APP_PORT} sudah dipakai proses lain`);

  d.fs.mkdirSync(OUTPUT_DIR);
  const fd = d.fs.openLog(LOG_FILE);
  /** @type {any} */
  let child = null;
  let exited = false;
  try {
    child = d.spawn("npm", ["run", "start", "--", "-H", APP_HOST, "-p", String(APP_PORT)], {
      env: buildChildEnv(env, v),
      stdio: ["ignore", fd, fd],
      detached: true,
    });
    child.once?.("exit", () => {
      exited = true;
    });
    child.once?.("error", () => {
      exited = true;
    });
    options.onChild?.(child);
    if (!Number.isInteger(child.pid) || child.pid <= 1) throw new Error("proses aplikasi tidak terbentuk");
    d.fs.writeFileSync(PID_FILE, String(child.pid));
    await waitForReady({ fetch: d.fetch, sleep: d.sleep, now: d.now, isAlive: () => !exited, timeoutMs: options.readyTimeoutMs });
    child.unref?.();
    return { pid: /** @type {number} */ (child.pid) };
  } catch (err) {
    if (child && Number.isInteger(child.pid)) await killGroup(child.pid, d);
    try {
      d.fs.rmSync(PID_FILE);
    } catch {
      /* abaikan */
    }
    throw err;
  } finally {
    try {
      d.fs.closeLog(fd);
    } catch {
      /* abaikan */
    }
  }
}

/**
 * stop: matikan grup proses dari berkas pid (best-effort, aman dipanggil berulang). Tidak pernah melempar.
 * @param {Deps} d
 */
export async function stopApp(d) {
  let pid = NaN;
  try {
    pid = Number(d.fs.readFileSync(PID_FILE).trim());
  } catch {
    return false;
  }
  const killed = await killGroup(pid, d);
  try {
    d.fs.rmSync(PID_FILE);
  } catch {
    /* abaikan */
  }
  return killed;
}

/**
 * Pintu masuk yang dapat diuji (tanpa process.exit). Kode keluar: 0 sukses, 2 ditolak guard/env, 1 gagal lain.
 * @param {{ argv: string[], env: Record<string, string | undefined>, deps: Deps, exit: (code: number) => void,
 *   io?: { log: (s: string) => void, error: (s: string) => void }, options?: { allowedRefs?: readonly string[], readyTimeoutMs?: number } }} o
 */
export async function runMain(o) {
  const io = o.io ?? { log: (s) => console.log(s), error: (s) => console.error(s) };
  /** @param {unknown} err */
  const msg = (err) => redact(String(err instanceof Error ? err.message : err), o.env);
  const cmd = o.argv[0];
  try {
    if (cmd === "stop") {
      const killed = await stopApp(o.deps);
      io.log(killed ? "aplikasi QA dihentikan" : "tidak ada aplikasi QA yang berjalan");
      return o.exit(0);
    }
    if (cmd === "build") {
      await buildApp(o.env, o.deps, o.options);
      io.log("build QA selesai (NEXT_PUBLIC_* = proyek QA)");
      return o.exit(0);
    }
    if (cmd === "start") {
      const r = await startAppAndWait(o.env, o.deps, o.options);
      io.log(`aplikasi QA siap di ${APP_ORIGIN} (pid ${r.pid})`);
      return o.exit(0);
    }
    io.error("pemakaian: start-app-and-wait.mjs build|start|stop");
    return o.exit(2);
  } catch (err) {
    const m = msg(err);
    io.error(m);
    if (cmd === "start") {
      try {
        const tail = o.deps.fs.readFileSync(LOG_FILE).split("\n").slice(-40).join("\n");
        io.error(`--- 40 baris terakhir server.log ---\n${redact(tail, o.env)}`);
      } catch {
        /* tidak ada log */
      }
    }
    return o.exit(m.startsWith("QA-2 GUARD REFUSED") || m.startsWith("QA-2 START REFUSED") ? 2 : 1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const deps = realDeps();
  /** @type {number | undefined} */
  let code;
  let activeChild = /** @type {any} */ (null);
  // Dibatalkan saat start berjalan (mis. job dibatalkan): matikan anak agar tidak yatim.
  for (const sig of /** @type {const} */ (["SIGINT", "SIGTERM"])) {
    process.once(sig, () => {
      if (activeChild?.pid) void killGroup(activeChild.pid, deps).finally(() => process.exit(1));
      else process.exit(1);
    });
  }
  runMain({
    argv: process.argv.slice(2),
    env: process.env,
    deps,
    exit: (c) => {
      code = c;
    },
    options: { onChild: (c) => (activeChild = c) },
  }).then(() => process.exit(code ?? 1));
}
