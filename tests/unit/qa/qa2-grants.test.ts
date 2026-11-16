// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
// QA-2: mode diagnose (baca-saja) dan bagian ke-4 grant minimal (qa/qa2-grants.sql).
// Semua psql PALSU (di memori): tanpa koneksi database/jaringan. Tipe sengaja longgar (pelajaran #153: .mjs bertipe JSDoc sempit).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as applyMod from "../../../scripts/qa/apply-schema-bundle.mjs";
import * as aclMod from "../../../scripts/qa/qa-acl-requirements.mjs";

const m = applyMod as any;
const acl = aclMod as any;
const root = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
const stripComments = (s: string) => s.replace(/--[^\n]*/g, "");

const QA_REF = "gasdqsadnjoknisloaec";
const PW = "s3cretPW-ZZ9";
const POOLER = `postgresql://postgres.${QA_REF}:${PW}@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`;
const BUNDLE_PHRASE = "APPROVE QA-2-SCHEMA-BUNDLE";
const GRANTS_PHRASE = "APPROVE QA-2-SCHEMA-GRANTS";
const BAD_VERIFY = "15|O|1|1|3|t|f|f|1"; // persis hasil run #4 (15 Nov 2026)
const GOOD_VERIFY = "15|O|1|1|3|t|t|t|1";

type Grant = { role: string; table: string; privs: string[] };
/** Penguraian sederhana "grant <privs> on [table] public.x[, public.y] to <role>[, role];" (tanpa kolom, tanpa fungsi/schema). */
function parseGrants(sql: string): Grant[] {
  const out: Grant[] = [];
  for (const mt of stripComments(sql).matchAll(/\bgrant\s+([a-z, ]+?)\s+on\s+(?:table\s+)?([a-z0-9_., ]+?)\s+to\s+([a-z_, ]+?)\s*;/gi)) {
    const privs = mt[1].split(",").map((x) => x.trim().toLowerCase());
    const tables = mt[2].split(",").map((x) => x.trim().replace(/^public\./, ""));
    const roles = mt[3].split(",").map((x) => x.trim());
    for (const role of roles) for (const table of tables) out.push({ role, table, privs });
  }
  return out;
}

const grantsSql = read("qa/qa2-grants.sql");
const shimSql = read("qa/qa2-shim.sql");
const grants = parseGrants(grantsSql);

describe("qa/qa2-grants.sql: statis (least privilege)", () => {
  const code = stripComments(grantsSql);

  it("hanya grant ke authenticated dan service_role; tanpa GRANT ALL, default privileges, anon/public, grant option", () => {
    expect(grants.length).toBeGreaterThan(8);
    for (const g of grants) expect(["authenticated", "service_role"], JSON.stringify(g)).toContain(g.role);
    for (const g of grants) expect(g.privs, JSON.stringify(g)).not.toContain("all");
    for (const re of m.GRANTS_FORBIDDEN as RegExp[]) expect(re.test(code), String(re)).toBe(false);
    expect(code).not.toMatch(/\bgrant\s+all\b/i);
    expect(code).not.toMatch(/default\s+privileges/i);
    expect(code).not.toMatch(/\bto\s+(anon|public)\b/i);
    expect(code).not.toMatch(/with\s+grant\s+option/i);
    expect(code).not.toMatch(/\btruncate\b|\breferences\b|\btrigger\b/i);
  });

  it("authenticated TIDAK mendapat UPDATE/DELETE pada prompter_subscriptions; hanya SELECT+INSERT", () => {
    const subs = grants.filter((g) => g.role === "authenticated" && g.table === "prompter_subscriptions");
    expect(subs.length).toBeGreaterThan(0);
    const privs = new Set(subs.flatMap((g) => g.privs));
    expect([...privs].sort()).toEqual(["insert", "select"]);
    expect(privs.has("update")).toBe(false);
    expect(privs.has("delete")).toBe(false);
  });

  it("RLS tidak disentuh: tanpa ALTER TABLE/POLICY, ENABLE/DISABLE/FORCE ROW LEVEL SECURITY", () => {
    expect(code).not.toMatch(/\balter\s+(table|policy)\b|\b(create|drop)\s+policy\b/i);
    expect(code).not.toMatch(/row\s+level\s+security/i);
    expect(code).not.toMatch(/\bsecurity\s+definer\b|\bcreate\s+(or\s+replace\s+)?function\b/i);
  });

  it("idempotent dan tidak mengulang migrasi: hanya GRANT/guard; tanpa INSERT/CREATE/DROP; pelacak versi tidak disentuh", () => {
    expect(code).not.toMatch(/\binsert\s+into\b|\bcreate\b|\bdrop\b|\bupdate\s+\w+\s+set\b|\bdelete\s+from\b/i);
    expect(code).not.toMatch(/_linoe_sandbox_applied\s*\(/);
    expect((code.match(/\bbegin;/gi) ?? []).length).toBe(1);
    expect((code.match(/\bcommit;/gi) ?? []).length).toBe(1);
    expect(code).toContain("QA2_SANDBOX_ONLY");
    expect(code).toMatch(/count\(\*\) from public\._linoe_sandbox_applied\) <> 15/);
    expect(/^\s*\\/m.test(grantsSql)).toBe(false);
  });

  it("memuat peringatan proyek QA dan frasa persetujuan; tidak memuat ref proyek nyata", () => {
    expect(grantsSql).toContain("HANYA UNTUK PROYEK QA gasdqsadnjoknisloaec");
    expect(grantsSql).toContain("APPROVE QA-2-SCHEMA-GRANTS");
    for (const ref of ["wjjyqovhmwenb" + "cvbnkgx", "bmwpykwoylmz" + "rbmbdeqw", "kczslidqkhss" + "dwefkais", "eskqngzhtndk" + "fqjoxxou"]) expect(grantsSql).not.toContain(ref);
  });
});

