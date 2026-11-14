import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPROVAL_PHRASE,
  REAL_REFS,
  REDACTED,
  WARNING_LINE,
  buildBundle,
  loadManifest,
} from "../../../scripts/qa/build-schema-bundle.mjs";
import { QA_IDENTITY_EMAIL, buildResetSql } from "../../../scripts/qa/print-qa-reset-sql.mjs";
import { QA_EMAIL } from "../../../scripts/qa/local-stack-guard.mjs";
import { ALLOWED_QA_PROJECT_REFS } from "../../../scripts/qa/qa-project-allowlist.mjs";

// QA-2: manifest skema minimum + pembangun bundel. Tidak ada koneksi DB/jaringan; hanya membaca berkas repo.
const root = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
// Ref produksi ditulis dari potongan agar literal utuh tidak muncul di berkas tes ini.
const PROD_REF = ["wjjyqovhmwenb", "cvbnkgx"].join("");
const QA_REF = "gasdqsadnjoknisloaec";

const manifest = loadManifest(root) as {
  shim: { file: string; fidelityRisk: string }[];
  migrations: string[];
  migrationNotes: Record<string, string>;
  excluded: { file: string; group: string; reason: string }[];
  targetProject: { ref: string };
  approvalPhrase: string;
  forbidden: { projectNames: string[]; sqlPatterns: { name: string; regex: string }[] };
};
const allMigrations = readdirSync(path.join(root, "supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort();

describe("QA-2 manifest skema minimum", () => {
  it("semua berkas shim dan migrasi di manifest ada", () => {
    expect(manifest.shim.length).toBeGreaterThan(0);
    for (const s of manifest.shim) expect(existsSync(path.join(root, s.file)), s.file).toBe(true);
    expect(manifest.migrations.length).toBeGreaterThan(0);
    for (const m of manifest.migrations) expect(existsSync(path.join(root, "supabase/migrations", m)), m).toBe(true);
  });

  it("urutan migrasi naik ketat sesuai nama, tanpa duplikat", () => {
    const sorted = [...manifest.migrations].sort();
    expect(manifest.migrations).toEqual(sorted);
    expect(new Set(manifest.migrations).size).toBe(manifest.migrations.length);
  });

  it("migrasi + excluded = semua migrasi repo, tanpa tumpang tindih (tidak ada migrasi baru yang luput dikaji)", () => {
    const excluded = manifest.excluded.map((e) => e.file);
    expect(manifest.migrations.filter((m) => excluded.includes(m))).toEqual([]);
    expect([...manifest.migrations, ...excluded].sort()).toEqual(allMigrations);
    for (const e of manifest.excluded) {
      expect(e.group.length, e.file).toBeGreaterThan(0);
      expect(e.reason.length, e.file).toBeGreaterThan(10);
    }
    expect(Object.keys(manifest.migrationNotes).sort()).toEqual(manifest.migrations);
  });

  it("migrasi yang dikecualikan mencakup iklan, finance/admin, dan DOKU/pembayaran", () => {
    const groups = new Set(manifest.excluded.map((e) => e.group));
    for (const g of ["iklan", "finance-admin", "pembayaran"]) expect(groups.has(g), g).toBe(true);
    const names = manifest.excluded.map((e) => e.file).join("\n");
    expect(names).toMatch(/linoe_finance_foundation/);
    expect(names).toMatch(/p0_3_doku_alert_coverage/);
    expect(names).toMatch(/manual_ad_metrics/);
  });

  it("migrasi inti alur trial 14 hari ikut: guard trial, kolom langganan, entitlement", () => {
    const m = manifest.migrations.join("\n");
    for (const needle of [
      "prompter_foundation_schema",
      "prompter_billing_foundation",
      "prompter_b9_entitlement_enforcement",
      "prompter_b10_payment_billing_core",
      "prompter_p0_subscription_trial_insert_guard",
    ]) {
      expect(m, needle).toContain(needle);
    }
  });

  it("shim ditandai risiko fidelitas dan target = proyek QA yang diizinkan", () => {
    for (const s of manifest.shim) expect(s.fidelityRisk).toBe("HIGH");
    expect(manifest.targetProject.ref).toBe(QA_REF);
    expect(manifest.approvalPhrase).toBe("APPROVE QA-2-SCHEMA-BUNDLE");
    expect(manifest.forbidden.projectNames).toContain("umkmpro-ai");
  });

  it("tidak ada migrasi minimum yang cocok pola terlarang (drop table, alter tenants, pg_cron, dll.)", () => {
    for (const m of manifest.migrations) {
      const code = read(`supabase/migrations/${m}`).replace(/--[^\n]*/g, "");
      for (const p of manifest.forbidden.sqlPatterns) expect(new RegExp(p.regex, "i").test(code), `${m}: ${p.name}`).toBe(false);
    }
  });
});

describe("QA-2 tidak ada ref proyek nyata/produksi", () => {
  it("daftar REAL_REFS di pembangun cocok dengan daftar blokir local-stack-guard (anti salah ketik)", () => {
    const guard = read("scripts/qa/local-stack-guard.mjs");
    expect(REAL_REFS.length).toBe(4);
    for (const r of REAL_REFS) expect(guard.includes(r), r).toBe(true);
    expect(REAL_REFS).toContain(PROD_REF);
  });

  it("manifest, dokumen, shim, dan bundel bersih dari semua ref nyata", () => {
    const { sql } = buildBundle({ root });
    const texts: Record<string, string> = {
      manifest: read("qa/qa2-schema-manifest.json"),
      doc: read("docs/QA2_SCHEMA_MINIMUM.md"),
      shim: read("qa/qa2-shim.sql"),
      bundle: sql,
    };
    for (const [label, text] of Object.entries(texts)) {
      expect(text.includes(PROD_REF), `${label}: ref produksi`).toBe(false);
      for (const r of REAL_REFS) expect(text.includes(r), `${label}: ${r.slice(0, 4)}...`).toBe(false);
    }
  });

  it("penyamaran hanya mengubah komentar: SQL migrasi di bundel identik dengan sumber", () => {
    const { sql } = buildBundle({ root });
    for (const m of manifest.migrations) {
      const original = read(`supabase/migrations/${m}`).split(PROD_REF).join(REDACTED).replace(/\s+$/, "");
      expect(sql.includes(original), m).toBe(true);
    }
  });
});

describe("QA-2 skrip pembangun: murni, tanpa jaringan/DB", () => {
  const source = read("scripts/qa/build-schema-bundle.mjs");
  const specifiers = [...source.matchAll(/(?:^|\n)\s*import[^"'\n]*?from\s+["']([^"']+)["']/g)].map((m) => m[1]);

  it("hanya mengimpor modul bawaan node non-jaringan", () => {
    expect(specifiers.sort()).toEqual(["node:crypto", "node:fs", "node:path", "node:url"]);
  });

  it("tidak memakai modul jaringan/DB, fetch, require, atau import dinamis", () => {
    const banned = /\b(node:)?(http|https|http2|net|tls|dns|dgram|child_process|worker_threads|cluster|inspector)\b["']/;
    expect(banned.test(source)).toBe(false);
    for (const word of ["fetch(", "XMLHttpRequest", "WebSocket", "require(", "import(", "@supabase", "postgres", "psql", "process.env", "undici", "axios"]) {
      expect(source.includes(word), word).toBe(false);
    }
  });
});

describe("QA-2 bundel", () => {
  const built = buildBundle({ root });

  it("memuat header peringatan di bagian paling atas dan frasa persetujuan", () => {
    const head = built.sql.split("\n").slice(0, 12).join("\n");
    expect(head).toContain(WARNING_LINE);
    expect(WARNING_LINE).toBe(`HANYA UNTUK PROYEK QA ${QA_REF}`);
    expect(head).toContain(APPROVAL_PHRASE);
    expect(head).toMatch(/BUKAN di umkmpro-ai/);
  });

  it("satu transaksi: begin sebelum shim, commit setelah migrasi terakhir", () => {
    const lines = built.sql.split("\n");
    const begin = lines.indexOf("begin;");
    const commit = lines.indexOf("commit;");
    expect(begin).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(begin);
    expect(built.sql.indexOf("ABORT: schema public tidak kosong")).toBeGreaterThan(begin);
    expect(built.sql.indexOf("ABORT: schema public tidak kosong")).toBeLessThan(built.sql.indexOf("-- ---- [2/"));
  });

  it("memuat shim dulu lalu semua migrasi manifest sesuai urutan", () => {
    expect(built.migrations).toEqual(manifest.migrations);
    let last = built.sql.indexOf("SHIM qa/qa2-shim.sql");
    expect(last).toBeGreaterThan(-1);
    for (const m of manifest.migrations) {
      const at = built.sql.indexOf(`MIGRASI ${m} ----`);
      expect(at, m).toBeGreaterThan(last);
      last = at;
    }
  });

  it("deterministik: dua kali bangun hasilnya sama", () => {
    expect(buildBundle({ root }).sql).toBe(built.sql);
  });

  it("menolak (fail-closed) bila berkas manifest hilang atau ada pola terlarang", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "qa2-bundle-test-"));
    try {
      mkdirSync(path.join(tmp, "qa"), { recursive: true });
      mkdirSync(path.join(tmp, "supabase/migrations"), { recursive: true });
      cpSync(path.join(root, "qa/qa2-shim.sql"), path.join(tmp, "qa/qa2-shim.sql"));
      cpSync(path.join(root, "qa/qa2-schema-manifest.json"), path.join(tmp, "qa/qa2-schema-manifest.json"));
      for (const m of manifest.migrations) cpSync(path.join(root, "supabase/migrations", m), path.join(tmp, "supabase/migrations", m));
      expect(() => buildBundle({ root: tmp })).not.toThrow();

      const victim = path.join(tmp, "supabase/migrations", manifest.migrations[3]);
      const original = readFileSync(victim, "utf8");
      writeFileSync(victim, `${original}\ndrop table public.prompter_products;\n`);
      expect(() => buildBundle({ root: tmp })).toThrow(/REFUSED.*pola terlarang/);

      writeFileSync(victim, `${original}\nselect '${PROD_REF}';\n`);
      expect(() => buildBundle({ root: tmp })).toThrow(/REFUSED.*ref proyek nyata/);

      rmSync(victim);
      expect(() => buildBundle({ root: tmp })).toThrow(/REFUSED.*hilang/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("QA-2 bundel dibagi (--parts) untuk tempel dari HP", () => {
  const whole = buildBundle({ root });
  for (const n of [2, 3]) {
    const split = buildBundle({ root, parts: n });

    it(`--parts ${n}: ${n} potongan, tiap potongan < 100 KB, header peringatan di setiap potongan`, () => {
      expect(split.parts.length).toBe(n);
      for (const [i, text] of split.parts.entries()) {
        expect(Buffer.byteLength(text, "utf8"), `bagian ${i + 1}`).toBeLessThan(100 * 1024);
        expect(text.split("\n").slice(0, 3).join("\n")).toContain(WARNING_LINE);
        expect(text).toContain(`BAGIAN ${i + 1} DARI ${n}`);
        for (const r of REAL_REFS) expect(text.includes(r)).toBe(false);
      }
    });

    it(`--parts ${n}: urutan migrasi gabungan identik manifest, tanpa duplikat, tiap potongan atomik`, () => {
      const seen = split.parts.flatMap((t) => [...t.matchAll(/MIGRASI (\d{14}_[a-z0-9_]+\.sql) ----/g)].map((m) => m[1]));
      expect(seen).toEqual(manifest.migrations);
      for (const t of split.parts) {
        const lines = t.split("\n");
        expect(lines.filter((l) => l === "begin;").length).toBe(1);
        expect(lines.filter((l) => l === "commit;").length).toBe(1);
      }
    });

    it(`--parts ${n}: shim + guard proyek kosong hanya di potongan 1; potongan berikut punya guard urutan`, () => {
      expect(split.parts[0]).toContain("SHIM qa/qa2-shim.sql");
      expect(split.parts[0]).toContain("ABORT: schema public tidak kosong");
      for (const t of split.parts.slice(1)) {
        expect(t).not.toContain("SHIM qa/qa2-shim.sql");
        expect(t).toContain("ABORT: bagian sebelumnya belum diterapkan");
        expect(t).toContain("ABORT: bagian ini sudah diterapkan");
        expect(t.indexOf("do $order$")).toBeLessThan(t.indexOf("\nbegin;"));
      }
      // guard potongan k merujuk versi terakhir potongan k-1
      for (let i = 1; i < n; i++) {
        const prevLast = [...split.parts[i - 1].matchAll(/^\s+\('(\d{14})', '[0-9a-f]{64}'\)/gm)].map((m) => m[1]).pop();
        expect(split.parts[i]).toContain(`version = '${prevLast}'`);
      }
    });

    it(`--parts ${n}: verifikasi baca-saja hanya di potongan terakhir`, () => {
      split.parts.forEach((t, i) => expect(t.includes("as authenticated_access"), `bagian ${i + 1}`).toBe(i === n - 1));
    });
  }

  it("--parts 1 sama dengan bundel utuh; parts melebihi jumlah migrasi ditolak", () => {
    expect(buildBundle({ root, parts: 1 }).parts).toEqual([whole.sql]);
    expect(() => buildBundle({ root, parts: 99 })).toThrow(/REFUSED/);
  });

  it("bundel utuh > 100 KB sehingga saran dibagi berlaku", () => {
    expect(whole.bytes).toBeGreaterThan(100 * 1024);
  });
});

describe("QA-2 audit fidelitas: koreksi shim terbukti dari kode", () => {
  const shim = read("qa/qa2-shim.sql");
  const extra = shim.slice(shim.indexOf("TAMBAHAN KHUSUS QA-2: GRANT"), shim.indexOf("TAMBAHAN KHUSUS QA-2: RESET"));

  it("grant minimal hanya untuk authenticated: SELECT tenants/user_profiles, EXECUTE fn_current_*; tanpa anon/tulis", () => {
    expect(extra).toContain("grant select on public.tenants, public.user_profiles to authenticated;");
    expect(extra).toContain("grant execute on function public.fn_current_tenant_id() to authenticated;");
    expect(extra).toContain("grant execute on function public.fn_current_role() to authenticated;");
    const code = extra.replace(/--[^\n]*/g, "");
    expect(/\banon\b|\b(insert|update|delete|all)\b/i.test(code)).toBe(false);
    // service_role hanya SELECT pada tenants/user_profiles (admin client QA), tidak ada grant lain.
    expect([...code.matchAll(/to service_role/g)].length).toBe(1);
    expect(code).toContain("grant select on public.tenants, public.user_profiles to service_role;");
  });

  it("kode benar-benar memakai objek itu lewat sesi pengguna (dasar grant)", () => {
    expect(read("services/session.ts")).toMatch(/from\("user_profiles"\)[\s\S]*select\("nama, role, tenant_id"\)/);
    expect(read("services/session.ts")).toMatch(/from\("tenants"\)[\s\S]*select\("nama_usaha"\)/);
    expect(read("features/onboarding/actions.ts")).toContain('rpc("fn_current_tenant_id")');
    expect(read("features/auth/actions.ts")).toMatch(/nama_usaha: namaUsaha/);
  });

  it("handle_new_user membaca kunci metadata yang dikirim signUp", () => {
    for (const key of ["nama", "nama_usaha", "jenis_usaha"]) expect(shim).toContain(`'${key}'`);
  });

  it("role shim mencakup semua nilai TenantRole di types/database.ts dan default pendaftar = owner", () => {
    const types = read("types/database.ts");
    const union = types.match(/export type TenantRole =([\s\S]*?);/)![1];
    for (const role of [...union.matchAll(/"([a-z_]+)"/g)].map((m) => m[1])) expect(shim, role).toContain(`'${role}'`);
    expect(shim).toMatch(/values \(new\.id, v_tenant, [\s\S]*?, 'owner'\)/);
  });

  it("verifikasi bundel memeriksa kebijakan shim dan akses authenticated", () => {
    expect(buildBundle({ root }).sql).toMatch(/as shim_policies/);
    expect(buildBundle({ root }).sql).toMatch(/as authenticated_access/);
  });
});

describe("QA-2 shim tidak menyimpang dari shim CI QA-1", () => {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const shim = read("qa/qa2-shim.sql");
  const doku = read("supabase/sandbox/doku/01_shim_shared_objects.sql");
  const sim = read("qa/supabase-local/sql/01_handle_new_user_simulation.sql");
  const grab = (text: string, re: RegExp) => (text.match(re) ?? []).map(norm);

  it("tabel, fungsi, dan policy tenants/user_profiles identik", () => {
    for (const re of [
      /create table public\.tenants \([\s\S]*?\n\);/g,
      /create table public\.user_profiles \([\s\S]*?\n\);/g,
      /create function public\.fn_current_(?:tenant_id|role)\(\)[\s\S]*?\$\$;/g,
      /create policy "[^"]+" on public\.(?:tenants|user_profiles)[\s\S]*?;/g,
    ]) {
      const a = grab(doku, re);
      expect(a.length).toBeGreaterThan(0);
      expect(grab(shim, re)).toEqual(a);
    }
  });

  it("handle_new_user dan trigger signup identik dengan simulasi QA-1", () => {
    for (const re of [/create or replace function public\.handle_new_user\(\)[\s\S]*?end \$\$;/g, /create trigger qa_on_auth_user_created[\s\S]*?;/g]) {
      const a = grab(sim, re);
      expect(a.length).toBe(1);
      expect(grab(shim, re)).toEqual(a);
    }
  });

  it("guard proyek kosong ada dan shim tidak memuat BEGIN/COMMIT sendiri", () => {
    expect(shim).toContain("auth.users tidak kosong");
    expect(shim).toContain("schema public tidak kosong");
    expect(/^\s*(begin|commit)\s*;/im.test(shim)).toBe(false);
  });
});

describe("QA-2 dokumen", () => {
  const doc = read("docs/QA2_SCHEMA_MINIMUM.md");

  it("memuat frasa persetujuan, header peringatan, rollback hapus-buat-ulang, dan cara HP", () => {
    expect(doc).toContain("APPROVE QA-2-SCHEMA-BUNDLE");
    expect(doc).toContain(WARNING_LINE);
    expect(doc).toMatch(/hapus.*buat ulang/i);
    expect(doc).toMatch(/SQL Editor/);
    expect(doc).toMatch(/build-schema-bundle\.mjs/);
  });

  it("memuat bagian Audit fidelitas dengan risiko P0/P1/P2 dan saran --parts", () => {
    expect(doc).toMatch(/## \d+\. Audit fidelitas/);
    for (const tag of ["P0", "P1", "P2", "FALSE PASS", "FALSE FAIL", "UNKNOWN", "--parts 3"]) expect(doc, tag).toContain(tag);
  });

  it("menyebut setiap migrasi minimum dan tanda risiko fidelitas shim", () => {
    for (const m of manifest.migrations) expect(doc, m).toContain(m.slice(0, 14));
    expect(doc).toMatch(/fidelitas/i);
    expect(doc).toMatch(/UNKNOWN/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Revisi: role default, perilaku handle_new_user, reset QA, RLS lintas tenant, pemakaian --parts dari HP.
// ---------------------------------------------------------------------------------------------------------------------
const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, "");

function tableColumns(sql: string, table: string) {
  const m = stripComments(sql).match(new RegExp(`create table (?:if not exists )?public\\.${table} \\(([\\s\\S]*?)\\n\\);`));
  if (!m) throw new Error(`tabel ${table} tidak ditemukan`);
  const cols: { name: string; required: boolean }[] = [];
  for (const raw of m[1].split("\n")) {
    const line = raw.trim().replace(/,$/, "");
    const c = line.match(/^([a-z_]+)\s+(?:uuid|text|int|integer|timestamptz|boolean|jsonb)\b(.*)$/);
    if (!c || /^(primary|check|constraint|unique|foreign)$/.test(c[1])) continue;
    const rest = c[2].toLowerCase();
    cols.push({ name: c[1], required: (/not null|primary key/.test(rest)) && !/\bdefault\b/.test(rest) });
  }
  return cols;
}

describe("QA-2 role default pendaftar (revisi 1)", () => {
  const shim = read("qa/qa2-shim.sql");

  it("kode meminta owner untuk fitur lanjutan, tetapi alur trial hari-0 hanya butuh anggota tenant", () => {
    expect(read("app/(app)/billing/page.tsx")).toContain('const isOwner = session.role === "owner"');
    expect(read("supabase/migrations/20261029220000_prompter_p0_subscription_plan_tampering_lockdown.sql")).toMatch(
      /fn_current_role\(\) is distinct from 'owner'/,
    );
    // INSERT pertama brand profile / audit log / langganan: hanya predikat tenant, tanpa role.
    const policies = finalPolicies();
    for (const [key, name] of [["prompter_brand_profiles", "Buat brand profile tenant sendiri"], ["prompter_audit_logs", "Tulis audit log sebagai diri sendiri"], ["prompter_subscriptions", "Buat subscription tenant sendiri"]]) {
      const pol = policies.get(`${key}:${name}`);
      expect(pol, key).toBeDefined();
      expect(pol!.body).not.toMatch(/fn_current_role\(\)/);
    }
    expect(policies.get("prompter_brand_profiles:Owner atau marketing bisa edit brand profile")!.body).toMatch(/'owner'/);
  });

  it("shim memberi 'owner' pada pendaftar (asumsi UNKNOWN, dipertahankan) dan tidak ada role lain di jalur signup", () => {
    const body = shim.match(/create or replace function public\.handle_new_user\(\)[\s\S]*?end \$\$;/)![0];
    const roles = [...body.matchAll(/insert into public\.user_profiles[\s\S]*?values \(([\s\S]*?)\);/g)].map((m) => m[1]);
    expect(roles.length).toBe(1);
    expect(roles[0]).toMatch(/'owner'\s*$/);
    expect(body.match(/'(owner|marketing|apoteker|kasir|admin_gudang|hr)'/g)).toEqual(["'owner'"]);
  });

  it("dokumen menandai role UNKNOWN dan memuat kueri baca-saja (hanya select/pg_get)", () => {
    const doc = read("docs/QA2_SCHEMA_MINIMUM.md");
    expect(doc).toMatch(/kode tidak membuktikan `owner`/);
    const block = doc.slice(doc.indexOf("BACA-SAJA**, dijalankan Founder"));
    const sql = block.slice(block.indexOf("```sql") + 6, block.indexOf("```", block.indexOf("```sql") + 6));
    expect(sql).toMatch(/pg_get_functiondef/);
    expect(sql).toMatch(/pg_policies/);
    expect(/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i.test(sql.replace(/--[^\n]*/g, ""))).toBe(false);
  });
});

describe("QA-2 handle_new_user vs jalur signup/onboarding (revisi 2)", () => {
  const shim = read("qa/qa2-shim.sql");

  it("semua kolom yang dibaca jalur signup/onboarding ada di shim", () => {
    const session = read("services/session.ts");
    const profileCols = session.match(/from\("user_profiles"\)\s*\.select\("([^"]+)"\)/)![1].split(",").map((c) => c.trim());
    const tenantCols = session.match(/from\("tenants"\)\s*\.select\("([^"]+)"\)/)![1].split(",").map((c) => c.trim());
    const approvals = read("app/(app)/approvals/page.tsx").match(/from\("user_profiles"\)\.select\("([^"]+)"\)/)![1].split(",").map((c) => c.trim());
    const have = (t: string) => tableColumns(shim, t).map((c) => c.name);
    for (const c of [...profileCols, ...approvals]) expect(have("user_profiles"), `user_profiles.${c}`).toContain(c);
    for (const c of tenantCols) expect(have("tenants"), `tenants.${c}`).toContain(c);
    expect(shim).toMatch(/create function public\.fn_current_tenant_id\(\)/);
    expect(read("features/onboarding/actions.ts")).toContain('rpc("fn_current_tenant_id")');
  });

  it("handle_new_user mengisi semua kolom NOT NULL tanpa default di tenants dan user_profiles", () => {
    const body = shim.match(/create or replace function public\.handle_new_user\(\)[\s\S]*?end \$\$;/)![0];
    for (const table of ["tenants", "user_profiles"]) {
      const m = body.match(new RegExp(`insert into public\\.${table} \\(([^)]*)\\)`));
      expect(m, table).not.toBeNull();
      const inserted = m![1].split(",").map((c) => c.trim());
      const required = tableColumns(shim, table).filter((c) => c.required).map((c) => c.name);
      expect(required.length).toBeGreaterThan(0);
      for (const c of required) expect(inserted, `${table}.${c}`).toContain(c);
    }
  });

  it("kunci metadata yang dikirim signUp dibaca fungsi; trial dan tabel LINOE TIDAK dibuat trigger", () => {
    const actions = read("features/auth/actions.ts");
    for (const key of ["nama", "nama_usaha", "jenis_usaha"]) {
      expect(actions).toMatch(new RegExp(`\\b${key}\\b`));
      expect(shim).toContain(`->> '${key}'`);
    }
    const body = shim.match(/create or replace function public\.handle_new_user\(\)[\s\S]*?end \$\$;/)![0];
    expect(body).not.toMatch(/prompter_|subscription|business_template/);
    expect(read("supabase/migrations/20261019100100_prompter_p0_subscription_trial_insert_guard.sql")).toMatch(/handle_new_user\(\) does not create the subscription row/);
  });

  it("business_template hanya disebut sebagai komentar: tidak ada kode alur yang membacanya (UNKNOWN, tidak di shim)", () => {
    for (const f of ["services/session.ts", "services/billing.ts", "features/onboarding/actions.ts", "app/auth/confirm/route.ts", "proxy.ts"]) {
      expect(read(f).includes("business_template"), f).toBe(false);
    }
    expect(shim.includes("business_template") && !/--[^\n]*business_template/.test(shim)).toBe(false);
  });
});

type Policy = { table: string; name: string; body: string };
function finalPolicies() {
  const files = [read("qa/qa2-shim.sql"), ...manifest.migrations.map((m) => read(`supabase/migrations/${m}`))];
  const map = new Map<string, Policy>();
  for (const text of files) {
    const code = stripComments(text);
    const events: { at: number; kind: "drop" | "create"; table: string; name: string; body: string }[] = [];
    for (const m of code.matchAll(/drop\s+policy\s+(?:if\s+exists\s+)?"([^"]+)"\s+on\s+public\.([a-z_0-9]+)/gi)) events.push({ at: m.index!, kind: "drop", table: m[2], name: m[1], body: "" });
    for (const m of code.matchAll(/create\s+policy\s+"([^"]+)"\s+on\s+public\.([a-z_0-9]+)([\s\S]*?);/gi)) events.push({ at: m.index!, kind: "create", table: m[2], name: m[1], body: m[3] });
    events.sort((a, b) => a.at - b.at);
    for (const e of events) {
      const key = `${e.table}:${e.name}`;
      if (e.kind === "drop") map.delete(key);
      else map.set(key, { table: e.table, name: e.name, body: e.body });
    }
  }
  return map;
}

describe("QA-2 RLS lintas tenant, statis (revisi 4)", () => {
  const CORE = ["tenants", "user_profiles", "prompter_brand_profiles", "prompter_audit_logs", "prompter_subscriptions", "prompter_invoices", "prompter_ai_jobs", "prompter_attributions", "prompter_analytics_insights"];
  const allSql = [read("qa/qa2-shim.sql"), ...manifest.migrations.map((m) => read(`supabase/migrations/${m}`))].map(stripComments).join("\n");
  const policies = finalPolicies();

  it("RLS aktif pada semua tabel inti", () => {
    for (const t of CORE) expect(new RegExp(`alter\\s+table\\s+public\\.${t}\\s+enable\\s+row\\s+level\\s+security`, "i").test(allSql), t).toBe(true);
  });

  it("setiap kebijakan akhir pada tabel inti terikat tenant (fn_current_tenant_id) dan tidak terbuka (using true)", () => {
    for (const t of CORE) {
      const own = [...policies.values()].filter((p) => p.table === t);
      expect(own.length, `${t}: punya kebijakan`).toBeGreaterThan(0);
      expect(own.some((p) => /\bfor\s+select\b/i.test(p.body) || /\bfor\s+all\b/i.test(p.body)), `${t}: ada kebijakan SELECT`).toBe(true);
      for (const p of own) {
        expect(p.body, `${t}/${p.name}`).toMatch(/fn_current_tenant_id\(\)/);
        expect(/\b(using|with check)\s*\(\s*true\s*\)/i.test(p.body), `${t}/${p.name}: terbuka`).toBe(false);
      }
    }
  });

  it("tenants/user_profiles: SELECT hanya tenant sendiri; UPDATE tenants hanya owner; tanpa INSERT/DELETE klien", () => {
    const sel = policies.get("tenants:Lihat tenant sendiri")!.body;
    expect(sel).toMatch(/id = public\.fn_current_tenant_id\(\)/);
    expect(policies.get("tenants:Owner bisa edit data usaha sendiri")!.body).toMatch(/fn_current_role\(\) = 'owner'/);
    expect(policies.get("user_profiles:sandbox: lihat profil satu tenant")!.body).toMatch(/tenant_id = public\.fn_current_tenant_id\(\)/);
    for (const p of policies.values()) if (p.table === "tenants" || p.table === "user_profiles") expect(/\bfor\s+(insert|delete|all)\b/i.test(p.body), p.name).toBe(false);
  });

  it("langganan: tanpa kebijakan UPDATE/DELETE klien; INSERT dipaksa TRIALING + FREE di tenant sendiri", () => {
    const subs = [...policies.values()].filter((p) => p.table === "prompter_subscriptions");
    expect(subs.some((p) => /\bfor\s+(update|delete|all)\b/i.test(p.body))).toBe(false);
    const ins = policies.get("prompter_subscriptions:Buat subscription tenant sendiri")!.body;
    expect(ins).toMatch(/status = 'TRIALING'/);
    expect(ins).toMatch(/plan = 'FREE'/);
  });

  it("fn_current_tenant_id diturunkan dari auth.uid() (bukan parameter) di shim", () => {
    const fn = read("qa/qa2-shim.sql").match(/create function public\.fn_current_tenant_id\(\)[\s\S]*?\$\$;/)![0];
    expect(fn).toMatch(/where id = auth\.uid\(\)/);
    expect(fn).not.toMatch(/\(\s*\w+\s+\w+/);
  });
});

describe("QA-2 skrip SQL uji RLS lintas tenant (tidak dijalankan di sini)", () => {
  const sql = read("qa/qa2-rls-cross-tenant.sql");
  const code = stripComments(sql);

  it("berlabel QA, guard penanda, tanpa COMMIT/DDL, dibatalkan sendiri lewat galat, tanpa ref nyata", () => {
    expect(sql.split("\n")[1]).toContain(WARNING_LINE);
    expect(code).toContain("QA2_SANDBOX_ONLY");
    expect(code).toMatch(/raise exception 'QA2_RLS_RESULT/);
    expect(/\b(commit|create\s+table|drop\s|truncate|alter\s+table|grant\s|revoke\s)\b/i.test(code)).toBe(false);
    for (const r of REAL_REFS) expect(sql.includes(r)).toBe(false);
  });

  it("memeriksa kontrol positif dan lintas tenant untuk semua tabel inti + tulis lintas tenant + anon", () => {
    for (const t of ["tenants", "user_profiles", "prompter_brand_profiles", "prompter_subscriptions", "prompter_audit_logs", "prompter_invoices", "prompter_analytics_insights"]) {
      expect(code, t).toContain(`public.${t}`);
    }
    for (const label of ["A_baca_tenant_sendiri", "A_baca_tenant_B", "A_tulis_brand_B", "A_tulis_langganan_B", "A_tulis_audit_B", "A_ubah_tenant_B", "anon_baca_tenants"]) {
      expect(code, label).toContain(label);
    }
    expect(code).toMatch(/set local role authenticated/);
    expect(code).toMatch(/request\.jwt\.claim\.sub/);
    expect(code).toMatch(/sqlstate '42501'/);
  });
});

describe("QA-2 alat QA terdaftar di manifest", () => {
  it("setiap qaTools ada di repo dan bukan bagian bundel skema", () => {
    const tools = (manifest as unknown as { qaTools: { file: string }[] }).qaTools;
    expect(tools.map((t) => t.file).sort()).toEqual(["qa/qa2-rls-cross-tenant.sql", "scripts/qa/print-qa-reset-sql.mjs"]);
    for (const t of tools) expect(existsSync(path.join(root, t.file)), t.file).toBe(true);
    expect(buildBundle({ root }).sql.includes("QA2_RLS_RESULT")).toBe(false);
  });
});

describe("QA-2 reset QA: pencetak SQL tanpa koneksi (revisi 3)", () => {
  const ref = ALLOWED_QA_PROJECT_REFS[0];

  it("identitas reset sama dengan identitas QA tetap QA-1", () => {
    expect(QA_IDENTITY_EMAIL).toBe(QA_EMAIL);
    expect(ref).toBe(QA_REF);
  });

  it("menolak ref kosong, ref di luar allowlist, dan semua ref proyek nyata", () => {
    expect(() => buildResetSql({ ref: "" })).toThrow(/REFUSED/);
    expect(() => buildResetSql({ ref: "abcdefghij0123456789" })).toThrow(/allowlist/);
    for (const r of REAL_REFS) expect(() => buildResetSql({ ref: r })).toThrow(/REFUSED/);
  });

  it("SQL: header QA, guard penanda, tenant dulu lalu sapu yatim, satu transaksi, tanpa ref nyata", () => {
    const sql = buildResetSql({ ref });
    expect(sql.split("\n")[1]).toContain(WARNING_LINE);
    expect(sql).toContain("QA2_SANDBOX_ONLY");
    const code = stripComments(sql);
    expect(code.indexOf("begin;")).toBeLessThan(code.indexOf("delete from public.tenants"));
    expect(code.indexOf("QA2_SANDBOX_ONLY")).toBeLessThan(code.indexOf("delete from public.tenants"));
    expect(code).toContain(`u.email = '${QA_EMAIL}'`);
    expect(code).toMatch(/not exists \(select 1 from public\.user_profiles up where up\.tenant_id = t\.id\)/);
    expect(code).not.toMatch(/delete from auth\.users/); // default: user Auth tidak dihapus lewat SQL
    expect(code).not.toMatch(/\b(drop|truncate|alter)\b/i);
    for (const r of REAL_REFS) expect(sql.includes(r)).toBe(false);
    expect(buildResetSql({ ref, withAuthUser: true })).toMatch(/delete from auth\.users where email = '/);
  });

  it("skrip murni: hanya impor node:fs/path/url + allowlist lokal; tanpa jaringan/DB/env", () => {
    const src = read("scripts/qa/print-qa-reset-sql.mjs");
    const specs = [...src.matchAll(/(?:^|\n)\s*import[^"'\n]*?from\s+["']([^"']+)["']/g)].map((m) => m[1]).sort();
    expect(specs).toEqual(["./qa-project-allowlist.mjs", "node:fs", "node:path", "node:url"]);
    for (const w of ["fetch(", "require(", "import(", "process.env", "child_process", "psql", "@supabase", "node:http", "node:net"]) expect(src.includes(w), w).toBe(false);
  });

  it("dokumen menjelaskan reset QA (urutan tenant dulu, hanya proyek QA, tanpa koneksi)", () => {
    const doc = read("docs/QA2_SCHEMA_MINIMUM.md");
    expect(doc).toMatch(/## \d+\. Rollback dan reset QA/);
    expect(doc).toContain("print-qa-reset-sql.mjs");
    expect(doc).toMatch(/tenant dulu, user kemudian/);
  });
});

describe("QA-2 --parts 3 dari HP: dokumen sesuai hasil bangun (revisi 5)", () => {
  const doc = read("docs/QA2_SCHEMA_MINIMUM.md");
  const split = buildBundle({ root, parts: 3 });

  it("ukuran per potongan di dokumen = ukuran sebenarnya (KB dibulatkan) dan semua < 100 KB", () => {
    const kb = split.partBytes.map((b: number) => Math.round(b / 1024));
    kb.forEach((k: number, i: number) => {
      expect(k).toBeLessThan(100);
      expect(doc, `bagian ${i + 1}`).toContain(`part${i + 1}of3.sql\` | ${k} KB`);
    });
    expect(doc).toContain(`${Math.round(buildBundle({ root }).bytes / 1024)} KB`);
  });

  it("versi terakhir tiap potongan di dokumen = versi terakhir sebenarnya, dan guard antar-bagian merujuknya", () => {
    const lastVersions = split.parts.map((t: string) => [...t.matchAll(/^\s+\('(\d{14})', '[0-9a-f]{64}'\)/gm)].map((m) => m[1]).pop()!);
    for (const [i, v] of lastVersions.entries()) {
      expect(doc, `versi bagian ${i + 1}`).toContain(`\`${v}\``);
      if (i + 1 < lastVersions.length) expect(split.parts[i + 1]).toContain(`version = '${v}'`);
    }
    expect(doc).toContain("select max(version) from public._linoe_sandbox_applied");
    expect(doc).toContain("ABORT: bagian sebelumnya belum diterapkan");
  });

  it("CLI tertulis di dokumen dan dukungan --parts ada di skrip", () => {
    expect(doc).toContain("--parts 3");
    expect(read("scripts/qa/build-schema-bundle.mjs")).toContain('"--parts"');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Audit akhir terhadap main 18db8c2: orkestrator/admin client QA-2, rantai reset, kolom trial, grant Data API.
// ---------------------------------------------------------------------------------------------------------------------
describe("QA-2 audit akhir: orkestrator real-e2e vs skema bundel", () => {
  const shim = read("qa/qa2-shim.sql");
  const e2e = read("scripts/qa/real-e2e.mjs");
  const bundleSql = buildBundle({ root }).sql;

  it("orkestrator membaca trial_ends_at, tetapi bundel TIDAK punya kolom itu: kolom nyata = current_period_end (admin client wajib memetakan)", () => {
    expect(e2e).toContain("t.trial_ends_at");
    expect(/\btrial_ends_at\b/.test(stripComments(bundleSql))).toBe(false);
    expect(read("services/billing.ts")).toMatch(/current_period_end: trialEnd\.toISOString\(\)/);
    expect(stripComments(read("supabase/migrations/20260901120847_prompter_billing_foundation.sql"))).toMatch(/current_period_end timestamptz/);
    // status dan plan yang dibaca orkestrator ada di tabel
    const cols = stripComments(read("supabase/migrations/20260901120847_prompter_billing_foundation.sql"));
    expect(cols).toMatch(/\n\s+plan text/);
    expect(cols).toMatch(/\n\s+status text/);
    expect(read("docs/QA2_SCHEMA_MINIMUM.md")).toMatch(/trial_ends_at[\s\S]{0,200}current_period_end/);
  });

  it("panjang trial konsisten: orkestrator 14 hari = services/billing = trigger SQL", () => {
    expect(e2e).toMatch(/export const TRIAL_DAYS = 14;/);
    expect(read("services/billing.ts")).toMatch(/TRIAL_DURATION_DAYS = 14;/);
    expect(read("supabase/migrations/20261019100100_prompter_p0_subscription_trial_insert_guard.sql")).toMatch(/interval '14 days'/);
  });

  it("orkestrator memakai Admin API/deleteUser untuk reset: setiap FK ke auth.users tanpa ON DELETE punya penanganan reset di shim", () => {
    expect(e2e).toContain("adminClient.deleteUser");
    const blocking: string[] = [];
    for (const m of manifest.migrations) {
      for (const line of stripComments(read(`supabase/migrations/${m}`)).split("\n")) {
        if (/references auth\.users\s*\(id\)/i.test(line) && !/on delete/i.test(line)) blocking.push(`${m}: ${line.trim()}`);
      }
    }
    expect(blocking.length, "ada FK penghalang penghapusan user").toBeGreaterThan(0);
    expect(blocking.join("\n")).toMatch(/actor_user_id/);
    // onboarding benar-benar menulis actor_user_id = user, jadi FK itu terisi pada identitas QA
    expect(read("features/onboarding/actions.ts")).toMatch(/actor_user_id: user!\.id/);
    expect(shim).toMatch(/create trigger qa2_before_auth_user_delete before delete on auth\.users/);
    const fn = shim.match(/create or replace function public\.qa2_cleanup_on_auth_user_delete\(\)[\s\S]*?end \$\$;/)![0];
    expect(fn).toMatch(/delete from public\.tenants/);
    expect(fn).toMatch(/security definer/);
    expect(fn).toMatch(/not exists \(select 1 from public\.user_profiles o where o\.tenant_id = t\.id and o\.id <> old\.id\)/);
    expect(shim).toMatch(/revoke all on function public\.qa2_cleanup_on_auth_user_delete\(\) from public, anon, authenticated;/);
  });

  it("tenant dihapus cascade: semua FK tenant_id pada tabel bundel adalah ON DELETE CASCADE", () => {
    for (const m of manifest.migrations) {
      for (const line of stripComments(read(`supabase/migrations/${m}`)).split("\n")) {
        if (/references public\.tenants\s*\(id\)/i.test(line)) expect(line, m).toMatch(/on delete cascade/i);
      }
    }
  });

  it("verifikasi akhir bundel memeriksa grant Data API untuk authenticated dan service_role, serta trigger reset", () => {
    for (const col of ["authenticated_access", "service_role_access", "app_table_grants", "reset_trigger"]) expect(bundleSql, col).toContain(`as ${col}`);
    expect(bundleSql).toMatch(/has_table_privilege\('service_role', 'public\.prompter_subscriptions', 'select'\)/);
  });

  it("kode aplikasi jalur signup/onboarding/trial tidak berubah antara basis QA-2 dan main: dokumen mencatat head yang diaudit", () => {
    const doc = read("docs/QA2_SCHEMA_MINIMUM.md");
    expect(doc).toContain("18db8c2");
    expect(doc).toMatch(/## Status #154/);
    expect(doc.indexOf("## Status #154")).toBeLessThan(doc.indexOf("## 1. "));
    for (const word of ["HOLD", "P0", "P1", "UNKNOWN", "APPROVE QA-2-SCHEMA-BUNDLE"]) expect(doc.slice(0, doc.indexOf("## 1. ")), word).toContain(word);
  });
});
