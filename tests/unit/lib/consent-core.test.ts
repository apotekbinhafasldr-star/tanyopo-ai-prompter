import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi, afterEach } from "vitest";
import { CONSENT_CATALOG, CONSENT_MESSAGES, connectConsentCode, getConsentEntry, listActiveConsents } from "@/lib/consent/catalog";
import { isConsentEnforcementEnabled, isConsentUiEnabled } from "@/lib/consent/flags";
import { consentGateMessage, requireConsent } from "@/lib/consent/require-consent";
import { recordSignupLegal } from "@/lib/consent/signup-legal";
import { PRIVACY_NOTICE_VERSION, TERMS_VERSION } from "@/features/legal/legal-versions";
import { buildConsentItems, formatIndonesianDate, statusLabel } from "@/lib/consent/view";

const root = path.resolve(__dirname, "../../..");
const sql = readFileSync(path.join(root, "supabase/migrations/20261127100000_prompter_consent_audit_guard.sql"), "utf-8");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("flags: default OFF, aktif hanya bila persis \"true\"", () => {
  it("enforcement dan UI MATI tanpa env", () => {
    vi.stubEnv("CONSENT_ENFORCEMENT_ENABLED", "");
    vi.stubEnv("CONSENT_UI_ENABLED", "");
    expect(isConsentEnforcementEnabled()).toBe(false);
    expect(isConsentUiEnabled()).toBe(false);
  });
  it.each(["1", "TRUE", "True", "yes", " true", "true "])("nilai %j = MATI", (v) => {
    vi.stubEnv("CONSENT_ENFORCEMENT_ENABLED", v);
    vi.stubEnv("CONSENT_UI_ENABLED", v);
    expect(isConsentEnforcementEnabled()).toBe(false);
    expect(isConsentUiEnabled()).toBe(false);
  });
  it("hanya \"true\" mengaktifkan, dan masing-masing independen", () => {
    vi.stubEnv("CONSENT_ENFORCEMENT_ENABLED", "true");
    vi.stubEnv("CONSENT_UI_ENABLED", "");
    expect(isConsentEnforcementEnabled()).toBe(true);
    expect(isConsentUiEnabled()).toBe(false);
  });
});

