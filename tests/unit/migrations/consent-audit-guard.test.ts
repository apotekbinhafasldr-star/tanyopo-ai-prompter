import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Paket 3 (Consent & Audit Guard): invarian statis (tanpa akses database). Bukti perilaku pada PostgreSQL sementara:
 * supabase/tests/consent-audit-guard/run-local.sh (job CI "consent-audit-guard-sql").
 */
const root = path.resolve(__dirname, "../../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf-8");
const MIG = "supabase/migrations/20261127100000_prompter_consent_audit_guard.sql";
const DOWN = "supabase/rollback/20261127100000_prompter_consent_audit_guard.down.sql";
const code = (s: string) => s.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const flat = (s: string) => code(s).replace(/\s+/g, " ");
const up = flat(read(MIG));
const down = flat(read(DOWN));

describe("Paket 3 migrasi: lingkup", () => {
  it("migrasi di supabase/migrations, rollback di luar; urutan setelah 20261126100000", () => {
    expect(existsSync(path.join(root, MIG))).toBe(true);
    expect(existsSync(path.join(root, DOWN))).toBe(true);
    const files = readdirSync(path.join(root, "supabase/migrations")).sort();
    expect(files.some((f) => f.endsWith(".down.sql"))).toBe(false);
    expect(files[files.length - 1]).toBe("20261127100000_prompter_consent_audit_guard.sql");
    expect(files[files.length - 2]).toBe("20261126100000_prompter_storage_bucket_l1.sql");
  });

  it("transaksi eksplisit dengan lock_timeout dan statement_timeout (up dan down)", () => {
    for (const [n, sql] of [["up", up], ["down", down]] as const) {
      expect(sql.trim(), n).toMatch(/^begin; set local lock_timeout = '3s'; set local statement_timeout = '10s';/);
      expect(sql.trim(), n).toMatch(/commit;$/);
      expect((sql.match(/\bbegin;/g) ?? []).length, n).toBe(1);
    }
  });

  it("tidak menyentuh auth.users, user_profiles, handle_new_user, fn_create_ai_job_if_entitled, budget_policies, automation_settings, tabel produk lain", () => {
    for (const sql of [up, down]) {
      expect(sql).not.toMatch(/auth\.users|user_profiles|handle_new_user|fn_create_ai_job_if_entitled|budget_policies|automation_settings|publoe|mitapeng|umkmpro|apotek/i);
    }
  });

  it("tenants hanya DIBACA (select ... from public.tenants), tidak pernah diubah", () => {
    const refs = [...up.matchAll(/public\.tenants\b/g)].length;
    expect(refs).toBe(1);
    expect(up).toMatch(/exists \(select 1 from public\.tenants t where t\.id = old\.tenant_id\)/);
    expect(up).not.toMatch(/(insert into|update|delete from|alter table|drop table|truncate( table)?|references)\s+public\.tenants/);
  });

  it("tanpa FK ke auth.users atau tenants pada tabel baru (bukti tidak ikut terhapus bersama tenant)", () => {
    expect(up).not.toMatch(/references (public\.)?tenants|references auth\./);
    expect(up).toContain("references public.prompter_consent_catalog (code, version)");
  });

  it("hanya objek LINOE bernama eksplisit (prompter_*/fn_prompter_*)", () => {
    const tables = [...up.matchAll(/create table if not exists public\.([a-z_]+)/g)].map((m) => m[1]).sort();
    expect(tables).toEqual([
      "prompter_audit_guard_state",
      "prompter_consent_catalog",
      "prompter_consent_events",
      "prompter_consent_purge_runs",
      "prompter_consent_settings",
      "prompter_legal_document_events",
    ]);
    const fns = [...up.matchAll(/create or replace function public\.([a-z_]+)/g)].map((m) => m[1]).sort();
    for (const f of fns) expect(f).toMatch(/^fn_prompter_/);
    expect(up).not.toMatch(/create extension|cron\.|drop schema|create role|alter role|alter default privileges/);
  });
});

