import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CONSENT_CATALOG, CONSENT_MESSAGES } from "@/lib/consent/catalog";
import { findForbidden, FORBIDDEN_UI } from "./forbidden-ui";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/consent/actions", () => ({ grantConnectionConsentAction: vi.fn(async () => ({ error: "Persetujuan belum tersimpan. Periksa koneksi internet, lalu coba lagi." })) }));

import { ConnectButton, ReviewConsentButton, CONSENT_UNREADABLE_NOTE, REVIEW_NOTE } from "@/features/consent/connect-button";
import { ConnectConsentDialog } from "@/features/consent/connect-consent-dialog";

afterEach(() => cleanup());

describe("pemindai teks terlarang: konstanta Paket 5a", () => {
  it("pola terdaftar dan bukan kosong", () => {
    expect(FORBIDDEN_UI.length).toBeGreaterThan(8);
  });

  it("pemindai sendiri bekerja (kontrol positif)", () => {
    expect(findForbidden("Dibalas dalam 3 hari")).toContain("durasi");
    expect(findForbidden("SLA 48 jam")).toEqual(expect.arrayContaining(["SLA", "durasi"]));
    expect(findForbidden("bukti persetujuan Anda")).toContain("klaim bukti");
    expect(findForbidden("Kami mencatat persetujuan")).toContain("klaim pencatatan");
    expect(findForbidden("Pasal 20")).toContain("pasal/peraturan");
    expect(findForbidden("privacy@contoh.id")).toContain("email kontak karangan");
  });

  it("CONSENT_MESSAGES dan teks katalog aktif bebas pola terlarang", () => {
    for (const [key, text] of Object.entries(CONSENT_MESSAGES)) expect(findForbidden(text), key).toEqual([]);
    for (const e of CONSENT_CATALOG.filter((x) => x.active)) expect(findForbidden(`${e.title} ${e.text} ${e.purpose}`), e.code).toEqual([]);
    expect(findForbidden(`${CONSENT_UNREADABLE_NOTE} ${REVIEW_NOTE}`)).toEqual([]);
  });
});

describe("pemindai teks terlarang: komponen dirender pada semua keadaan", () => {
  const noop = () => {};

  it.each(["META", "TIKTOK"] as const)("dialog %s: connect, reconnect, review, dan keadaan galat", async (platform) => {
    for (const variant of ["connect", "reconnect", "review"] as const) {
      const { unmount } = render(<ConnectConsentDialog variant={variant} platform={platform} authorizePath="/x" onClose={noop} onSaved={noop} navigate={noop} />);
      expect(findForbidden(document.body.textContent ?? ""), `${platform}/${variant}`).toEqual([]);
      fireEvent.click(screen.getByRole("button", { name: /^(Setuju dan lanjut|Saya setuju)/ }));
      const alert = await screen.findByText(/belum tersimpan/);
      expect(alert).toBeInTheDocument();
      expect(findForbidden(document.body.textContent ?? ""), `${platform}/${variant}/galat`).toEqual([]);
      unmount();
    }
  });

  it("ConnectButton (tiga keadaan) dan ReviewConsentButton", () => {
    for (const consent of ["GRANTED", "REQUIRED", "UNREADABLE"] as const) {
      const { unmount } = render(<ConnectButton platform="META" authorizePath="/x" label="Hubungkan" variant="connect" consent={consent} />);
      expect(findForbidden(document.body.textContent ?? ""), consent).toEqual([]);
      unmount();
    }
    render(<ReviewConsentButton platform="TIKTOK" titleId="t" />);
    expect(findForbidden(document.body.textContent ?? "")).toEqual([]);
  });
});