describe("kebutuhan ACL: daftar tunggal, Q_VERIFY, dan berkas grants konsisten", () => {
  const key = (r: any) => `${r.kind}|${r.role}|${r.object}|${r.priv}`;

  it("himpunan has_*_privilege di Q_VERIFY sama persis dengan ACL_REQUIREMENTS", () => {
    const fromVerify = new Set<string>();
    for (const mt of (m.Q_VERIFY as string).matchAll(/has_(table|function)_privilege\('([a-z_]+)', '([^']+)', '([a-z]+)'\)/g)) {
      fromVerify.add(`${mt[1]}|${mt[2]}|${mt[3]}|${mt[4]}`);
    }
    const fromList = new Set((acl.ACL_REQUIREMENTS as any[]).map(key));
    expect([...fromVerify].sort()).toEqual([...fromList].sort());
  });

  it("indikator di daftar = indikator Q_VERIFY (authenticated_access, service_role_access, app_table_grants)", () => {
    const inds = new Set((acl.ACL_REQUIREMENTS as any[]).map((r) => r.indicator));
    expect([...inds].sort()).toEqual(["app_table_grants", "authenticated_access", "service_role_access"]);
    for (const n of m.GRANT_FIXABLE_INDICATORS) expect(inds.has(n)).toBe(true);
    expect(m.GRANT_FIXABLE_INDICATORS).not.toContain("authenticated_access");
  });

  it("setiap sub-syarat tabel (dan kebutuhan kode reset) dipenuhi shim ATAU qa2-grants.sql; fungsi dipenuhi shim", () => {
    const have = new Set<string>();
    for (const g of [...parseGrants(shimSql), ...grants]) for (const p of g.privs) have.add(`table|${g.role}|public.${g.table}|${p}`);
    for (const r of [...acl.ACL_REQUIREMENTS, ...acl.ACL_APP_NEEDS] as any[]) {
      if (r.kind === "table") expect(have.has(key(r)), key(r)).toBe(true);
      else expect(shimSql, key(r)).toContain(`grant execute on function ${r.object} to ${r.role}`);
    }
  });

  it("privilege terlarang tidak diberikan oleh shim maupun grants", () => {
    const given = new Set<string>();
    for (const g of [...parseGrants(shimSql), ...grants]) for (const p of g.privs) given.add(`table|${g.role}|public.${g.table}|${p}`);
    for (const r of acl.ACL_FORBIDDEN as any[]) expect(given.has(key(r)), key(r)).toBe(false);
  });

  it("kueri diagnosis lolos assertReadOnly dan memuat setiap sub-syarat", () => {
    const q = acl.buildAclQuery() as string;
    expect(() => m.assertReadOnly(q)).not.toThrow();
    for (const r of [...acl.ACL_REQUIREMENTS, ...acl.ACL_APP_NEEDS, ...acl.ACL_FORBIDDEN] as any[]) expect(q).toContain(`'${r.object}', '${r.priv}'`);
    for (const x of [acl.Q_DIAG_RELACL, acl.Q_DIAG_DEFACL, acl.Q_DIAG_ROLES]) expect(() => m.assertReadOnly(x)).not.toThrow();
    expect(() => acl.buildAclQuery([{ indicator: "x", kind: "table", role: "r", object: "public.t'; drop table t; --", priv: "select" }])).toThrow();
  });
});