describe("Paket 3 migrasi: bukti persetujuan minimal dan retensi", () => {
  it("retain_until nullable tanpa default; parameter retensi di-seed NULL; tanpa angka tahun/bulan", () => {
    expect(up).toMatch(/retain_until timestamptz,/);
    expect(up).not.toMatch(/retain_until timestamptz[^,]*default/);
    expect(up).toContain("values ('evidence_retention_months', null)");
    expect(up).not.toMatch(/evidence_retention_months', '\d/);
    expect(up).not.toMatch(/interval '\d+ (year|month)/);
  });

  it("tidak ada kolom IP, user-agent, email, nama, catatan bebas, token pada tabel bukti", () => {
    const evidence = up.slice(up.indexOf("create table if not exists public.prompter_consent_events"), up.indexOf("create table if not exists public.prompter_consent_settings"));
    expect(evidence).not.toMatch(/\b(ip_address|ip_hash|user_agent|email|nama|note|reason|phone|token|referrer)\b/);
  });

  it("Terms (ACCEPTED) dan Privacy Notice (DELIVERED) di tabel terpisah dari persetujuan; unik per (subjek, dokumen, versi, peristiwa)", () => {
    expect(up).toContain("(doc_code = 'TERMS' and event = 'ACCEPTED') or (doc_code = 'PRIVACY_NOTICE' and event = 'DELIVERED')");
    expect(up).toContain("unique (subject_user_id, doc_code, version, event)");
    expect(up).toMatch(/check \(action in \('GRANTED', 'WITHDRAWN'\)\)|action in \('GRANTED', 'WITHDRAWN'\)/);
  });

  it("fungsi operator (schedule, purge) TANPA GRANT ke role mana pun; dry-run default; keluaran tanpa PII", () => {
    expect(up).toMatch(/revoke all on function public\.fn_prompter_consent_schedule_retention\(boolean\) from public, anon, authenticated, service_role;/);
    expect(up).toMatch(/revoke all on function public\.fn_prompter_consent_evidence_purge\(boolean, text, integer\) from public, anon, authenticated, service_role;/);
    expect(up).not.toMatch(/grant execute on function public\.fn_prompter_consent_(schedule_retention|evidence_purge)/);
    expect(up).toContain("p_dry_run boolean default true");
    const purge = up.slice(up.indexOf("function public.fn_prompter_consent_evidence_purge"), up.indexOf("-- 8. EXECUTE"));
    expect(purge).not.toMatch(/jsonb_build_object\([^)]*(subject_user_id|tenant_id)/);
    expect(purge).toMatch(/raise notice 'consent_purge dry_run=true candidates=%'/);
    expect(purge).toContain("'NOT_APPROVED'");
  });

  it("fungsi aplikasi: EXECUTE sesuai peran (signup & check = service_role; set & my_status = authenticated)", () => {
    expect(up).toContain("grant execute on function public.fn_prompter_record_signup_legal(uuid, integer, integer) to service_role;");
    expect(up).toContain("grant execute on function public.fn_prompter_consent_check(uuid, text) to service_role;");
    expect(up).toContain("grant execute on function public.fn_prompter_consent_set(text, text, text) to authenticated;");
    expect(up).toContain("grant execute on function public.fn_prompter_consent_my_status() to authenticated;");
    expect(up).not.toMatch(/grant [^;]* to (anon|public)\b/);
    // semua fungsi SECURITY DEFINER punya search_path tetap
    for (const m of up.matchAll(/create or replace function public\.([a-z_]+)\([^)]*\) returns [^$]*?(security definer)?\s*set search_path = ([^ ]+ ?[^ ]*) as \$\$/g)) expect(m[3]).toContain("pg_catalog");
  });

  it("RLS aktif pada semua tabel baru; klien hanya SELECT milik sendiri; tanpa policy ubah/hapus", () => {
    for (const t of ["prompter_consent_catalog", "prompter_consent_events", "prompter_legal_document_events", "prompter_consent_settings", "prompter_consent_purge_runs", "prompter_audit_guard_state"]) {
      expect(up, t).toContain(`alter table public.${t} enable row level security;`);
    }
    expect(up).not.toMatch(/create policy "[^"]+" on public\.prompter_(consent|legal)[a-z_]* for (insert|update|delete|all)/);
    expect(up).toContain("for select to authenticated using (subject_user_id = auth.uid())");
  });
});

