import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { refreshMock, withdrawMock, grantMock } = vi.hoisted(() => ({ refreshMock: vi.fn(), withdrawMock: vi.fn(), grantMock: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/features/consent/actions", () => ({ withdrawConsentAction: withdrawMock, grantOptionalConsentAction: grantMock }));

import { ConsentPanel } from "@/features/consent/consent-panel";
import type { ConsentItemView } from "@/lib/consent/view";

const granted: ConsentItemView = { code: "CONNECT_META", title: "Koneksi akun Meta", text: "Teks persetujuan Meta.", kind: "CONNECTION", status: "GRANTED", statusLabel: "Aktif" };
const notGiven: ConsentItemView = { code: "CONNECT_TIKTOK", title: "Koneksi akun TikTok", text: "Teks TikTok.", kind: "CONNECTION", status: "NOT_GIVEN", statusLabel: "Belum diberikan" };
const optional: ConsentItemView = { code: "MARKETING_COMMS", title: "Email pembaruan", text: "Teks email.", kind: "OPTIONAL", status: "NOT_GIVEN", statusLabel: "Belum diberikan" };

describe("ConsentPanel", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    withdrawMock.mockReset();
    grantMock.mockReset();
  });

  it("kosong: pesan 'Belum ada persetujuan opsional'", () => {
    render(<ConsentPanel items={[]} />);
    expect(screen.getByText("Belum ada persetujuan opsional")).toBeInTheDocument();
  });

  it("gagal memuat: alert + tombol Muat ulang yang memanggil refresh", () => {
    render(<ConsentPanel items={[]} loadError />);
    expect(screen.getByRole("alert")).toHaveTextContent("Daftar persetujuan belum dapat dimuat");
    fireEvent.click(screen.getByRole("button", { name: "Muat ulang" }));
    expect(refreshMock).toHaveBeenCalled();
  });

  it("pengantar membedakan Terms/Privacy dari persetujuan di sini; tanpa klaim immutable/independen/SLA/angka tahun", () => {
    const { container } = render(<ConsentPanel items={[granted, notGiven]} />);
    expect(container.textContent).toMatch(/tidak sama dengan memberi persetujuan/);
    expect(container.textContent).not.toMatch(/immutable|independen|\bSLA\b|\b(19|20)\d{2}\b/i);
  });

  it("status berupa teks pada tiap kartu; koneksi belum diberikan = tautan ke halaman Koneksi (tidak ada kotak centang)", () => {
    const { container } = render(<ConsentPanel items={[granted, notGiven]} />);
    expect(screen.getByText("Aktif")).toBeInTheDocument();
    expect(screen.getByText("Belum diberikan")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Buka halaman Koneksi" })).toHaveAttribute("href", "/connections");
    expect(container.querySelectorAll('input[type="checkbox"]').length).toBe(0);
  });

  it("tautan bawah: Kebijakan Privasi dan Penghapusan Data, target sentuh min-h-11", () => {
    render(<ConsentPanel items={[]} />);
    expect(screen.getByRole("link", { name: "Baca Kebijakan Privasi" })).toHaveClass("min-h-11");
    expect(screen.getByRole("link", { name: "Penghapusan Data" })).toHaveAttribute("href", "/data-deletion");
  });

  it("penarikan koneksi: panel konfirmasi inline, fokus awal pada Batal, Batal menutup tanpa memanggil server", () => {
    render(<ConsentPanel items={[granted]} />);
    fireEvent.click(screen.getByRole("button", { name: "Putuskan koneksi" }));
    expect(screen.getByText("Tarik persetujuan ini?")).toBeInTheDocument();
    expect(screen.getByText(/menghapus token akses/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Batal" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    expect(screen.queryByText("Tarik persetujuan ini?")).toBeNull();
    expect(withdrawMock).not.toHaveBeenCalled();
  });

  it("Escape menutup konfirmasi", () => {
    render(<ConsentPanel items={[granted]} />);
    fireEvent.click(screen.getByRole("button", { name: "Putuskan koneksi" }));
    fireEvent.keyDown(screen.getByRole("group"), { key: "Escape" });
    expect(screen.queryByText("Tarik persetujuan ini?")).toBeNull();
  });

  it("konfirmasi 'Ya, tarik persetujuan' memanggil server; sukses = pesan + refresh (tanpa pembaruan optimistis)", async () => {
    withdrawMock.mockResolvedValue({ error: null, info: "Persetujuan ditarik." });
    render(<ConsentPanel items={[granted]} />);
    fireEvent.click(screen.getByRole("button", { name: "Putuskan koneksi" }));
    fireEvent.click(screen.getByRole("button", { name: "Ya, tarik persetujuan" }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(withdrawMock).toHaveBeenCalledWith("CONNECT_META");
    expect(screen.getByText("Persetujuan ditarik.")).toBeInTheDocument();
    expect(screen.getByText("Aktif")).toBeInTheDocument();
  });

  it("galat dari server ditampilkan sebagai alert dan status tidak berubah", async () => {
    withdrawMock.mockResolvedValue({ error: "Penarikan belum berhasil. Status Anda belum berubah. Coba lagi." });
    render(<ConsentPanel items={[granted]} />);
    fireEvent.click(screen.getByRole("button", { name: "Putuskan koneksi" }));
    fireEvent.click(screen.getByRole("button", { name: "Ya, tarik persetujuan" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Penarikan belum berhasil"));
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("sakelar opsional: role=switch, aria-checked, terhubung ke judul dan deskripsi, area sentuh min-h-11", () => {
    render(<ConsentPanel items={[optional]} />);
    const sw = screen.getByRole("switch");
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(sw).toHaveClass("min-h-11");
    expect(sw.getAttribute("aria-labelledby")).toBe("consent-MARKETING_COMMS-title");
    expect(sw.getAttribute("aria-describedby")).toBe("consent-MARKETING_COMMS-desc");
    expect(document.getElementById("consent-MARKETING_COMMS-title")).not.toBeNull();
  });

  it("sakelar opsional: mengaktifkan memanggil server dan baru refresh setelah sukses", async () => {
    grantMock.mockResolvedValue({ error: null, info: "Persetujuan tersimpan." });
    render(<ConsentPanel items={[optional]} />);
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(grantMock).toHaveBeenCalledWith("MARKETING_COMMS");
  });

  it("wilayah status memakai aria-live polite", () => {
    const { container } = render(<ConsentPanel items={[granted]} />);
    expect(container.querySelector('[role="status"][aria-live="polite"]')).not.toBeNull();
  });
});