// ---------------------------------------------------------------------------
// psql palsu
const built = (m.buildParts as (r: string) => any)(root);
const fullApplied: string[] = built.parts.flatMap((p: any) => p.versions.map((v: any) => `${v.version}:${v.sha256}`));
const ACL_Q: string = acl.buildAclQuery();

type Opts = { verify?: string; grantsFail?: boolean; marker?: boolean; applied?: string[]; leak?: boolean };
function fakeDb(o: Opts = {}) {
  const st = { granted: false, calls: [] as { input: string }[] };
  const marker = o.marker ?? true;
  const applied = o.applied ?? fullApplied;
  const spawn = (_cmd: string, _args: string[], x: { input: string }) => {
    st.calls.push({ input: x.input });
    const leak = o.leak ? `FATAL: password authentication failed for ${PW} ${POOLER}\n` : "";
    if (x.input === m.Q_STATE) return { status: 0, stdout: `postgres|${marker ? 35 : 0}|${marker ? "t" : "f"}|${marker ? "t" : "f"}|0\n`, stderr: "" };
    if (x.input === m.Q_MARKER) return { status: 0, stdout: "1\n", stderr: "" };
    if (x.input === m.Q_APPLIED) return { status: 0, stdout: applied.join("\n") + "\n", stderr: "" };
    if (x.input === m.Q_VERIFY) return { status: 0, stdout: (st.granted ? GOOD_VERIFY : (o.verify ?? BAD_VERIFY)) + "\n", stderr: "" };
    if (x.input === ACL_Q) {
      const rows = ([...acl.ACL_REQUIREMENTS, ...acl.ACL_APP_NEEDS, ...acl.ACL_FORBIDDEN] as any[]).map((r) => {
        const forbidden = r.indicator === "terlarang";
        const fromShim = r.role === "authenticated" && r.priv === "select" && ["public.tenants", "public.user_profiles"].includes(r.object);
        const fn = r.kind === "function";
        const ok = forbidden ? "f" : st.granted || fromShim || fn || r.object === "public.tenants" || r.object === "public.user_profiles" ? (r.priv === "delete" && r.object === "public.tenants" && !st.granted ? "f" : "t") : "f";
        return `acl|${r.indicator}|${r.role}|${r.object}|${r.priv}|${ok}`;
      });
      return { status: 0, stdout: rows.join("\n") + "\n", stderr: "" };
    }
    if (x.input === acl.Q_DIAG_RELACL) return { status: 0, stdout: "relacl|prompter_subscriptions|owner=postgres|rls=true|NULL\n", stderr: "" };
    if (x.input === acl.Q_DIAG_DEFACL) return { status: 0, stdout: "", stderr: "" };
    if (x.input === acl.Q_DIAG_ROLES) return { status: 0, stdout: "role|authenticated|bypassrls=false|super=false|schema_usage=true\n", stderr: "" };
    if (x.input === grantsSql) {
      if (o.grantsFail) return { status: 3, stdout: "", stderr: `${leak}psql:<stdin>:20: ERROR:  boom\n` };
      st.granted = true;
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "SQL tak dikenal\n" };
  };
  return { spawn, st };
}