describe("katalog", () => {
  it("teks dan hash katalog TS sama dengan seed SQL (teks versi terbit tidak menyimpang)", () => {
    for (const e of CONSENT_CATALOG) {
      expect(sql, e.code).toContain(`('${e.code}', ${e.version}, '${e.text}', '${e.purpose}', ${e.active})`);
      expect(createHash("sha256").update(e.text, "utf8").digest("hex")).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(sql).toContain("encode(sha256(convert_to(v.text_id, 'UTF8')), 'hex')");
  });
  it("hanya CONNECT_META dan CONNECT_TIKTOK aktif; X, pemasaran, telemetri terdaftar tetapi tidak aktif", () => {
    expect(listActiveConsents().map((e) => e.code)).toEqual(["CONNECT_META", "CONNECT_TIKTOK"]);
    expect(getConsentEntry("CONNECT_X")?.active).toBe(false);
    expect(getConsentEntry("MARKETING_COMMS")?.active).toBe(false);
    expect(getConsentEntry("ANALYTICS_TELEMETRY")?.active).toBe(false);
    expect(getConsentEntry("NOPE")).toBeNull();
  });
  it("kode unik, versi bilangan bulat, tanpa bundel", () => {
    expect(new Set(CONSENT_CATALOG.map((e) => e.code)).size).toBe(CONSENT_CATALOG.length);
    for (const e of CONSENT_CATALOG) expect(Number.isInteger(e.version) && e.version >= 1).toBe(true);
  });
  it("teks UI tanpa klaim terlarang (immutable, independen, SLA, angka tahun/waktu)", () => {
    const all = [...CONSENT_CATALOG.flatMap((e) => [e.text, e.title, e.purpose]), ...Object.values(CONSENT_MESSAGES)].join("\n");
    expect(all).not.toMatch(/immutable|tidak dapat diubah|independen|\bSLA\b|\b(19|20)\d{2}\b|\d+\s*(hari|jam|tahun|bulan)|\bGDPR\b/i);
  });
  it("Terms/Privacy bukan bagian katalog persetujuan PDP", () => {
    expect(CONSENT_CATALOG.some((e) => /TERMS|PRIVACY/.test(e.code))).toBe(false);
  });
  it("kode koneksi per platform", () => {
    expect(connectConsentCode("META")).toBe("CONNECT_META");
    expect(connectConsentCode("TIKTOK")).toBe("CONNECT_TIKTOK");
    expect(connectConsentCode("X")).toBe("CONNECT_X");
    expect(connectConsentCode("OTHER")).toBeNull();
  });
});

describe("requireConsent", () => {
  const rpcOk = (data: unknown) => vi.fn(async () => ({ data, error: null }));

  it("enforcement MATI: allowed tanpa menyentuh klien atau database (perilaku identik dengan sebelum Paket 3)", async () => {
    vi.stubEnv("CONSENT_ENFORCEMENT_ENABLED", "");
    const getClient = vi.fn();
    expect(await requireConsent("CONNECT_META", "u1", "t1", { getClient })).toEqual({ allowed: true, reason: "ENFORCEMENT_OFF" });
    expect(await requireConsent("CONNECT_X", "u1", "t1", { getClient })).toEqual({ allowed: true, reason: "ENFORCEMENT_OFF" });
    expect(await consentGateMessage("CONNECT_META", "u1", "t1", { getClient })).toBeNull();
    expect(getClient).not.toHaveBeenCalled();
  });

  it("enforcement HIDUP: GRANTED lolos, memanggil fn_prompter_consent_check_tenant dengan user id dan tenant dari sesi server", async () => {
    const rpc = rpcOk({ consented: true, reason: "GRANTED" });
    const d = await requireConsent("CONNECT_META", "u1", "t1", { isEnabled: () => true, getClient: async () => ({ rpc }) });
    expect(d).toEqual({ allowed: true, reason: "GRANTED" });
    expect(rpc).toHaveBeenCalledWith("fn_prompter_consent_check_tenant", { p_user_id: "u1", p_code: "CONNECT_META", p_tenant_id: "t1" });
  });

  it.each(["NO_RECORD", "WITHDRAWN", "VERSION_OUTDATED", "NOT_IN_TENANT", "GRANTOR_NOT_OWNER"])("enforcement HIDUP: %s ditolak (koneksi lama tanpa catatan tidak dianggap setuju)", async (reason) => {
    const d = await requireConsent("CONNECT_META", "u1", "t1", { isEnabled: () => true, getClient: async () => ({ rpc: rpcOk({ consented: false, reason }) }) });
    expect(d).toEqual({ allowed: false, reason });
    expect(await consentGateMessage("CONNECT_META", "u1", "t1", { isEnabled: () => true, getClient: async () => ({ rpc: rpcOk({ consented: false, reason }) }) })).toBe(CONSENT_MESSAGES.required);
  });

  it("fail-closed: galat rpc, exception, tanpa klien, timeout, data aneh, user kosong, kode tidak aktif/tidak dikenal", async () => {
    const on = { isEnabled: () => true };
    expect((await requireConsent("CONNECT_META", "u1", "t1", { ...on, getClient: async () => ({ rpc: vi.fn(async () => ({ data: null, error: { message: "x" } })) }) })).allowed).toBe(false);
    expect((await requireConsent("CONNECT_META", "u1", "t1", { ...on, getClient: async () => ({ rpc: vi.fn(async () => { throw new Error("boom"); }) }) })).allowed).toBe(false);
    expect(await requireConsent("CONNECT_META", "u1", "t1", { ...on, getClient: async () => null })).toEqual({ allowed: false, reason: "NO_CLIENT" });
    expect(await requireConsent("CONNECT_META", "u1", "t1", { ...on, getClient: async () => { throw new Error("x"); } })).toEqual({ allowed: false, reason: "CHECK_FAILED" });
    expect((await requireConsent("CONNECT_META", "u1", "t1", { ...on, timeoutMs: 5, getClient: async () => ({ rpc: () => new Promise(() => {}) }) })).reason).toBe("CHECK_FAILED");
    expect((await requireConsent("CONNECT_META", "u1", "t1", { ...on, getClient: async () => ({ rpc: rpcOk("aneh") }) })).allowed).toBe(false);
    expect((await requireConsent("CONNECT_META", "", "t1", { ...on, getClient: async () => ({ rpc: rpcOk({ consented: true }) }) })).allowed).toBe(false);
    expect(await requireConsent("CONNECT_X", "u1", "t1", { ...on, getClient: async () => ({ rpc: rpcOk({ consented: true }) }) })).toEqual({ allowed: false, reason: "INACTIVE_CODE" });
    expect(await requireConsent("BUKAN_KODE" as never, "u1", "t1", on)).toEqual({ allowed: false, reason: "UNKNOWN_CODE" });
  });
});

describe("requireConsent: persetujuan koneksi milik TENANT (Owner, Opsi A)", () => {
  const on = { isEnabled: () => true };
  it("tanpa tenantId (null/kosong): ditolak fail-closed TANPA memanggil database", async () => {
    const getClient = vi.fn();
    expect(await requireConsent("CONNECT_META", "u1", null, { ...on, getClient })).toEqual({ allowed: false, reason: "CHECK_FAILED" });
    expect(await requireConsent("CONNECT_META", "u1", "", { ...on, getClient })).toEqual({ allowed: false, reason: "CHECK_FAILED" });
    expect(getClient).not.toHaveBeenCalled();
  });
  it("enforcement MATI: tenantId null tetap no-op (perilaku sebelum Paket 3)", async () => {
    const getClient = vi.fn();
    expect(await requireConsent("CONNECT_META", "u1", null, { isEnabled: () => false, getClient })).toEqual({ allowed: true, reason: "ENFORCEMENT_OFF" });
    expect(getClient).not.toHaveBeenCalled();
  });
  it("persetujuan Owner tenant lain / pemberi bukan lagi Owner: alasan dari database diteruskan sebagai penolakan", async () => {
    for (const reason of ["NOT_IN_TENANT", "GRANTOR_NOT_OWNER"] as const) {
      expect(await requireConsent("CONNECT_META", "u1", "t-lain", { ...on, getClient: async () => ({ rpc: rpcOk({ consented: false, reason }) }) })).toEqual({ allowed: false, reason });
    }
  });
  it("argumen RPC memakai tenant dari sesi, bukan dari input lain", async () => {
    const rpc = rpcOk({ consented: true, reason: "GRANTED" });
    await requireConsent("CONNECT_TIKTOK", "u9", "tenant-9", { ...on, getClient: async () => ({ rpc }) });
    expect(rpc).toHaveBeenCalledWith("fn_prompter_consent_check_tenant", { p_user_id: "u9", p_code: "CONNECT_TIKTOK", p_tenant_id: "tenant-9" });
  });
});

describe("recordSignupLegal (fail-open, tanpa PII di log)", () => {
  it("mencatat dengan versi dari konstanta kode (bukan input klien)", async () => {
    const rpc = vi.fn(async () => ({ data: {}, error: null }));
    expect(await recordSignupLegal("user-1", { privacyNoticeDelivered: true }, { getClient: async () => ({ rpc }) })).toBe(true);
    expect(rpc).toHaveBeenCalledWith("fn_prompter_record_signup_legal", { p_user_id: "user-1", p_terms_version: TERMS_VERSION, p_privacy_version: PRIVACY_NOTICE_VERSION });
  });
  it("versi Privacy Notice TIDAK dikirim: p_privacy_version = null (DELIVERED tidak dicatat), Terms tetap dikirim", async () => {
    const rpc = vi.fn(async () => ({ data: {}, error: null }));
    expect(await recordSignupLegal("user-1", { privacyNoticeDelivered: false }, { getClient: async () => ({ rpc }) })).toBe(true);
    expect(rpc).toHaveBeenCalledWith("fn_prompter_record_signup_legal", { p_user_id: "user-1", p_terms_version: TERMS_VERSION, p_privacy_version: null });
  });
  it("kegagalan (galat, exception, tanpa klien) tidak melempar dan log hanya berisi nama tahap", async () => {
    const log = vi.fn();
    expect(await recordSignupLegal("user-secret-id", { privacyNoticeDelivered: true }, { getClient: async () => ({ rpc: async () => ({ data: null, error: { message: "mail@x.test" } }) }), logFailure: log })).toBe(false);
    expect(await recordSignupLegal("user-secret-id", { privacyNoticeDelivered: true }, { getClient: async () => { throw new Error("mail@x.test"); }, logFailure: log })).toBe(false);
    expect(await recordSignupLegal("user-secret-id", { privacyNoticeDelivered: true }, { getClient: async () => null, logFailure: log })).toBe(false);
    expect(log.mock.calls.map((c) => c[0])).toEqual(["rpc_error", "exception", "no_client"]);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret|@/);
  });
  it("timeout: RPC yang menggantung dilepas (fail-open, log 'timeout') dan tidak menahan pendaftaran", async () => {
    const log = vi.fn();
    const t0 = Date.now();
    expect(await recordSignupLegal("u", { privacyNoticeDelivered: true }, { timeoutMs: 20, getClient: async () => ({ rpc: () => new Promise(() => {}) }), logFailure: log })).toBe(false);
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(log).toHaveBeenCalledWith("timeout");
  });
  it("Terms dan Privacy punya konstanta versi terpisah", () => {
    expect(Number.isInteger(TERMS_VERSION)).toBe(true);
    expect(Number.isInteger(PRIVACY_NOTICE_VERSION)).toBe(true);
  });
});

