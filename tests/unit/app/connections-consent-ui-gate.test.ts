import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Struktur halaman Koneksi di balik CONSENT_UI_ENABLED (kriteria 5.11 butir 2): saat UI MATI jalur lama tidak berubah dan tidak ada
 * pembacaan RPC tambahan. Pembuktian struktural (sumber), bukan rendering halaman penuh (butuh Supabase).
 */
const root = path.resolve(__dirname, "../../..");
const page = readFileSync(path.join(root, "app/(app)/connections/page.tsx"), "utf-8");

describe("/connections: perilaku saat CONSENT_UI_ENABLED MATI tidak berubah", () => {
  it("status persetujuan hanya dibaca bila UI hidup dan pengguna Owner", () => {
    expect(page).toContain('const consentUi = isConsentUiEnabled() && session.role === "owner";');
    expect(page).toContain("const consentStates = consentUi ? await loadConnectConsentStates(supabase) : null;");
    expect(page.match(/loadConnectConsentStates\(/g)).toHaveLength(1);
  });

  it("tautan lama tetap ada sebagai cabang tanpa persetujuan (Hubungkan, Sambungkan Ulang)", () => {
    expect(page).toContain("<a href={info.authorizePath}>Hubungkan</a>");
    expect(page).toContain("<a href={info.authorizePath}>Sambungkan Ulang</a>");
  });

  it("ConnectButton dan ReviewConsentButton hanya dirender di cabang consentState", () => {
    const uses = page.split("\n").filter((l) => /<(ConnectButton|ReviewConsentButton)\b/.test(l));
    expect(uses.length).toBeGreaterThan(0);
    expect(page).toMatch(/consentState && \(platform === "META" \|\| platform === "TIKTOK"\)/);
    expect(page).toContain('consentState === "REQUIRED" && (platform === "META" || platform === "TIKTOK")');
  });

  it("kartu X dan kartu non-Owner tidak mendapat consentState", () => {
    expect(page).toContain('consentState={consentStates && platform !== "X" ? consentStates[platform] : undefined}');
  });

  it("atribut id/tabIndex judul kartu hanya ada bila consentState (DOM lama identik saat UI MATI)", () => {
    expect(page).toContain("{...(consentState ? { id: `connect-card-${platform}-title`, tabIndex: -1 } : {})}");
  });

  it("galat consent_check_failed dan consent_required memakai teks gerbang bersama", () => {
    expect(page).toContain("consent_required: CONSENT_MESSAGES.required");
    expect(page).toContain("consent_check_failed: CONSENT_MESSAGES.gateUnavailable");
  });
});