async function go(env: Record<string, string | undefined>, o: Opts = {}, extra: any = {}) {
  const db = fakeDb(o);
  const out: string[] = [];
  const summaries: string[] = [];
  const r = await (m.runApply as (d: any) => Promise<any>)({
    env: { PATH: "/usr/bin", QA_DB_URL: POOLER, ...env },
    spawn: db.spawn,
    log: (l: string) => out.push(l),
    writeSummary: (t: string) => summaries.push(t),
    ...extra,
  });
  return { r, db, out, summaries };
}
const sent = (db: { st: { calls: { input: string }[] } }) => db.st.calls.map((c) => c.input);

describe("mode diagnose (baca-saja)", () => {
  it("menampilkan tiap sub-syarat yang gagal, exit 0, dan hanya mengirim SELECT", async () => {
    const { r, db, out, summaries } = await go({ QA_APPLY_MODE: "diagnose" });
    expect(r.exitCode).toBe(0);
    expect(r.verdict).toContain("sub-syarat ACL salah");
    const text = out.join("\n");
    expect(text).toContain("SALAH service_role_access: service_role SELECT public.prompter_subscriptions = f");
    expect(text).toContain("SALAH app_table_grants: authenticated INSERT public.prompter_brand_profiles = f");
    expect(text).toContain("SALAH app_table_grants: authenticated SELECT public.prompter_analytics_insights = f");
    expect(text).toContain("SALAH kode_reset_identitas: service_role DELETE public.tenants = f");
    expect(text).toContain("OK    authenticated_access: authenticated SELECT public.tenants = t");
    expect(text).toContain("ACL RELASI:");
    expect(text).toContain("DEFAULT PRIVILEGES:");
    expect(text).toContain("(tidak ada baris)");
    expect(summaries.join("\n")).toContain("Sub-syarat yang salah:");
    for (const sql of sent(db)) {
      expect(sql.trim().toLowerCase().startsWith("select ")).toBe(true);
      expect(() => m.assertReadOnly(sql)).not.toThrow();
    }
    expect(sent(db)).not.toContain(grantsSql);
  });

  it("setelah grants: semua sub-syarat terpenuhi; privilege terlarang tidak dilaporkan salah", async () => {
    const db = fakeDb();
    db.st.granted = true;
    const out: string[] = [];
    const r = await m.runApply({ env: { PATH: "/usr/bin", QA_DB_URL: POOLER, QA_APPLY_MODE: "diagnose" }, spawn: db.spawn, log: (l: string) => out.push(l), writeSummary: () => {} });
    expect(r.exitCode).toBe(0);
    expect(r.verdict).toContain("semua sub-syarat ACL terpenuhi");
    expect(out.join("\n")).not.toContain("SALAH ");
  });

  it("memberi tanda SALAH bila privilege terlarang ada (authenticated UPDATE langganan = t)", async () => {
    const db = fakeDb();
    const real = db.spawn;
    const out: string[] = [];
    const spawn = (c: string, a: string[], x: { input: string }) => {
      const res = real(c, a, x);
      if (x.input === ACL_Q) return { ...res, stdout: res.stdout.replace("acl|terlarang|authenticated|public.prompter_subscriptions|update|f", "acl|terlarang|authenticated|public.prompter_subscriptions|update|t") };
      return res;
    };
    const r = await m.runApply({ env: { PATH: "/usr/bin", QA_DB_URL: POOLER, QA_APPLY_MODE: "diagnose" }, spawn, log: (l: string) => out.push(l), writeSummary: () => {} });
    expect(out.join("\n")).toContain("SALAH terlarang: authenticated UPDATE public.prompter_subscriptions = t (harapan: tidak ada)");
    expect(r.verdict).toContain("sub-syarat ACL salah");
  });

  it("password/URL tidak muncul di keluaran saat kueri gagal; exit 1", async () => {
    const db = fakeDb({ leak: true });
    const real = db.spawn;
    const out: string[] = [];
    const summaries: string[] = [];
    const spawn = (c: string, a: string[], x: { input: string }) => (x.input === ACL_Q ? { status: 2, stdout: "", stderr: `FATAL: password authentication failed for ${PW} ${POOLER}\n` } : real(c, a, x));
    const r = await m.runApply({ env: { PATH: "/usr/bin", QA_DB_URL: POOLER, QA_APPLY_MODE: "diagnose" }, spawn, log: (l: string) => out.push(l), writeSummary: (t: string) => summaries.push(t) });
    expect(r.exitCode).toBe(1);
    const all = out.join("\n") + summaries.join("\n");
    expect(all.includes(PW)).toBe(false);
    expect(all.includes("postgresql://")).toBe(false);
  });
});

