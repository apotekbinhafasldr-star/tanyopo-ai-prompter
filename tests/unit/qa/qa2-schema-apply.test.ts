// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as mod from "../../../scripts/qa/apply-schema-bundle.mjs";
import { REAL_REFS, buildBundle } from "../../../scripts/qa/build-schema-bundle.mjs";
import { ALLOWED_QA_PROJECT_REFS } from "../../../scripts/qa/qa-project-allowlist.mjs";

// Semua psql PALSU (di memori): tanpa koneksi database/jaringan. Tipe sengaja longgar (pelajaran #153: .mjs bertipe JSDoc sempit).
const m = mod as any;
const parseQaDbUrl = m.parseQaDbUrl as (raw: any, o?: any) => any;
const runApply = m.runApply as (d: any) => Promise<{ exitCode: number; verdict: string; lines: string[] }>;
const buildChildEnv = m.buildChildEnv as (c: any, e?: any) => Record<string, string>;
const forbiddenEnvNames = m.forbiddenEnvNames as (e: any) => string[];
const assertReadOnly = m.assertReadOnly as (s: string) => void;

const root = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
const QA_REF = "gasdqsadnjoknisloaec";
const PROD_REF = REAL_REFS[0] as string;
const PW = "s3cretPW-ZZ9";
const PHRASE = "APPROVE QA-2-SCHEMA-BUNDLE";
const POOLER = `postgresql://postgres.${QA_REF}:${PW}@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`;
const DIRECT = `postgresql://postgres:${PW}@db.${QA_REF}.supabase.co:5432/postgres`;
const PATHENV = { PATH: "/usr/bin" };

describe("guard QA_DB_URL", () => {
  it("allowlist hanya proyek QA dan menjadi satu-satunya sumber ref", () => {
    expect(ALLOWED_QA_PROJECT_REFS).toEqual([QA_REF]);
  });

  it("menerima bentuk pooler dan direct (serta sslmode=require)", () => {
    const a = parseQaDbUrl(POOLER);
    expect(a.form).toBe("pooler");
    expect(a.user).toBe(`postgres.${QA_REF}`);
    expect(a.password).toBe(PW);
    expect(a.ref).toBe(QA_REF);
    const b = parseQaDbUrl(DIRECT);
    expect(b.form).toBe("direct");
    expect(b.user).toBe("postgres");
    expect(parseQaDbUrl(`${DIRECT}?sslmode=require`).host).toBe(`db.${QA_REF}.supabase.co`);
    expect(parseQaDbUrl(POOLER.replace("postgresql:", "postgres:")).form).toBe("pooler");
    // password ber-encoding didekode
    expect(parseQaDbUrl(`postgresql://postgres:p%40ss%2Fw@db.${QA_REF}.supabase.co:5432/postgres`).password).toBe("p@ss/w");
  });

  const bad: [string, any][] = [
    ["kosong", ""],
    ["undefined", undefined],
    ["ref lain (direct)", `postgresql://postgres:${PW}@db.abcdefghij0123456789.supabase.co:5432/postgres`],
    ["ref lain (pooler user)", `postgresql://postgres.abcdefghij0123456789:${PW}@aws-0-x.pooler.supabase.com:5432/postgres`],
    ["ref nyata di host", `postgresql://postgres:${PW}@db.${PROD_REF}.supabase.co:5432/postgres`],
    ["ref nyata di user", `postgresql://postgres.${PROD_REF}:${PW}@aws-0-x.pooler.supabase.com:5432/postgres`],
    ["ref nyata di path", `${DIRECT.replace("/postgres", `/${PROD_REF}`)}`],
    ["ref nyata di query", `${DIRECT}?sslmode=require&application_name=${PROD_REF}`],
    ["ref nyata + ref QA bersama", `postgresql://postgres.${QA_REF}:${PW}@aws-0-x.pooler.supabase.com:5432/postgres?x=${PROD_REF}`],
    ["host aneh", `postgresql://postgres:${PW}@evil.example.com:5432/postgres`],
    ["host mirip", `postgresql://postgres:${PW}@db.${QA_REF}.supabase.co.evil.com:5432/postgres`],
    ["pooler palsu", `postgresql://postgres.${QA_REF}:${PW}@x.pooler.supabase.com.evil.com:5432/postgres`],
    ["pooler dengan user postgres saja", `postgresql://postgres:${PW}@aws-0-x.pooler.supabase.com:5432/postgres`],
    ["direct dengan user pooler", `postgresql://postgres.${QA_REF}:${PW}@db.${QA_REF}.supabase.co:5432/postgres`],
    ["hostaddr", `${DIRECT}?hostaddr=10.0.0.1`],
    ["options", `${DIRECT}?options=-c%20search_path%3Dx`],
    ["service", `${DIRECT}?service=prod`],
    ["host= di query", `${DIRECT}?host=evil.example.com`],
    ["dsn", `${DIRECT}?dsn=x`],
    ["sslmode lemah", `${DIRECT}?sslmode=disable`],
    ["query ganda", `${DIRECT}?sslmode=require&sslmode=require`],
    ["database lain", DIRECT.replace("/postgres", "/template1")],
    ["tanpa password", `postgresql://postgres@db.${QA_REF}.supabase.co:5432/postgres`],
    ["password kosong", `postgresql://postgres:@db.${QA_REF}.supabase.co:5432/postgres`],
    ["skema http", DIRECT.replace("postgresql:", "https:")],
    ["skema mysql", DIRECT.replace("postgresql:", "mysql:")],
    ["port lain", DIRECT.replace(":5432", ":6543")],
    ["fragmen", `${DIRECT}#x`],
    ["spasi", ` ${DIRECT}`],
    ["newline", `${DIRECT}\n`],
    ["bukan URL", "postgresql://"],
  ];
  for (const [name, url] of bad) {
    it(`menolak: ${name}`, () => {
      expect(() => parseQaDbUrl(url)).toThrow();
      try {
        parseQaDbUrl(url);
      } catch (e: any) {
        expect(String(e.message)).not.toContain(PW);
        expect(String(e.message)).not.toContain("postgresql://");
      }
    });
  }

  it("ref di allowlist yang bukan 20 karakter tidak pernah cocok; ref lain ditolak walau bentuk benar", () => {
    expect(() => parseQaDbUrl(DIRECT, { allowedRefs: ["abcdefghij0123456789"] })).toThrow();
    expect(() => parseQaDbUrl(DIRECT, { allowedRefs: ["short"] })).toThrow();
  });
});

