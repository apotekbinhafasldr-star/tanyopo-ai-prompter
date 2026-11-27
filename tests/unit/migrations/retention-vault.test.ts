import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * 4r (Opsi A, retention vault): invarian statis (tanpa akses database). Bukti perilaku pada PostgreSQL sementara:
 * supabase/tests/retention-vault/run-local.sh (job CI "retention-vault-sql", PostgreSQL 16 dan 17).
 */
const root = path.resolve(__dirname, "../../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf-8");
const VERSION = "20261128090000";
const MIG = `supabase/migrations/${VERSION}_prompter_retention_vault.sql`;
const DOWN = `supabase/rollback/${VERSION}_prompter_retention_vault.down.sql`;
const SOFT = `supabase/rollback/${VERSION}_prompter_retention_vault.down-soft.sql`;
const DOC = "docs/RETENTION_VAULT.md";
const code = (s: string) => s.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const flat = (s: string) => code(s).replace(/\s+/g, " ");
const up = flat(read(MIG));
const down = flat(read(DOWN));
const soft = flat(read(SOFT));

describe("4r migrasi: lingkup dan urutan", () => {
  it("nama berkas valid, versi unik dan lebih baru dari Paket 3, migrasi terakhir di repo; rollback di luar supabase/migrations", () => {
    const files = readdirSync(path.join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(files[files.length - 1]).toBe(`${VERSION}_prompter_retention_vault.sql`);
    expect(MIG.split("/").pop()).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    expect(VERSION > "20261127110000").toBe(true);
    expect(files.filter((f) => f.startsWith(VERSION))).toHaveLength(1);
    expect(files.some((f) => f.endsWith(".down.sql") || f.endsWith(".down-soft.sql"))).toBe(false);
    for (const f of [DOWN, SOFT]) expect(existsSync(path.join(root, f)), f).toBe(true);
  });

  it("satu transaksi eksplisit dengan lock_timeout dan statement_timeout (up, down, down-soft)", () => {
    for (const [n, sql] of [["up", up], ["down", down], ["soft", soft]] as const) {
      expect(sql.trim(), n).toMatch(/^begin; set local lock_timeout = '3s'; set local statement_timeout = '10s';/);
      expect(sql.trim(), n).toMatch(/commit;$/);
      expect((sql.match(/\bbegin;/g) ?? []).length, n).toBe(1);
    }
  });

  it("tidak menyentuh auth.users, user_profiles, handle_new_user, fungsi billing, tabel produk lain, dan tidak memuat nama produk lain", () => {
    for (const sql of [up, down, soft]) {
      expect(sql).not.toMatch(/auth\.users|user_profiles|handle_new_user|fn_create_ai_job_if_entitled|fn_apply_verified_payment|budget_policies|automation_settings/i);
      expect(sql).not.toMatch(/publoe|mitapeng|umkmpro|apotek/i);
    }
  });

  it("tenants hanya DIBACA (tidak pernah diubah, dikunci, atau dirujuk FK)", () => {
    for (const sql of [up, down, soft]) {
      expect(sql).not.toMatch(/(insert into|update|delete from|alter table|drop table|truncate( table)?|references|lock table|create trigger [a-z_ ]* on)\s+(public\.)?tenants\b/);
      expect(sql).not.toMatch(/on public\.tenants\b/);
    }
    expect(up).toMatch(/exists \(select 1 from public\.tenants t where t\.id = old\.tenant_id\)/);
  });

  it("tanpa FK ke auth.users atau tenants pada tabel baru; tidak ada foreign key sama sekali", () => {
    expect(up).not.toMatch(/references/);
    expect(up).not.toMatch(/foreign key/);
  });

  it("hanya objek LINOE bernama eksplisit; satu tabel baru; trigger hanya pada tiga tabel billing dan brankas", () => {
    expect([...up.matchAll(/create table if not exists public\.([a-z_]+)/g)].map((m) => m[1])).toEqual(["prompter_retention_vault"]);
    expect([...up.matchAll(/create or replace function public\.([a-z_]+)/g)].map((m) => m[1]).sort()).toEqual([
      "fn_prompter_retention_block_truncate",
      "fn_prompter_retention_vault_capture",
      "fn_prompter_retention_vault_immutable",
      "fn_prompter_retention_vault_status",
    ]);
    const triggerTables = [...up.matchAll(/create trigger [a-z_]+ before [a-z ]+ on public\.([a-z_]+)/g)].map((m) => m[1]);
    expect(new Set(triggerTables)).toEqual(new Set(["prompter_subscriptions", "prompter_invoices", "prompter_payment_transactions", "prompter_retention_vault"]));
    expect(up).not.toMatch(/alter table public\.(tenants|user_profiles)/);
    expect(up).not.toMatch(/create policy|create extension|cron\.|pg_cron|create (or replace )?view|alter default privileges|alter role|create role/i);
  });
});

describe("4r migrasi: fail-closed, allowlist, hak", () => {
  it("penyalin: SECURITY DEFINER, search_path berakhir pg_temp, galat LR001 tanpa isi baris, BEFORE DELETE per baris", () => {
    const fn = up.slice(up.indexOf("create or replace function public.fn_prompter_retention_vault_capture"), up.indexOf("create or replace function public.fn_prompter_retention_block_truncate"));
    expect(fn).toMatch(/security definer set search_path = pg_catalog, public, pg_temp/);
    expect(fn).toMatch(/exception when others or query_canceled then/);
    expect(fn).toMatch(/raise exception 'LR001 gagal menyalin arsip retensi \(% \/ sqlstate %\); penghapusan dibatalkan', tg_table_name, sqlstate using errcode = 'LR001'/);
    // pesan galat tidak memuat isi baris
    expect(fn).not.toMatch(/raise exception[^;]*(old\.|v_row|v_data)/);
    expect(up).toMatch(/create trigger trg_zz_retention_capture before delete on public\.prompter_subscriptions for each row/);
    expect(up).toMatch(/create trigger trg_zz_retention_capture before delete on public\.prompter_invoices for each row/);
    expect(up).toMatch(/create trigger trg_zz_retention_capture before delete on public\.prompter_payment_transactions for each row/);
  });

  it("allowlist kolom eksplisit; kolom bebas/rahasia/pengenal orang TIDAK ada di fungsi", () => {
    const fn = up.slice(up.indexOf("create or replace function public.fn_prompter_retention_vault_capture"), up.indexOf("create or replace function public.fn_prompter_retention_block_truncate"));
    expect(fn).not.toMatch(/'(metadata|failure_reason|description|user_id|payment_provider_customer_reference|tax_metadata|billing_country|invoice_currency|success_fee_rate_bps)'/);
    for (const c of ["provider_payment_id", "provider_event_id", "external_invoice_id", "current_period_end", "transaction_id"]) expect(fn).toContain(`'${c}'`);
    expect(fn).toMatch(/to_jsonb\(old\)/);
    expect(fn).toMatch(/where v_row \? k/);
  });

  it("brankas: RLS aktif tanpa policy, semua hak klien dicabut (tabel, urutan identity, empat fungsi), pemilik non-klien", () => {
    expect(up).toMatch(/alter table public\.prompter_retention_vault enable row level security;/);
    expect(up).not.toMatch(/force row level security/);
    expect(up).toMatch(/revoke all on public\.prompter_retention_vault from public, anon, authenticated, service_role;/);
    expect(up).toMatch(/revoke all on sequence %s from public, anon, authenticated, service_role/);
    for (const name of ["fn_prompter_retention_vault_capture", "fn_prompter_retention_block_truncate", "fn_prompter_retention_vault_immutable", "fn_prompter_retention_vault_status"]) {
      expect(up).toContain(`revoke all on function public.${name}() from public, anon, authenticated, service_role;`);
    }
    expect(up).not.toMatch(/\bgrant\b/);
  });

  it("trigger penyalin dan penolak TRUNCATE ENABLE ALWAYS (enam pernyataan); penjaga hanya-tambah brankas ada", () => {
    expect((up.match(/enable always trigger (trg_zz_retention_capture|trg_retention_no_truncate)/g) ?? []).length).toBe(6);
    expect(up).toMatch(/create trigger trg_retention_vault_immutable before update or delete on public\.prompter_retention_vault/);
    expect(up).toMatch(/create trigger trg_retention_vault_no_truncate before truncate on public\.prompter_retention_vault/);
    expect(up).toMatch(/errcode = 'LR003'/);
    expect(up).toMatch(/errcode = 'LR004'/);
  });

  it("tidak ada durasi retensi dan tidak ada penghapusan otomatis: retain_until NULL tanpa default; tidak ada purge/jadwal; tidak ada angka tahun", () => {
    expect(up).toMatch(/retain_until timestamptz null/);
    expect(up).not.toMatch(/retain_until[^,;]*default/);
    expect(up).not.toMatch(/purge|schedule|cron|interval '|\b(3|10|5)\s*(tahun|years?)\b/i);
    expect(up).not.toMatch(/delete from public\.prompter_retention_vault|update public\.prompter_retention_vault|truncate public\.prompter_retention_vault/);
  });

  it("prasyarat fail-closed: tiga tabel, tenants, dan SELECT pemilik pada tenants", () => {
    expect(up).toMatch(/DIBATALKAN 4r: tabel % tidak ada/);
    expect(up).toMatch(/DIBATALKAN 4r: public\.tenants tidak ada/);
    expect(up).toMatch(/has_table_privilege\(current_user, 'public\.tenants', 'SELECT'\)/);
  });
});

describe("4r rollback", () => {
  it("down: menolak bila brankas berisi kecuali GUC persis; down-soft tidak membuang brankas", () => {
    expect(down).toMatch(/current_setting\('linoe\.drop_retention_vault', true\)/);
    expect(down).toContain("'DROP-VAULT-20261128090000'");
    expect(down).toMatch(/DIBATALKAN down 4r: brankas berisi % baris/);
    expect(down).toMatch(/drop table if exists public\.prompter_retention_vault/);
    expect(soft).not.toMatch(/drop table|prompter_retention_vault_status|retention_vault_immutable/);
    expect(soft).toMatch(/drop trigger if exists trg_zz_retention_capture on public\.prompter_subscriptions/);
    expect(soft).toMatch(/drop function if exists public\.fn_prompter_retention_vault_capture\(\)/);
  });

  it("tidak ada DELETE/UPDATE/TRUNCATE atas isi brankas di rollback maupun baris billing/tenants", () => {
    for (const sql of [down, soft]) {
      expect(sql).not.toMatch(/\b(delete from|update|truncate)\s+(public\.)?(prompter_|tenants)/);
    }
  });
});

describe("4r dokumentasi dan lingkup repo", () => {
  const doc = read(DOC);
  const prose = doc.replace(/```[\s\S]*?```/g, "");

  it("tidak ada klaim immutable/WORM/tahan manipulasi di luar blok kode daftar larangan; ada pernyataan jujur 'bukan immutable'", () => {
    expect(prose).not.toMatch(/(adalah|bersifat|dijamin|sudah)\s+(immutable|WORM)|tahan manipulasi|tidak (bisa|dapat) (dihapus|diubah)|tamper-proof/i);
    expect(prose).toMatch(/bukan immutable/i);
    expect(prose).toMatch(/pemilik database dapat/i);
  });

  it("tidak menetapkan durasi retensi 3/10 tahun sebagai keputusan, memuat UNKNOWN dan kelas bukti, dan tidak memuat nama produk lain", () => {
    expect(prose).toMatch(/UNKNOWN/);
    expect(prose).toMatch(/SANDBOX/);
    expect(prose).toMatch(/belum ditetapkan/i);
    expect(prose).not.toMatch(/(ditetapkan|diputuskan|ditentukan)\s+(selama\s+)?(3|10|tiga|sepuluh)\s+tahun/i);
    expect(doc).not.toMatch(/publoe|mitapeng|umkmpro|apotek/i);
  });

  it("flag tetap OFF dan tidak ada kode aplikasi: tidak ada env/flag baru dan tidak ada paket produksi 4r", () => {
    expect(readdirSync(path.join(root, "supabase/prod-packages"))).not.toContain("4r");
    expect(readdirSync(path.join(root, "supabase/prod-packages")).filter((d) => /4r|retention/i.test(d))).toEqual([]);
    const env = read(".env.example");
    expect(env).not.toMatch(/RETENTION|VAULT/i);
  });

  it("CI memiliki job retention-vault-sql pada PostgreSQL 16 dan 17 dan tidak melonggarkan job lain", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toMatch(/retention-vault-sql:/);
    expect(ci).toMatch(/pg: \["16", "17"\]/);
    expect(ci).toMatch(/bash supabase\/tests\/retention-vault\/run-local\.sh/);
    expect(ci).toMatch(/grep -q '\^ALL PASSED'/);
  });
});