describe("mode grants (butuh APPROVE QA-2-SCHEMA-GRANTS)", () => {
  it("ditolak (exit 2, tanpa koneksi) tanpa frasa, dengan frasa bundel, atau variasi", async () => {
    for (const v of [undefined, "", BUNDLE_PHRASE, "approve qa-2-schema-grants", `${GRANTS_PHRASE} `, "APPROVE QA-2-GRANTS", "APPROVED QA-2-SCHEMA-GRANTS"]) {
      const { r, db } = await go({ QA_APPLY_MODE: "grants", QA_APPLY_CONFIRM: v });
      expect(r.exitCode, String(v)).toBe(2);
      expect(db.st.calls).toHaveLength(0);
    }
  });

  it("frasa grants tidak membuka mode apply (non-transferable)", async () => {
    const { r, db } = await go({ QA_APPLY_MODE: "apply", QA_APPLY_CONFIRM: GRANTS_PHRASE });
    expect(r.exitCode).toBe(2);
    expect(db.st.calls).toHaveLength(0);
  });

  it("verifikasi gagal HANYA di service_role_access/app_table_grants: menerapkan berkas grants lalu verifikasi ulang PASS", async () => {
    const { r, db, out } = await go({ QA_APPLY_MODE: "grants", QA_APPLY_CONFIRM: GRANTS_PHRASE });
    expect(r.exitCode).toBe(0);
    expect(r.verdict).toBe("GRANTS PASS");
    const s = sent(db);
    expect(s.filter((x) => x === grantsSql)).toHaveLength(1);
    expect(s.some((x) => built.parts.some((p: any) => p.text === x))).toBe(false); // tidak mengulang migrasi
    expect(s.indexOf(grantsSql)).toBeGreaterThan(s.indexOf(m.Q_VERIFY));
    expect(out.join("\n")).toContain("VERIFIKASI SETELAH GRANTS: PASS");
  });

  it("idempotensi: bila sudah terverifikasi tidak menulis apa pun (exit 0)", async () => {
    const { r, db } = await go({ QA_APPLY_MODE: "grants", QA_APPLY_CONFIRM: GRANTS_PHRASE }, { verify: GOOD_VERIFY });
    expect(r.exitCode).toBe(0);
    expect(r.verdict).toContain("tidak diperlukan");
    expect(sent(db)).not.toContain(grantsSql);
  });

  it("ditolak (exit 2, tidak menulis) bila ada indikator LAIN yang salah", async () => {
    for (const v of ["14|O|1|1|3|t|f|f|1", "15|D|1|1|3|t|f|f|1", "15|O|1|1|3|f|f|f|1", "15|O|1|1|3|t|f|f|0"]) {
      const { r, db } = await go({ QA_APPLY_MODE: "grants", QA_APPLY_CONFIRM: GRANTS_PHRASE }, { verify: v });
      expect(r.exitCode, v).toBe(2);
      expect(sent(db)).not.toContain(grantsSql);
    }
  });

  it("ditolak (exit 2) pada proyek kosong, sebagian terpasang, atau tak dikenal", async () => {
    const empty = await go({ QA_APPLY_MODE: "grants", QA_APPLY_CONFIRM: GRANTS_PHRASE }, { marker: false });
    expect(empty.r.exitCode).toBe(2);
    expect(sent(empty.db)).not.toContain(grantsSql);
    const partial = await go({ QA_APPLY_MODE: "grants", QA_APPLY_CONFIRM: GRANTS_PHRASE }, { applied: fullApplied.slice(0, built.parts[0].versions.length) });
    expect(partial.r.exitCode).toBe(2);
    expect(sent(partial.db)).not.toContain(grantsSql);
  });

  it("kegagalan SQL grants: exit 1, tidak ada klaim sukses, rahasia tidak bocor", async () => {
    const { r, out, summaries } = await go({ QA_APPLY_MODE: "grants", QA_APPLY_CONFIRM: GRANTS_PHRASE }, { grantsFail: true, leak: true });
    expect(r.exitCode).toBe(1);
    expect(r.verdict).toContain("GAGAL");
    const all = out.join("\n") + summaries.join("\n");
    expect(all.includes(PW)).toBe(false);
    expect(all.includes("postgresql://")).toBe(false);
    expect(all).not.toContain("GRANTS PASS");
  });

  it("berkas grants berbahaya ditolak lapis kedua (GRANT ALL, default privileges, anon, UPDATE langganan, RLS) sebelum dikirim", async () => {
    const evil = [
      "begin; grant all on public.prompter_subscriptions to authenticated; commit;",
      "begin; alter default privileges in schema public grant select on tables to anon; commit;",
      "begin; grant select on public.tenants to anon; commit;",
      "begin; grant update on public.prompter_subscriptions to authenticated; commit;",
      "begin; grant delete on public.prompter_subscriptions to authenticated; commit;",
      "begin; alter table public.tenants disable row level security; commit;",
      "begin; drop policy x on public.tenants; commit;",
      "begin; grant select on public.tenants to authenticated with grant option; commit;",
      "\\i /etc/passwd",
    ];
    for (const sql of evil) {
      const { r, db } = await go({ QA_APPLY_MODE: "grants", QA_APPLY_CONFIRM: GRANTS_PHRASE }, {}, { readFile: () => sql });
      expect(r.exitCode, sql).toBe(2);
      expect(sent(db)).not.toContain(sql);
    }
  });
});

