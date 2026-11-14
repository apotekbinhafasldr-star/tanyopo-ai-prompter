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
  const extra = shim.slice(shim.indexOf("TAMBAHAN KHUSUS QA-2"));

  it("grant minimal hanya untuk authenticated: SELECT tenants/user_profiles, EXECUTE fn_current_*; tanpa anon/tulis", () => {
    expect(extra).toContain("grant select on public.tenants, public.user_profiles to authenticated;");
    expect(extra).toContain("grant execute on function public.fn_current_tenant_id() to authenticated;");
    expect(extra).toContain("grant execute on function public.fn_current_role() to authenticated;");
    const code = extra.replace(/--[^\n]*/g, "");
    expect(/\banon\b|service_role|\b(insert|update|delete|all)\b/i.test(code)).toBe(false);
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
