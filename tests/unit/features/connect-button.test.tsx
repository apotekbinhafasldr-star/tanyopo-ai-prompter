import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";

const { refreshMock, grantMock } = vi.hoisted(() => ({ refreshMock: vi.fn(), grantMock: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock("@/features/consent/actions", () => ({ grantConnectionConsentAction: grantMock }));

import { ConnectButton, ReviewConsentButton, CONSENT_UNREADABLE_NOTE, REVIEW_NOTE } from "@/features/consent/connect-button";

const PATH = "/api/connections/meta/authorize";

function renderConnect(consent: "GRANTED" | "REQUIRED" | "UNREADABLE", variant: "connect" | "reconnect" = "connect") {
  return render(<ConnectButton platform="META" authorizePath={PATH} label={variant === "connect" ? "Hubungkan" : "Sambungkan Ulang"} variant={variant} consent={consent} />);
}

describe("ConnectButton (tabel perilaku 5.3)", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    grantMock.mockReset();
    grantMock.mockResolvedValue({ error: null });
  });
  afterEach(() => cleanup());

  it("render server (SSR) = tautan <a href> ke OAuth, tanpa dialog (peningkatan progresif)", () => {
    const html = renderToString(<ConnectButton platform="META" authorizePath={PATH} label="Hubungkan" variant="connect" consent="REQUIRED" />);
    expect(html).toContain(`href="${PATH}"`);
    expect(html).toContain("Hubungkan");
    expect(html).not.toContain("<dialog");
  });

  it("persetujuan GRANTED: klik mengikuti tautan (tidak dicegah) dan tidak membuka dialog", () => {
    renderConnect("GRANTED");
    const link = screen.getByRole("link", { name: "Hubungkan" });
    expect(link).toHaveAttribute("href", PATH);
    const notPrevented = fireEvent.click(link);
    expect(notPrevented).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(CONSENT_UNREADABLE_NOTE)).toBeNull();
  });

  it("persetujuan tak terbaca: tautan lama + catatan, tanpa menyatakan 'belum setuju' dan tanpa dialog", () => {
    renderConnect("UNREADABLE");
    expect(screen.getByText(CONSENT_UNREADABLE_NOTE)).toBeInTheDocument();
    expect(fireEvent.click(screen.getByRole("link", { name: "Hubungkan" }))).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.textContent).not.toMatch(/belum (setuju|memberi)/i);
  });

  it("persetujuan dibutuhkan: klik dicegah dan membuka dialog connect", () => {
    renderConnect("REQUIRED");
    const prevented = !fireEvent.click(screen.getByRole("link", { name: "Hubungkan" }));
    expect(prevented).toBe(true);
    expect(screen.getByRole("dialog", { name: "Hubungkan akun Meta?" })).toBeInTheDocument();
    expect(grantMock).not.toHaveBeenCalled();
  });

  it("varian reconnect membuka dialog yang sama", () => {
    renderConnect("REQUIRED", "reconnect");
    fireEvent.click(screen.getByRole("link", { name: "Sambungkan Ulang" }));
    expect(screen.getByRole("dialog", { name: "Hubungkan akun Meta?" })).toBeInTheDocument();
  });

  it("klik dengan tombol pengubah atau tombol bukan-kiri tetap mengikuti tautan (tab baru)", () => {
    renderConnect("REQUIRED");
    const link = screen.getByRole("link", { name: "Hubungkan" });
    expect(fireEvent.click(link, { ctrlKey: true })).toBe(true);
    expect(fireEvent.click(link, { metaKey: true })).toBe(true);
    expect(fireEvent.click(link, { shiftKey: true })).toBe(true);
    expect(fireEvent.click(link, { button: 1 })).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Batal menutup dialog dan fokus kembali ke tautan pemicu; tidak menyimpan apa pun", () => {
    renderConnect("REQUIRED");
    const link = screen.getByRole("link", { name: "Hubungkan" });
    link.focus();
    fireEvent.click(link);
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(link);
    expect(grantMock).not.toHaveBeenCalled();
  });

  it("tautan memakai ukuran tombol sm (h-11 di HP: target >= 44px)", () => {
    renderConnect("GRANTED");
    expect(screen.getByRole("link", { name: "Hubungkan" })).toHaveClass("h-11");
  });
});

describe("ReviewConsentButton (koneksi lama tanpa persetujuan)", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    grantMock.mockReset();
    grantMock.mockResolvedValue({ error: null });
  });
  afterEach(() => cleanup());

  it("menampilkan catatan dan tombol Tinjau persetujuan; membuka dialog review tanpa OAuth", () => {
    render(<ReviewConsentButton platform="META" titleId="judul-kartu" />);
    expect(screen.getByText(REVIEW_NOTE)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tinjau persetujuan" }));
    expect(screen.getByRole("dialog", { name: "Tinjau persetujuan koneksi Meta" })).toBeInTheDocument();
  });

  it("setelah tersimpan: dialog ditutup, status 'Persetujuan tersimpan.', halaman di-refresh, fokus ke judul kartu", async () => {
    render(
      <>
        <h3 id="judul-kartu" tabIndex={-1}>
          Kartu
        </h3>
        <ReviewConsentButton platform="META" titleId="judul-kartu" />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Tinjau persetujuan" }));
    fireEvent.click(screen.getByRole("button", { name: "Saya setuju" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(grantMock).toHaveBeenCalledWith("META", 1);
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Persetujuan tersimpan.");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Kartu" })));
  });
});