describe("env proses dan env anak", () => {
  it("menolak env yang menunjuk produksi/akses luas atau membelokkan psql", () => {
    const names = [
      "SUPABASE_ACCESS_TOKEN",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_URL",
      "DATABASE_URL",
      "POSTGRES_URL",
      "PGHOST",
      "PGUSER",
      "PGDATABASE",
      "PGSERVICE",
      "PGOPTIONS",
      "PGPASSFILE",
      "PGPASSWORD",
      "PGHOSTADDR",
      "PGSSLMODE",
      "PSQLRC",
      "QA_SUPABASE_SECRET_KEY",
    ];
    for (const n of names) expect(forbiddenEnvNames({ [n]: "x" }), n).toEqual([n]);
    expect(forbiddenEnvNames({ PATH: "/usr/bin", QA_DB_URL: POOLER, GITHUB_STEP_SUMMARY: "/tmp/x", QA_APPLY_MODE: "check", HOME: "/h" })).toEqual([]);
    expect(forbiddenEnvNames({ PGHOST: "" })).toEqual([]);
  });

  it("env anak dibangun dari nol: hanya variabel yang ditentukan", () => {
    const conn = parseQaDbUrl(POOLER);
    const env = buildChildEnv(conn, { PATH: "/usr/bin", HOME: "/root", GITHUB_TOKEN: "ghs_x", QA_DB_URL: POOLER, NODE_OPTIONS: "--x" });
    expect(Object.keys(env).sort()).toEqual(["PATH", "PGAPPNAME", "PGCONNECT_TIMEOUT", "PGDATABASE", "PGHOST", "PGPASSWORD", "PGPORT", "PGSSLMODE", "PGUSER"]);
    expect(env.PGSSLMODE).toBe("require");
    expect(env.PGPASSWORD).toBe(PW);
    expect(env.PGUSER).toBe(`postgres.${QA_REF}`);
    expect(env.PGDATABASE).toBe("postgres");
    expect(JSON.stringify(env)).not.toContain("ghs_x");
  });
});