describe("workflow dan skrip: tidak ada jalur lain", () => {
  const wfRaw = read(".github/workflows/qa-schema-apply.yml");
  const wf = wfRaw.replace(/^\s*#.*$/gm, "").replace(/\s#\s.*$/gm, "");

  it("mode diagnose dan grants tersedia; grants memeriksa frasa persis di langkah tanpa secret; apply tetap pada frasa bundel", () => {
    expect(wf).toMatch(/options:\s*\n\s+- check\s*\n\s+- apply\s*\n\s+- rls-test\s*\n\s+- diagnose\s*\n\s+- grants/);
    expect(wf).toContain('[ "$QA_APPLY_CONFIRM" != "APPROVE QA-2-SCHEMA-GRANTS" ]');
    expect(wf).toContain('[ "$QA_APPLY_CONFIRM" != "APPROVE QA-2-SCHEMA-BUNDLE" ]');
    expect(wf).toMatch(/check\|rls-test\|diagnose\) ;;/);
    expect(wf.match(/secrets\.[A-Za-z0-9_]+/g)).toEqual(["secrets.QA_DB_URL"]);
    expect(wf).not.toMatch(/QA2_ENABLED|QA2_ACTIVATED/);
  });

  it("skrip: frasa grants dan berkas grants diekspor; mode diagnose/grants tidak memakai jaringan atau drop", () => {
    expect(m.GRANTS_PHRASE).toBe(GRANTS_PHRASE);
    expect(m.GRANTS_FILE).toBe("qa/qa2-grants.sql");
    expect(m.MODES).toEqual(["check", "apply", "rls-test", "diagnose", "grants"]);
    const code = read("scripts/qa/apply-schema-bundle.mjs").replace(/\/\/[^\n]*/g, "") + read("scripts/qa/qa-acl-requirements.mjs").replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/\bfetch\(|node:https?|node:net/);
    expect(code).not.toMatch(/drop\s+(schema|database|table)|truncate\s+|reset\s+database/i);
  });

  it("CI: job strict meniru proyek nyata (tanpa default privileges) dan memeriksa idempotensi, least privilege, RLS", () => {
    const ci = read(".github/workflows/qa2-schema-bundle-test.yml");
    expect(ci).toContain("grants-on-strict-postgres");
    expect(ci).toContain("15|O|1|1|3|t|f|f|1");
    expect(ci).toContain("15|O|1|1|3|t|t|t|1");
    expect(ci).toContain("Idempotensi");
    expect(ci).toContain("scripts/qa/qa-acl-requirements.mjs");
    expect(ci).not.toMatch(/secrets\./);
  });
});