describe("view model", () => {
  it("tanggal Indonesia pada zona waktu pengguna", () => {
    expect(formatIndonesianDate("2026-12-03T10:00:00Z", "Asia/Jakarta")).toBe("3 Desember 2026");
    expect(formatIndonesianDate("2026-12-03T20:00:00Z", "Asia/Jakarta")).toBe("4 Desember 2026");
    expect(formatIndonesianDate("2026-12-03T10:00:00Z", "Zona/Tidak-Ada")).toBe("3 Desember 2026");
    expect(formatIndonesianDate("bukan-tanggal", "Asia/Jakarta")).toBe("");
  });
  it("label status berupa teks", () => {
    expect(statusLabel("GRANTED", null, "Asia/Jakarta")).toBe("Aktif");
    expect(statusLabel("NOT_GIVEN", null, "Asia/Jakarta")).toBe("Belum diberikan");
    expect(statusLabel("WITHDRAWN", "2026-12-03T10:00:00Z", "Asia/Jakarta")).toBe("Ditarik pada 3 Desember 2026");
    expect(statusLabel("OUTDATED", null, "Asia/Jakarta")).toBe("Perlu persetujuan ulang");
  });
  it("baris tidak valid, kode nonaktif, dan bentuk aneh dibuang", () => {
    const items = buildConsentItems(
      [
        { code: "CONNECT_META", status: "GRANTED", occurred_at: "2026-12-03T10:00:00Z" },
        { code: "MARKETING_COMMS", status: "GRANTED", occurred_at: null },
        { code: "CONNECT_TIKTOK", status: "RAHASIA", occurred_at: null },
        { code: 5, status: "GRANTED" },
        null,
      ],
      "Asia/Jakarta",
    );
    expect(items.map((i) => i.code)).toEqual(["CONNECT_META"]);
    expect(buildConsentItems("x", "Asia/Jakarta")).toEqual([]);
  });
});