// ---------------------------------------------------------------------------
// psql palsu yang mensimulasikan database
type Call = { cmd: string; args: string[]; env: Record<string, string>; input: string };
type Opts = { tables?: number; users?: number; marker?: boolean; applied?: string[]; verify?: string; failPart?: number; rls?: string; leak?: boolean; connFail?: boolean };
const real = (m.buildParts as (r: string) => any)(root);
const parts: { text: string; versions: { version: string; sha256: string }[] }[] = real.parts;
const N: number = real.migrationCount;
const GOOD_VERIFY = `${N}|O|1|1|3|t|t|t|1`;

function fakeDb(o: Opts = {}) {
  const st = { tables: o.tables ?? 0, users: o.users ?? 0, marker: o.marker ?? false, applied: [...(o.applied ?? [])] };
  const calls: Call[] = [];
  const spawn = (cmd: string, args: string[], x: { env: Record<string, string>; input: string }) => {
    calls.push({ cmd, args, env: x.env, input: x.input });
    const leak = o.leak ? `FATAL: password authentication failed for ${PW} ${POOLER}\n` : "";
    if (o.connFail) return { status: 2, stdout: "", stderr: leak || "could not connect\n" };
    if (x.input === m.Q_STATE) return { status: 0, stdout: `postgres|${st.tables}|${st.marker ? "t" : "f"}|${st.marker ? "t" : "f"}|${st.users}\n`, stderr: "" };
    if (x.input === m.Q_MARKER) return { status: 0, stdout: "1\n", stderr: "" };
    if (x.input === m.Q_APPLIED) return { status: 0, stdout: st.applied.join("\n") + (st.applied.length ? "\n" : ""), stderr: "" };
    if (x.input === m.Q_VERIFY) return { status: 0, stdout: (o.verify ?? GOOD_VERIFY) + "\n", stderr: "" };
    const idx = parts.findIndex((p) => p.text === x.input);
    if (idx >= 0) {
      if (o.failPart === idx + 1) return { status: 3, stdout: "", stderr: `${leak}psql:<stdin>:10: ERROR:  boom di bagian ${idx + 1}\n` };
      st.marker = true;
      st.tables = 30;
      for (const v of parts[idx].versions) st.applied.push(`${v.version}:${v.sha256}`);
      return { status: 0, stdout: "", stderr: "" };
    }
    if (x.input === read("qa/qa2-rls-cross-tenant.sql")) {
      return { status: 3, stdout: "", stderr: o.rls ?? "psql:<stdin>:107: ERROR:  QA2_RLS_RESULT ALL_PASS | fails=0 | A_baca_tenant_sendiri=PASS\n" };
    }
    return { status: 1, stdout: "", stderr: "SQL tak dikenal\n" };
  };
  return { spawn, calls, st };
}
const fullApplied = parts.flatMap((p) => p.versions.map((v) => `${v.version}:${v.sha256}`));
const sqlSent = (calls: Call[]) => calls.map((c) => c.input);

async function go(env: Record<string, string | undefined>, o: Opts = {}) {
  const db = fakeDb(o);
  const summaries: string[] = [];
  const out: string[] = [];
  const r = await runApply({ env: { ...PATHENV, QA_DB_URL: POOLER, ...env }, spawn: db.spawn, log: (l: string) => out.push(l), writeSummary: (t: string) => summaries.push(t) });
  return { r, db, summaries, out };
}

