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
    expect(files[files.length - 1]).toBe("20261127110000_prompter_consent_owner_audit_redaction.sql");
    expect(files[files.length - 2]).toBe("20261127100000_prompter_consent_audit_guard.sql");
    expect(files[files.length - 3]).toBe("20261126100000_prompter_storage_bucket_l1.sql");
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
  it("skema pendaftaran hanya meminta penerimaan Syarat & Ketentuan (Privasi = pemberitahuan terpisah) dan form tidak memuat kata consent", () => {
    const schema = read("schemas/auth.ts");
    expect(schema).toMatch(/menyetujui Syarat & Ketentuan untuk mendaftar/);
    expect(schema).not.toMatch(/menyetujui[^"]*(Kebijakan Privasi|Privacy)/);
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
    expect(read("lib/connectors/oauth-authorize.ts")).toContain("requireConsent(consentCode, session.userId, session.tenantId)");
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

// ---------------------------------------------------------------------------------------------------------------------
// Revisi aditif Jalur 1: Owner-only + anonimisasi audit (20261127110000). Pemeriksaan statis; perilaku diuji di sandbox PG (run-local.sh S10-S14).
// ---------------------------------------------------------------------------------------------------------------------
const MIG2 = "supabase/migrations/20261127110000_prompter_consent_owner_audit_redaction.sql";
const DOWN2 = "supabase/rollback/20261127110000_prompter_consent_owner_audit_redaction.down.sql";
const up2 = flat(read(MIG2));
const down2 = flat(read(DOWN2));

describe("Paket 3 revisi: migrasi tambahan 20261127110000", () => {
  it("migrasi pertama TIDAK diedit (hash paket di PR terkunci); revisi hanya berkas baru + rollback di luar migrations", () => {
    expect(existsSync(path.join(root, MIG2))).toBe(true);
    expect(existsSync(path.join(root, DOWN2))).toBe(true);
    expect(readdirSync(path.join(root, "supabase/migrations")).some((f) => f.endsWith(".down.sql"))).toBe(false);
  });

  it("transaksi eksplisit, timeout, tidak menyebut objek terlarang atau tabel finansial/keamanan/Emergency Stop", () => {
    for (const [n, sql] of [["up2", up2], ["down2", down2]] as const) {
      expect(sql.trim(), n).toMatch(/^begin; set local lock_timeout = '3s'; set local statement_timeout = '10s';/);
      expect(sql.trim(), n).toMatch(/commit;$/);
      expect(sql, n).not.toMatch(/auth\.users|handle_new_user|fn_create_ai_job_if_entitled|budget_policies|automation_settings|finance_audit_logs|ledger_entries|payment_alert|emergency_stop|publoe|mitapeng|umkmpro|apotek/i);
    }
  });

  it("user_profiles dan tenants hanya DIBACA (tidak pernah insert/update/delete/alter)", () => {
    expect(up2).not.toMatch(/(insert into|update|delete from|alter table|drop table|truncate( table)?|references)\s+public\.(tenants|user_profiles)/);
    expect(up2).toMatch(/from public\.user_profiles up where up\.id = v_uid/);
  });

  it("persetujuan koneksi: Owner saja dan tenant dari profil pemanggil (p_tenant_id opsional harus sama), di dalam RPC", () => {
    expect(up2).toContain("v_role is distinct from 'owner'");
    expect(up2).toContain("p_tenant_id is not null and p_tenant_id is distinct from v_tenant");
    expect(up2).toContain("fn_prompter_consent_set(p_code text, p_action text, p_source text, p_tenant_id uuid default null)");
    expect(up2).toContain("drop function if exists public.fn_prompter_consent_set(text, text, text);");
    expect(up2).toContain("grant execute on function public.fn_prompter_consent_check_tenant(uuid, text, uuid) to service_role;");
    expect(up2).not.toMatch(/grant [^;]* to (anon|public)\b/);
  });

  it("Privacy Notice DELIVERED hanya bila versi dikirim; Terms selalu", () => {
    expect(up2).toContain("if p_privacy_version is not null then");
    expect(up2).toMatch(/'TERMS', p_terms_version, 'ACCEPTED'/);
  });

  it("fungsi operator anonimisasi: TANPA GRANT, session_user dijaga, dry-run wajib, allowlist, tabel finansial dikecualikan, hitungan saja", () => {
    for (const fn of ["fn_prompter_audit_redact(text, uuid, boolean, integer)", "fn_prompter_audit_pii_canary_scan(uuid)", "fn_prompter_audit_row_needs_redaction(text, jsonb, jsonb, jsonb)", "fn_prompter_audit_redact_doc(jsonb, text)"]) {
      expect(up2).toContain(`revoke all on function public.${fn} from public, anon, authenticated, service_role;`);
      expect(up2).not.toContain(`grant execute on function public.${fn}`);
    }
    expect(up2).toContain("session_user in ('anon', 'authenticated', 'service_role', 'authenticator')");
    expect(up2).toContain("p_dry_run boolean default true");
    expect(up2).toContain("dry-run dengan request_ref ini wajib dijalankan lebih dulu");
    const deny = "(audit|consent|approval|compliance|autopilot|subscription|connect|credential|token|role|admin|flag|finance|ledger|payment|billing|invoice|security|budget|automation|emergency|stop|auth|tenant|profile)";
    // daftar-tolak identik di CHECK allowlist dan di fungsi anonimisasi, ditambah daftar-positif sempit dan trigger penolak INSERT
    expect(up2.split(deny).length - 1).toBe(2);
    expect(up2).toContain("resource_type in ('prompter_manual_ad_metrics')");
    expect(up2).toContain("allowlist anonimisasi hanya diubah lewat migrasi");
    expect(up2).toContain("REQ-[0-9]{4,12}");
    expect(up2).toContain("from public.prompter_audit_redact_dryruns d");
    expect(up2).toContain("[DIHAPUS-PII]");
    expect(up2).toContain("revoke all on public.prompter_audit_redaction_allowlist, public.prompter_audit_redact_nonce, public.prompter_audit_redact_dryruns from public, anon, authenticated, service_role;");
  });

  it("fungsi anonimisasi hanya menyentuh prompter_audit_logs (UPDATE), dan hanya kolom before_data/after_data/context", () => {
    const updates = [...up2.matchAll(/update (public\.[a-z_]+)/g)].map((m) => m[1]);
    expect(new Set(updates)).toEqual(new Set(["public.prompter_audit_logs"]));
    expect(up2).toContain("(to_jsonb(new) - 'before_data' - 'after_data' - 'context') = (to_jsonb(old) - 'before_data' - 'after_data' - 'context')");
  });

  it("guard: nonce acak per transaksi dari tabel privat (bukan GUC yang bisa diset klien); DELETE cascade tetap", () => {
    expect(up2).toContain("n.txid = txid_current() and n.nonce::text = v_nonce");
    expect(up2).toContain("not exists (select 1 from public.tenants t where t.id = old.tenant_id)");
    expect(up2).toMatch(/fn_prompter_audit_logs_guard\(\) returns trigger language plpgsql security definer set search_path = pg_catalog, public/);
  });

  it("trigger audit produk lain (manual_ad_metrics dst.) tidak diubah; tidak ada create trigger pada tabel produk", () => {
    for (const m of up2.matchAll(/create trigger [a-z_]+ before [a-z ]+ on (public\.[a-z_]+)/g)) {
      expect(["public.prompter_audit_redaction_allowlist"]).toContain(m[1]);
    }
  });

  it("rollback: menolak bila ada hash teks tersimpan kecuali konfirmasi; idempoten; memulihkan isi fungsi lama", () => {
    expect(down2).toContain("ROLLBACK BERHENTI");
    expect(down2).toContain("linoe.drop_evidence");
    expect(down2).toContain("alter table if exists public.prompter_consent_events drop column if exists text_sha256;");
    expect(down2).toMatch(/create or replace function public\.fn_prompter_consent_set\(p_code text, p_action text, p_source text\)/);
    expect(down2).not.toMatch(/delete from public\.prompter_audit_logs|truncate/);
  });

  it("server memakai tenant sesi dan Privacy hanya bila versi cocok persis", () => {
    expect(read("lib/consent/require-consent.ts")).toContain("fn_prompter_consent_check_tenant");
    expect(read("features/auth/actions.ts")).toContain('formData.get("privacyNoticeVersion") === String(PRIVACY_NOTICE_VERSION)');
  });
});

describe("Paket 3 revisi: dasar hukum belum terverifikasi tidak lagi dirujuk dengan nomor", () => {
  it("tidak ada rujukan peraturan tak terverifikasi bernomor di dokumen/kode (diganti penanda UNKNOWN)", () => {
    const files = ["docs/LEGAL_PSE_CHECKLIST.md", "docs/SOFT_LAUNCH_10_TENANTS.md", "docs/CONSENT_AUDIT_GUARD.md", "docs/DATABASE.md"];
    for (const f of files) expect(read(f), f).not.toMatch(/PP\s*33\s*\/\s*2026|33\/2026/);
    expect(read("docs/LEGAL_PSE_CHECKLIST.md")).toContain("dasar hukum belum terverifikasi (UNKNOWN)");
  });
});
