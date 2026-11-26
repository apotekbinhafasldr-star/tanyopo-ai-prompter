import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Paket 2 L1 — static safety invariants for the storage bucket hardening migration (repository-only, no database access).
 * Behavioural proof on a throw-away PostgreSQL: supabase/tests/storage-bucket-l1/run-local.sh (CI job "storage-bucket-l1-sql").
 */
const root = path.resolve(__dirname, "../../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf-8");
const MIG = "supabase/migrations/20261126100000_prompter_storage_bucket_l1.sql";
const DOWN = "supabase/rollback/20261126100000_prompter_storage_bucket_l1.down.sql";
const PRE = "supabase/tools/storage-bucket-l1/PRECHECK.sql";
const POST = "supabase/tools/storage-bucket-l1/POSTCHECK.sql";
const PHASE1 = "supabase/migrations/20260829092303_prompter_phase1_schema.sql";
const code = (s: string) => s.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const flat = (s: string) => code(s).replace(/\s+/g, " ");

const LEGACY = "Tenant kelola file marketing miliknya sendiri";
const NEW_POLICIES = [
  "Tenant baca file marketing miliknya sendiri",
  "Tenant unggah file product-media miliknya sendiri",
  "Tenant ubah file product-media miliknya sendiri",
  "Tenant hapus file product-media miliknya sendiri",
];
const RESERVED = ["creative-assets", "brand-assets", "generated-content"];

const up = flat(read(MIG));
const down = flat(read(DOWN));

