import { describe, expect, it } from "vitest";
import { CONSENT_MESSAGES } from "@/lib/consent/catalog";
import { authorizeErrorCode, gateKind, gateMessage, type GateDenyReason } from "@/lib/consent/gate-message";
import { resolveConnectConsentStates } from "@/lib/consent/connect-status";

const OWNER_DENY: GateDenyReason[] = ["NO_RECORD", "WITHDRAWN", "VERSION_OUTDATED", "NOT_IN_TENANT", "GRANTOR_NOT_OWNER", "NOT_TENANT_CODE"];
const CHECK_FAIL: GateDenyReason[] = ["CHECK_FAILED", "NO_CLIENT", "UNKNOWN_CODE", "INACTIVE_CODE"];

describe("gate-message: satu sumber teks gerbang (G1, G1n, G2)", () => {
  it.each(OWNER_DENY)("%s: Owner = G1, bukan Owner = G1n", (reason) => {
    expect(gateKind(reason, true)).toBe("G1");
    expect(gateKind(reason, false)).toBe("G1n");
    expect(gateMessage(reason, true)).toBe(CONSENT_MESSAGES.required);
    expect(gateMessage(reason, false)).toBe(CONSENT_MESSAGES.gateOwnerMissing);
  });

  it.each(CHECK_FAIL)("%s: G2 untuk semua peran, tidak menyuruh memberi persetujuan", (reason) => {
    for (const isOwner of [true, false]) {
      expect(gateKind(reason, isOwner)).toBe("G2");
      expect(gateMessage(reason, isOwner)).toBe(CONSENT_MESSAGES.gateUnavailable);
    }
    expect(CONSENT_MESSAGES.gateUnavailable).not.toMatch(/Buka Privasi|memerlukan persetujuan Anda/);
  });

  it("kode galat rute authorize: alasan pemeriksaan gagal = consent_check_failed, selain itu consent_required", () => {
    for (const r of OWNER_DENY) expect(authorizeErrorCode(r)).toBe("consent_required");
    for (const r of CHECK_FAIL) expect(authorizeErrorCode(r)).toBe("consent_check_failed");
  });

  it("teks G1 menyebut Privasi & Data Saya di Pengaturan, G2 tidak menjanjikan hal yang tidak diuji selain 'tidak ada yang dikirim ke platform'", () => {
    expect(CONSENT_MESSAGES.required).toBe("Fitur ini memerlukan persetujuan Anda. Buka Privasi & Data Saya di Pengaturan untuk mengaturnya.");
    expect(CONSENT_MESSAGES.gateUnavailable).toContain("Tidak ada yang dikirim ke platform.");
    expect(CONSENT_MESSAGES.gateUnavailable).not.toMatch(/Data Anda tidak berubah/);
  });
});

describe("connect-status: keadaan persetujuan koneksi untuk halaman Koneksi", () => {
  const row = (code: string, status: string, version = 1) => ({ code, status, version });

  it("GRANTED hanya bila status GRANTED dan versi database = versi katalog", () => {
    expect(resolveConnectConsentStates([row("CONNECT_META", "GRANTED"), row("CONNECT_TIKTOK", "GRANTED")])).toEqual({ META: "GRANTED", TIKTOK: "GRANTED" });
  });

  it.each(["NOT_GIVEN", "WITHDRAWN", "OUTDATED"])("%s = REQUIRED", (status) => {
    expect(resolveConnectConsentStates([row("CONNECT_META", status), row("CONNECT_TIKTOK", status)])).toEqual({ META: "REQUIRED", TIKTOK: "REQUIRED" });
  });

  it("tak terbaca (bukan array, baris hilang, status aneh) = UNREADABLE, bukan REQUIRED", () => {
    expect(resolveConnectConsentStates(null)).toEqual({ META: "UNREADABLE", TIKTOK: "UNREADABLE" });
    expect(resolveConnectConsentStates("x")).toEqual({ META: "UNREADABLE", TIKTOK: "UNREADABLE" });
    expect(resolveConnectConsentStates([row("CONNECT_META", "GRANTED")])).toEqual({ META: "GRANTED", TIKTOK: "UNREADABLE" });
    expect(resolveConnectConsentStates([row("CONNECT_META", "RAHASIA"), null])).toEqual({ META: "UNREADABLE", TIKTOK: "UNREADABLE" });
  });

  it("drift versi (database != kode) = UNREADABLE, walau GRANTED", () => {
    expect(resolveConnectConsentStates([row("CONNECT_META", "GRANTED", 2), { code: "CONNECT_TIKTOK", status: "GRANTED" }])).toEqual({
      META: "UNREADABLE",
      TIKTOK: "UNREADABLE",
    });
  });
});