describe("penolakan guard (exit 2, tanpa koneksi)", () => {
  it("mode apply tanpa frasa / frasa salah / variasi huruf dan spasi", async () => {
    const variants = [undefined, "", "approve qa-2-schema-bundle", `${PHRASE} `, ` ${PHRASE}`, "APPROVE  QA-2-SCHEMA-BUNDLE", "APPROVE QA-2-SCHEMA-BUNDLE.", "RUN-QA-2-REAL-EMAIL", "APPROVE QA-2-SCHEMA"];
    for (const v of variants) {
      const { r, db } = await go({ QA_APPLY_MODE: "apply", QA_APPLY_CONFIRM: v }, {});
      expect(r.exitCode, String(v)).toBe(2);
      expect(db.calls).toHaveLength(0);
    }
  });

  it("mode tidak dikenal / kosong ditolak", async () => {
    for (const mode of ["", "reset", "drop", "APPLY", "check "]) {
      const { r, db } = await go({ QA_APPLY_MODE: mode, QA_APPLY_CONFIRM: PHRASE });
      expect(r.exitCode, mode).toBe(2);
      expect(db.calls).toHaveLength(0);
    }
  });

  it("URL buruk atau env berbahaya ditolak tanpa koneksi, dan URL tidak dicetak", async () => {
    const urls = [DIRECT.replace(QA_REF, "abcdefghij0123456789"), `postgresql://postgres:${PW}@db.${PROD_REF}.supabase.co:5432/postgres`, `${DIRECT}?hostaddr=1.2.3.4`];
    for (const u of urls) {
      const { r, db, out, summaries } = await go({ QA_APPLY_MODE: "check", QA_DB_URL: u });
      expect(r.exitCode).toBe(2);
      expect(db.calls).toHaveLength(0);
      expect((out.join("\n") + summaries.join("\n")).includes(PW)).toBe(false);
      expect((out.join("\n") + summaries.join("\n")).includes(PROD_REF)).toBe(false);
    }
    for (const bad of ["PGHOST", "PGOPTIONS", "PGSERVICE", "DATABASE_URL", "SUPABASE_ACCESS_TOKEN", "SUPABASE_SERVICE_ROLE_KEY"]) {
      const { r, db, out } = await go({ QA_APPLY_MODE: "check", [bad]: "x" });
      expect(r.exitCode, bad).toBe(2);
      expect(db.calls).toHaveLength(0);
      expect(out.join("\n")).toContain(bad);
    }
  });
});

describe("mode check (baca-saja)", () => {
  it("proyek kosong: laporan EMPTY, exit 0, semua SQL hanya SELECT", async () => {
    const { r, db, summaries } = await go({ QA_APPLY_MODE: "check" });
    expect(r.exitCode).toBe(0);
    expect(r.verdict).toContain("kosong");
    expect(db.calls.length).toBeGreaterThan(0);
    for (const sql of sqlSent(db.calls)) {
      expect(sql.trim().toLowerCase().startsWith("select ")).toBe(true);
      expect(sql).not.toMatch(/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|begin|commit)\b/i);
      expect(() => assertReadOnly(sql)).not.toThrow();
    }
    expect(summaries.join("\n")).toContain("EMPTY");
  });

  it("sudah terpasang: INSTALLED_VERIFIED, exit 0; tak dikenal/sebagian: exit 1; semuanya hanya SELECT", async () => {
    const a = await go({ QA_APPLY_MODE: "check" }, { marker: true, tables: 35, applied: fullApplied });
    expect(a.r.exitCode).toBe(0);
    expect(a.out.join("\n")).toContain("INSTALLED_VERIFIED");
    const b = await go({ QA_APPLY_MODE: "check" }, { tables: 12, users: 3 });
    expect(b.r.exitCode).toBe(1);
    expect(b.out.join("\n")).toContain("UNKNOWN");
    const c = await go({ QA_APPLY_MODE: "check" }, { marker: true, tables: 20, applied: fullApplied.slice(0, parts[0].versions.length) });
    expect(c.r.exitCode).toBe(1);
    expect(c.out.join("\n")).toContain("PARTIAL");
    for (const x of [a, b, c]) for (const sql of sqlSent(x.db.calls)) expect(() => assertReadOnly(sql)).not.toThrow();
  });

  it("assertReadOnly menolak pernyataan tulis", () => {
    for (const s of ["insert into t values (1);", "select 1; drop table t;", "drop table t;", "delete from t;", "select * from t; update t set a=1;", "do $$begin end$$;", "select 1"]) {
      expect(() => assertReadOnly(s), s).toThrow();
    }
  });

  it("kegagalan koneksi: exit 1 dan password/URL tidak muncul di keluaran", async () => {
    const { r, out, summaries } = await go({ QA_APPLY_MODE: "check" }, { connFail: true, leak: true });
    expect(r.exitCode).toBe(1);
    const all = out.join("\n") + summaries.join("\n");
    expect(all.includes(PW)).toBe(false);
    expect(all.includes("postgresql://")).toBe(false);
  });
});