describe("storage bucket L1 migration — scope", () => {
  it("lives in supabase/migrations with its down script outside it", () => {
    expect(existsSync(path.join(root, MIG))).toBe(true);
    expect(existsSync(path.join(root, DOWN))).toBe(true);
    expect(readdirSync(path.join(root, "supabase/migrations")).some((f) => f.endsWith(".down.sql"))).toBe(false);
  });

  it("touches only storage.buckets (UPDATE public) and storage.objects policies; no table, function, grant, extension or data deletion", () => {
    expect(up).not.toMatch(/create table|alter table|drop table|truncate|create (or replace )?function|create extension|cron\.|grant |revoke /i);
    expect(up).not.toMatch(/delete from|insert into/i);
    expect([...up.matchAll(/update ([a-z_.]+) set ([a-z_]+)/g)].map((m) => `${m[1]}.${m[2]}`)).toEqual(["storage.buckets.public"]);
    for (const m of up.matchAll(/(create|drop) policy (?:if exists )?"[^"]+" on ([a-z_.]+)/g)) expect(m[2]).toBe("storage.objects");
  });

  it("never touches limits, mime types, product-media bucket row, or other products' schemas", () => {
    expect(up).not.toMatch(/file_size_limit|allowed_mime_types/);
    expect(up).not.toMatch(/update storage\.buckets[^;]*product-media/);
    expect(up).not.toMatch(/publoe|mitapeng|umkmpro|apotek|\bpublic\.(tenants|user_profiles)\b/i);
  });

  it("flips public to false only for the three reserved buckets, never to true", () => {
    expect(up).toContain("v_reserved constant text[] := array['creative-assets', 'brand-assets', 'generated-content']");
    expect(up).toMatch(/update storage\.buckets set public = false where id = any \(v_reserved\) and public is distinct from false/);
    expect(up).not.toMatch(/public = true/);
  });

  it("refuses to run when any reserved bucket holds an object, and the count happens after the policy drop (same table lock)", () => {
    expect(up).toMatch(/select count\(\*\) into v_count from storage\.objects where bucket_id = any \(v_reserved\)/);
    expect(up).toMatch(/if v_count > 0 then raise exception 'L1 BERHENTI/);
    expect(up.indexOf(`drop policy if exists "${LEGACY}"`)).toBeGreaterThan(-1);
    expect(up.indexOf(`drop policy if exists "${LEGACY}"`)).toBeLessThan(up.indexOf("select count(*) into v_count"));
    expect(up).toContain("set local lock_timeout = '3s'");
  });
});

describe("storage bucket L1 migration — policies", () => {
  it("drops only policies it recognises by name (the legacy one and its own four)", () => {
    const dropped = [...up.matchAll(/drop policy if exists "([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(dropped)).toEqual(new Set([LEGACY, ...NEW_POLICIES]));
    expect(up).not.toMatch(/drop policy (?!if exists)/);
  });

  it("creates exactly one policy per command and no FOR ALL", () => {
    const created = [...up.matchAll(/create policy "([^"]+)" on storage\.objects for (select|insert|update|delete)/g)].map((m) => `${m[2]}:${m[1]}`).sort();
    expect(created).toEqual([
      `delete:${NEW_POLICIES[3]}`, `insert:${NEW_POLICIES[1]}`, `select:${NEW_POLICIES[0]}`, `update:${NEW_POLICIES[2]}`,
    ]);
    expect(up).not.toMatch(/for all/i);
  });

  it("write policies (insert/update/delete) are limited to bucket product-media and the tenant's own folder; reserved buckets never appear in them", () => {
    for (const cmd of ["insert", "update", "delete"]) {
      const m = up.match(new RegExp(`for ${cmd}[^;]*?;`));
      expect(m, cmd).not.toBeNull();
      expect(m![0], cmd).toContain("bucket_id = 'product-media'");
      expect(m![0], cmd).toContain("(storage.foldername(name))[1] = public.fn_current_tenant_id()::text");
      for (const b of RESERVED) expect(m![0], `${cmd} ${b}`).not.toContain(b);
    }
  });

  it("keeps the product-media UPDATE policy on purpose in L1 (closing it is L1b/L3), with check mirroring using", () => {
    const m = up.match(/for update using \(([^;]*?)\) with check \(([^;]*?)\);/);
    expect(m).not.toBeNull();
    expect(m![1]).toBe(m![2]);
  });

  it("select stays tenant-folder scoped over the four LINOE buckets (unchanged read scope)", () => {
    const m = up.match(/for select using \(([^;]*?)\);/);
    expect(m![1]).toContain("bucket_id in ('product-media', 'creative-assets', 'brand-assets', 'generated-content')");
    expect(m![1]).toContain("(storage.foldername(name))[1] = public.fn_current_tenant_id()::text");
  });

  it("the legacy policy it replaces really is the Phase 1 FOR ALL policy over the same four buckets", () => {
    const p1 = flat(read(PHASE1));
    expect(p1).toContain(`create policy "${LEGACY}" on storage.objects for all`);
    expect(p1).toContain("bucket_id in ('product-media', 'creative-assets', 'brand-assets', 'generated-content')");
  });
});

describe("storage bucket L1 rollback", () => {
  it("restores public=true for the three reserved buckets and the exact Phase 1 FOR ALL policy; drops only its own four", () => {
    expect(down).toMatch(/update storage\.buckets set public = true where id in \('creative-assets', 'brand-assets', 'generated-content'\) and public is distinct from true/);
    const dropped = [...down.matchAll(/drop policy if exists "([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(dropped)).toEqual(new Set([LEGACY, ...NEW_POLICIES]));
    const p1 = flat(read(PHASE1));
    const orig = p1.slice(p1.indexOf(`create policy "${LEGACY}"`)).replace(/;.*/, ";");
    const restored = down.slice(down.indexOf(`create policy "${LEGACY}"`)).replace(/;.*/, ";");
    expect(restored).toBe(orig);
    expect(down).not.toMatch(/delete from|insert into|file_size_limit|allowed_mime_types|truncate/i);
  });
});

describe("storage bucket L1 PRECHECK / POSTCHECK", () => {
  for (const f of [PRE, POST]) {
    it(`${path.basename(f)} is a single read-only SELECT (no DDL/DML, no secrets, no real project ref)`, () => {
      const s = flat(read(f)).trim();
      expect(s).not.toMatch(/\b(insert into|update [a-z_."]+ set|delete from|drop |create |alter |truncate|grant |revoke |copy )/i);
      expect(s).toMatch(/^with /);
      expect(s).not.toMatch(/wjjyqovhmwenbcvbnkgx|service_role_key|eyJ[a-zA-Z0-9]{10,}/);
    });
  }

  it("PRECHECK covers Q0 (foreign write policies), Q1 fingerprint, Q4 per reserved bucket, Q6 baseline, Q7 owner/privileges", () => {
    const s = read(PRE);
    for (const q of ["'Q0'", "'Q1'", "'Q4:' || b", "'Q6'", "'Q7'", "'Q8'"]) expect(s).toContain(q);
    expect(s).toContain("LANJUT-DENGAN-CATATAN");
    expect(s).toContain("L1 TIDAK menutup/menyentuh policy itu; tenant masih bisa menulis ke bucket cadangan");
    expect(s).toContain("'BERHENTI'");
  });

  it("POSTCHECK compares against PRECHECK values supplied by the Founder (placeholders), not embedded baselines, and keeps P10 manual/UNKNOWN", () => {
    const s = read(POST);
    expect(s).toMatch(/ref as \(select 'ISI_Q1'::text as q1, 'ISI_Q0'::text as q0, 'ISI_Q2'::text as q2, 'ISI_Q5'::text as q5, 'ISI_Q6'::text as q6\)/);
    for (const q of ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10"]) expect(s).toContain(`'${q}'`);
    expect(s).toContain("PASS-DENGAN-CATATAN");
    expect(s).toMatch(/'P10'[\s\S]*UNKNOWN/);
  });
});

describe("storage bucket L1 documentation and isolation", () => {
  it("ships rollback, isolation and risk documents", () => {
    for (const f of ["ROLLBACK.md", "ISOLASI.md", "LAPORAN_RISIKO.md", "SANDBOX_LOG.txt"]) expect(existsSync(path.join(root, "docs/storage-bucket-l1", f)), f).toBe(true);
    expect(read("docs/storage-bucket-l1/LAPORAN_RISIKO.md")).toMatch(/tanpa bucket_id/);
  });

  it("is not wired into the production package pipeline (no new package, p0-2 untouched)", () => {
    const manifest = JSON.parse(read("supabase/prod-packages/manifest.json"));
    expect(Object.keys(manifest.packages)).toEqual(["p0-2"]);
    expect(readdirSync(path.join(root, "supabase/prod-packages"))).not.toContain("storage-bucket-l1");
  });
});