describe("Paket 3 migrasi: guard audit", () => {
  it("mencabut UPDATE/DELETE/TRUNCATE role klien dan memasang trigger BEFORE UPDATE/DELETE (row) dan BEFORE TRUNCATE (statement)", () => {
    expect(up).toContain("revoke update, delete, truncate on public.prompter_audit_logs from public, anon, authenticated, service_role;");
    expect(up).toMatch(/create trigger trg_prompter_audit_logs_guard before update or delete on public\.prompter_audit_logs for each row/);
    expect(up).toMatch(/create trigger trg_prompter_audit_logs_block_truncate before truncate on public\.prompter_audit_logs for each statement/);
    expect(up).not.toMatch(/revoke (all|insert|select)[^;]* on (table )?public\.prompter_audit_logs/);
  });

  it("DELETE hanya diizinkan bila tenant induk sudah tidak ada (cascade penghapusan tenant)", () => {
    expect(up).toMatch(/if tg_op = 'DELETE' and not exists \(select 1 from public\.tenants t where t\.id = old\.tenant_id\) then return old;/);
  });

  it("hak lama ditangkap hanya sekali (on conflict do nothing) agar rollback memulihkan persis", () => {
    expect(up).toContain("aclexplode(coalesce(c.relacl, acldefault('r', c.relowner)))");
    expect(up).toContain("if not exists (select 1 from public.prompter_audit_guard_state where privilege_type = 'MARKER')");
    expect(down).toContain("execute format('grant %s on public.prompter_audit_logs to %s%s'");
    expect(down).toContain("' with grant option'");
    expect(down).toContain("execute format('comment on table public.prompter_audit_logs is %L', v_old_comment)");
  });

  it("rollback: menolak bila ada bukti kecuali konfirmasi eksplisit; idempoten (if exists); tidak menyentuh baris audit", () => {
    expect(down).toContain("ROLLBACK BERHENTI");
    expect(down).toContain("linoe.drop_evidence");
    expect(down).not.toMatch(/delete from|truncate (table )?public|update public/);
    for (const m of down.matchAll(/drop (table|function|trigger) (?!if exists)/g)) throw new Error(`drop tanpa if exists: ${m[0]}`);
  });

  it("fungsi yatim fn_prompter_block_truncate_clients hanya dibuang bila tidak dipakai trigger", () => {
    expect(up).toContain("fn_prompter_block_truncate_clients");
    expect(up).toContain("TIDAK dibuang");
  });

  it("komentar tabel audit jujur (tanpa kata immutable) dan versi katalog acuan konsisten (aktif tertinggi)", () => {
    const comment = up.slice(up.indexOf("comment on table public.prompter_audit_logs is"), up.indexOf("revoke update, delete, truncate on public.prompter_audit_logs"));
    expect(comment).toContain("pemilik tabel/superuser tetap dapat menonaktifkan trigger");
    expect(comment).not.toMatch(/immutable/i);
    expect(up).toContain("c.code = p_code and c.active order by c.version desc limit 1");
    expect(up).toContain("c.version = (select max(m.version) from public.prompter_consent_catalog m where m.code = c.code and m.active)");
  });

  it("retensi >= 1 (atau NULL), clock_timestamp untuk occurred_at, argumen NULL = 22023", () => {
    expect(up).toContain("value ~ '^[1-9][0-9]{0,2}$'");
    expect((up.match(/occurred_at timestamptz not null default clock_timestamp\(\)/g) ?? []).length).toBe(2);
    expect(up).toContain("if p_code is null or p_action is null or p_source is null or p_action not in");
    expect(up).toContain("if p_dry_run is null or (p_batch is not null and p_batch < 1)");
  });

  it("tidak ada klaim immutable/independen/SLA pada teks aplikasi di berkas migrasi (selain penyangkalan)", () => {
    const raw = read(MIG);
    for (const line of raw.split("\n")) if (/immutable/i.test(line)) expect(line, line).toMatch(/BUKAN|bukan|tidak/);
  });
});

describe("Paket 3: lingkup aplikasi", () => {
  it("halaman legal publik, label checkbox, dan skema tidak diubah oleh Paket 3 (UI terkunci ditunda)", () => {
    expect(read("schemas/auth.ts")).toMatch(/menyetujui Syarat & Ketentuan dan Kebijakan Privasi/);
    expect(read("features/auth/register-form.tsx")).not.toMatch(/consent|legalVersionShown/i);
  });

  it("panel hanya terpasang di pengaturan di belakang CONSENT_UI_ENABLED (default MATI)", () => {
    const page = read("app/(app)/settings/page.tsx");
    expect(page).toContain("isConsentUiEnabled() ? <ConsentSection");
    expect(read("lib/consent/flags.ts")).toContain('process.env.CONSENT_UI_ENABLED === "true"');
    expect(read("lib/consent/flags.ts")).toContain('process.env.CONSENT_ENFORCEMENT_ENABLED === "true"');
  });

  it("gerbang persetujuan terpasang pada titik koneksi dan dipanggil SEBELUM token didekripsi", () => {
    for (const f of ["features/campaigns/launch-actions.ts", "features/campaigns/sync-insights-actions.ts", "features/connections/actions.ts"]) {
      const s = read(f);
      const gate = s.indexOf("consentGateMessage(");
      expect(gate, f).toBeGreaterThan(-1);
      expect(gate, f).toBeLessThan(s.indexOf("decryptToken(credentials.encrypted_access_token)", gate));
    }
    expect(read("lib/connectors/oauth-authorize.ts")).toContain("requireConsent(consentCode, session.userId)");
  });

  it("fungsi inti (login, daftar, billing, dasbor) tidak memanggil gerbang persetujuan", () => {
    const hits = ["features/auth", "features/billing", "features/dashboard", "services"].flatMap((d) =>
      readdirSync(path.join(root, d), { recursive: true, withFileTypes: false } as never)
        .map(String)
        .filter((f) => /\.(ts|tsx)$/.test(f))
        .filter((f) => /requireConsent|consentGateMessage/.test(read(path.join(d, f)))),
    );
    expect(hits).toEqual([]);
  });

  it("flag baru terdokumentasi kosong di .env.example", () => {
    const env = read(".env.example");
    expect(env).toMatch(/^CONSENT_ENFORCEMENT_ENABLED=$/m);
    expect(env).toMatch(/^CONSENT_UI_ENABLED=$/m);
  });
});