describe("mode apply", () => {
  const env = { QA_APPLY_MODE: "apply", QA_APPLY_CONFIRM: PHRASE };

  it("proyek kosong: bagian 1-2-3 berurutan lalu verifikasi PASS; psql dipanggil dengan argumen/env aman", async () => {
    const { r, db, out } = await go(env);
    expect(r.exitCode).toBe(0);
    expect(r.verdict).toBe("APPLY PASS");
    const partCalls = db.calls.map((c) => parts.findIndex((p) => p.text === c.input)).filter((i) => i >= 0);
    expect(partCalls).toEqual([0, 1, 2]);
    // pemeriksaan sebelum (kueri baca) mendahului bagian 1; verifikasi setelah bagian 3
    expect(db.calls[0].input).toBe(m.Q_STATE);
    expect(db.calls[db.calls.length - 1].input).toBe(m.Q_VERIFY);
    expect(out.join("\n")).toContain("VERIFIKASI: PASS");
    expect(out.join("\n")).toMatch(/sha256=[0-9a-f]{64}/);
    for (const c of db.calls) {
      expect(c.cmd).toBe("psql");
      expect(c.args.slice(0, 4)).toEqual(["-X", "-v", "ON_ERROR_STOP=1", "--no-password"]);
      expect(c.args).not.toContain("-c");
      expect(c.args.join(" ")).not.toContain(PW);
      expect(c.args.join(" ")).not.toContain(QA_REF);
      expect(Object.keys(c.env).sort()).toEqual(["PATH", "PGAPPNAME", "PGCONNECT_TIMEOUT", "PGDATABASE", "PGHOST", "PGPASSWORD", "PGPORT", "PGSSLMODE", "PGUSER"]);
      expect(c.env.PGPASSWORD).toBe(PW);
    }
  });

  it("berhenti di galat pertama: bagian 2 gagal -> bagian 3 tidak dijalankan, exit 1", async () => {
    const { r, db } = await go(env, { failPart: 2 });
    expect(r.exitCode).toBe(1);
    const partCalls = db.calls.map((c) => parts.findIndex((p) => p.text === c.input)).filter((i) => i >= 0);
    expect(partCalls).toEqual([0, 1]);
    expect(db.calls.some((c) => c.input === m.Q_VERIFY)).toBe(false);
  });

  it("bagian 1 gagal: bagian 2 dan 3 tidak dijalankan", async () => {
    const { r, db } = await go(env, { failPart: 1 });
    expect(r.exitCode).toBe(1);
    expect(db.calls.filter((c) => parts.some((p) => p.text === c.input))).toHaveLength(1);
  });

  it("password dan URL tidak muncul di output/galat/ringkasan walau psql palsu menuliskannya ke stderr", async () => {
    const { r, out, summaries } = await go(env, { failPart: 1, leak: true });
    expect(r.exitCode).toBe(1);
    const all = [...out, ...summaries, ...r.lines].join("\n");
    expect(all.includes(PW)).toBe(false);
    expect(all.includes("postgresql://")).toBe(false);
    expect(all).toContain("[REDACTED]");
  });

  it("sudah terpasang penuh: ALREADY_APPLIED, exit 0, tidak menulis (tak ada bagian dikirim)", async () => {
    const { r, db, out } = await go(env, { marker: true, tables: 35, applied: fullApplied });
    expect(r.exitCode).toBe(0);
    expect(out.join("\n")).toContain("ALREADY_APPLIED");
    expect(db.calls.some((c) => parts.some((p) => p.text === c.input))).toBe(false);
    for (const sql of sqlSent(db.calls)) expect(() => assertReadOnly(sql)).not.toThrow();
  });

  it("proyek tidak kosong dan belum terpasang: ditolak (exit 2), tidak ada bagian dikirim", async () => {
    for (const o of [{ tables: 40, users: 5 }, { tables: 3 }, { users: 1 }, { marker: true, tables: 5, applied: ["20200101000000:" + "0".repeat(64)] }]) {
      const { r, db } = await go(env, o);
      expect(r.exitCode).toBe(2);
      expect(db.calls.some((c) => parts.some((p) => p.text === c.input))).toBe(false);
    }
  });

  it("terpasang sebagian dari bundel yang sama: melanjutkan dari bagian berikutnya", async () => {
    const { r, db } = await go(env, { marker: true, tables: 20, applied: fullApplied.slice(0, parts[0].versions.length) });
    expect(r.exitCode).toBe(0);
    const partCalls = db.calls.map((c) => parts.findIndex((p) => p.text === c.input)).filter((i) => i >= 0);
    expect(partCalls).toEqual([1, 2]);
  });

  it("verifikasi akhir: satu indikator salah = FAIL (exit 1), PASS hanya bila semua benar", async () => {
    for (const verify of [`${N - 1}|O|1|1|3|t|t|t|1`, `${N}|D|1|1|3|t|t|t|1`, `${N}|O|0|1|3|t|t|t|1`, `${N}|O|1|0|3|t|t|t|1`, `${N}|O|1|1|2|t|t|t|1`, `${N}|O|1|1|3|f|t|t|1`, `${N}|O|1|1|3|t|f|t|1`, `${N}|O|1|1|3|t|t|f|1`, `${N}|O|1|1|3|t|t|t|0`, `${N}|O|1|1|3|t|t|t`, ""]) {
      const { r } = await go(env, { verify });
      expect(r.exitCode, verify).toBe(1);
    }
  });

  it("kueri verifikasi sama dengan akhir bagian 3 bundel (nilai harapan dikunci)", () => {
    const last = parts[parts.length - 1].text;
    const squash = (s: string) => s.replace(/\s+/g, " ").trim();
    const tailSel = squash(last.slice(last.lastIndexOf("\nselect\n") + 1)).replace(/^select /, "").replace(/ as [a-z_]+/g, "");
    const mine = squash(m.Q_VERIFY).replace(/^select /, "").replace(/ as [a-z_]+/g, "");
    expect(mine).toBe(tailSel);
    expect(m.expectedIndicators(15).map((x: string[]) => x[0])).toEqual([
      "migrations_applied", "trial_trigger", "free_plan_active", "signup_trigger", "shim_policies", "authenticated_access", "service_role_access", "app_table_grants", "reset_trigger",
    ]);
    expect(N).toBe(15);
  });
});

describe("mode rls-test", () => {
  const env = { QA_APPLY_MODE: "rls-test" };
  it("sukses hanya bila pesan memuat ALL_PASS | fails=0", async () => {
    const ok = await go(env, { marker: true, tables: 35, applied: fullApplied });
    expect(ok.r.exitCode).toBe(0);
    const fail = await go(env, { marker: true, tables: 35, applied: fullApplied, rls: "ERROR:  QA2_RLS_RESULT FAIL | fails=2 | A_baca_tenant_B=FAIL\n" });
    expect(fail.r.exitCode).toBe(1);
    const fake = await go(env, { marker: true, tables: 35, applied: fullApplied, rls: "ERROR:  QA2_RLS_RESULT ALL_PASS | fails=1 | x\n" });
    expect(fake.r.exitCode).toBe(1);
    const other = await go(env, { marker: true, tables: 35, applied: fullApplied, rls: "psql:<stdin>:30: ERROR:  column \"x\" of relation \"users\" does not exist\n" });
    expect(other.r.exitCode).toBe(1);
    expect(other.out.join("\n")).toContain("GAGAL dieksekusi");
    expect(other.summaries.join("\n")).toContain("TIDAK membatalkan apply");
  });
  it("ditolak (exit 2) bila skema belum terpasang; tidak mengirim berkas RLS", async () => {
    const { r, db } = await go(env, {});
    expect(r.exitCode).toBe(2);
    expect(db.calls.some((c) => c.input === read("qa/qa2-rls-cross-tenant.sql"))).toBe(false);
  });
});

describe("tanpa fungsi merusak dan tanpa jaringan", () => {
  const src = read("scripts/qa/apply-schema-bundle.mjs");
  it("tidak ada drop/reset/truncate proyek, tidak ada fetch/http, tidak mencetak URL", () => {
    const code = src.replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/drop\s+(schema|database|table)|truncate\s+|reset\s+database|delete\s+from\s+auth/i);
    expect(code).not.toMatch(/\bfetch\(|node:https?|node:net|XMLHttpRequest/);
    expect(code).not.toMatch(/console\.(log|error)\([^)]*(QA_DB_URL|password)/);
    expect(src).toContain("--no-password");
    expect(src).toContain('"-X"');
  });
  it("bagian bundel tidak memuat meta-command psql", () => {
    for (const p of parts) expect(/^\s*\\/m.test(p.text)).toBe(false);
    expect(buildBundle({ root, parts: 3 }).parts).toHaveLength(3);
  });
});

describe("workflow statis: qa-schema-apply.yml", () => {
  const raw = read(".github/workflows/qa-schema-apply.yml");
  const wf = raw.replace(/^\s*#.*$/gm, "").replace(/\s#\s.*$/gm, "");
  const steps = wf
    .slice(wf.indexOf("\n    steps:\n"))
    .split(/\n      - /)
    .slice(1);

  it("hanya workflow_dispatch dengan mode (choice, default check) dan confirm", () => {
    expect(wf).toMatch(/^on:\s*\n\s+workflow_dispatch:/m);
    expect(wf).not.toMatch(/^\s+(push|pull_request|pull_request_target|schedule|workflow_run|repository_dispatch):/m);
    expect(wf).toMatch(/mode:[\s\S]*?type: choice[\s\S]*?default: check[\s\S]*?options:\s*\n\s+- check\s*\n\s+- apply\s*\n\s+- rls-test/);
    expect(wf).toMatch(/confirm:[\s\S]*?type: string/);
  });

  it("job: if main, Environment qa-real-email, permissions contents: read, concurrency tanpa cancel, timeout kecil", () => {
    expect(wf).toContain("github.ref == 'refs/heads/main'");
    expect(wf).toMatch(/environment: qa-real-email\s*\n/);
    expect(wf).toMatch(/^permissions:\s*\n\s+contents: read\s*$/m);
    expect(wf).not.toMatch(/(write|id-token|pull-requests|actions):\s*(write|read)/);
    expect(wf).toMatch(/concurrency:\s*\n\s+group: qa-schema-apply\s*\n\s+cancel-in-progress: false/);
    const t = Number(/timeout-minutes: (\d+)/.exec(wf)?.[1]);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThanOrEqual(15);
  });

  it("aksi dipin SHA yang sama dengan qa-real-e2e.yml; persist-credentials false", () => {
    const e2e = read(".github/workflows/qa-real-e2e.yml");
    const pin = (s: string, a: string) => new RegExp(`uses: actions/${a}@([0-9a-f]{40})`).exec(s)?.[1];
    expect(pin(raw, "checkout")).toBe("11bd71901bbe5b1630ceea73d27597364c9af683");
    expect(pin(raw, "checkout")).toBe(pin(e2e, "checkout"));
    expect(pin(raw, "setup-node")).toBe("49933ea5288caeca8642d1e84afbd3f7d6820020");
    expect(pin(raw, "setup-node")).toBe(pin(e2e, "setup-node"));
    for (const u of raw.match(/uses: \S+/g) ?? []) expect(u).toMatch(/@[0-9a-f]{40}$/);
    expect(wf).toMatch(/persist-credentials: false/);
  });

  it("mode apply memeriksa frasa persis di langkah tanpa secret (fail-closed)", () => {
    const val = steps.find((s) => s.includes("Validasi mode dan frasa"));
    expect(val).toBeDefined();
    expect(val).toContain('[ "$QA_APPLY_CONFIRM" != "APPROVE QA-2-SCHEMA-BUNDLE" ]');
    expect(val).toMatch(/exit 2/);
    expect(val).not.toMatch(/secrets\./);
    expect(val).toMatch(/\*\) .*exit 2/);
  });

  it("secret hanya QA_DB_URL dan hanya di SATU langkah (langkah eksekusi); input tidak diinterpolasi ke shell", () => {
    expect(wf.match(/secrets\.[A-Za-z0-9_]+/g)).toEqual(["secrets.QA_DB_URL"]);
    const withSecret = steps.filter((s) => /secrets\./.test(s));
    expect(withSecret).toHaveLength(1);
    expect(withSecret[0]).toContain("scripts/qa/apply-schema-bundle.mjs");
    expect(steps[steps.length - 1]).toBe(withSecret[0]);
    for (const s of steps) {
      if (s === withSecret[0]) continue;
      expect(s).not.toMatch(/QA_DB_URL/);
    }
    expect(wf).not.toMatch(/run:[^\n]*\$\{\{/);
    expect(wf).not.toMatch(/^env:/m);
  });

  it("tidak bergantung pada aktivasi QA-2 dan tidak ada secret/variabel lain", () => {
    expect(wf).not.toMatch(/QA2_ENABLED|QA2_ACTIVATED|vars\./);
    for (const n of ["SUPABASE_ACCESS_TOKEN", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "DATABASE_URL", "NETLIFY", "RESEND", "GITHUB_TOKEN", "NEXT_PUBLIC_SUPABASE_URL"]) expect(wf).not.toContain(n);
    expect(wf).not.toMatch(/PGHOST|PGUSER|PGPASSWORD|PGDATABASE|PGOPTIONS/);
  });

  it("tanpa curl/wget/nc ke luar dan tanpa langkah yang mencetak secret", () => {
    expect(wf).not.toMatch(/\b(curl|wget|nc|ncat|socat|ssh|scp)\b/);
    expect(wf).not.toMatch(/echo[^\n]*(QA_DB_URL|secrets\.)/);
    expect(wf).not.toMatch(/\bpsql\b[^\n]*-c\b/);
    expect(wf).not.toMatch(/ACTIONS_STEP_DEBUG|set -x/);
  });
});

describe("workflow statis: qa2-schema-bundle-test.yml", () => {
  const raw = read(".github/workflows/qa2-schema-bundle-test.yml");
  const wf = raw.replace(/^\s*#.*$/gm, "");
  it("pull_request dengan paths terkunci, permissions contents: read, tanpa secret, aksi dipin SHA", () => {
    expect(wf).toMatch(/^on:\s*\n\s+pull_request:\s*\n\s+paths:/m);
    expect(wf).not.toMatch(/^\s+(push|pull_request_target|schedule|workflow_dispatch|workflow_run):/m);
    for (const p of ["qa/**", "scripts/qa/build-schema-bundle.mjs", "scripts/qa/apply-schema-bundle.mjs", "supabase/migrations/**", ".github/workflows/qa2-schema-bundle-test.yml"]) expect(wf).toContain(`"${p}"`);
    expect(wf).toMatch(/^permissions:\s*\n\s+contents: read\s*$/m);
    expect(wf).not.toMatch(/secrets\.|vars\.|environment:/);
    for (const u of raw.match(/uses: \S+/g) ?? []) expect(u).toMatch(/@[0-9a-f]{40}$/);
    expect(wf).toContain("persist-credentials: false");
    expect(wf).toMatch(/image: postgres:\$\{\{ matrix\.pg \}\}/);
  });
  it("menjalankan bagian 1,2,3, verifikasi, RLS ALL_PASS, ulang bagian 1 ditolak, tidak berurutan ditolak", () => {
    expect(wf).toContain("--parts 3");
    expect(wf).toContain("qa/ci/supabase-standin.sql");
    expect(wf).toContain("15|O|1|1|3|t|t|t|1");
    expect(wf).toContain("QA2_RLS_RESULT ALL_PASS | fails=0");
    expect(wf).toContain("ABORT: schema public tidak kosong");
    expect(wf).toContain("ABORT: bagian sebelumnya belum diterapkan");
    expect(wf).not.toMatch(/supabase\.co|pooler\.supabase|\bcurl\b|\bwget\b/);
  });
  it("stand-in tidak membuat tabel di schema public dan tidak memuat ref nyata", () => {
    const sql = read("qa/ci/supabase-standin.sql");
    expect(sql).not.toMatch(/create\s+table\s+(if\s+not\s+exists\s+)?public\./i);
    for (const r of REAL_REFS) expect(sql.includes(r)).toBe(false);
    expect(sql).toContain("auth.users");
    expect(sql).toContain("storage.foldername");
  });
});
