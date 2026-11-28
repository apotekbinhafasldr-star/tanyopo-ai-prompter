import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { grantMock } = vi.hoisted(() => ({ grantMock: vi.fn() }));
vi.mock("@/features/consent/actions", () => ({ grantConnectionConsentAction: grantMock }));

import { ConnectConsentDialog, type ConnectDialogVariant } from "@/features/consent/connect-consent-dialog";
import { CONSENT_CATALOG, CONSENT_MESSAGES } from "@/lib/consent/catalog";

const metaText = CONSENT_CATALOG.find((e) => e.code === "CONNECT_META")!.text;
const tiktokText = CONSENT_CATALOG.find((e) => e.code === "CONNECT_TIKTOK")!.text;

function setup(opts: { variant?: ConnectDialogVariant; platform?: "META" | "TIKTOK" } = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const navigate = vi.fn();
  const utils = render(
    <ConnectConsentDialog variant={opts.variant ?? "connect"} platform={opts.platform ?? "META"} authorizePath="/api/connections/meta/authorize" onClose={onClose} onSaved={onSaved} navigate={navigate} />,
  );
  return { ...utils, onClose, onSaved, navigate };
}

describe("ConnectConsentDialog", () => {
  beforeEach(() => {
    grantMock.mockReset();
    grantMock.mockResolvedValue({ error: null, info: CONSENT_MESSAGES.saved });
  });
  afterEach(() => cleanup());

  it("teks persetujuan = katalog APA ADANYA + 'Persetujuan versi 1'; tanpa kotak centang", () => {
    const { container } = setup();
    expect(screen.getByText(metaText)).toBeInTheDocument();
    expect(screen.getByText("Persetujuan versi 1")).toBeInTheDocument();
    expect(container.ownerDocument.querySelectorAll('input[type="checkbox"], [role="checkbox"], [role="switch"]').length).toBe(0);
  });

  it("TikTok memakai teks TikTok dan label TikTok", () => {
    setup({ platform: "TIKTOK" });
    expect(screen.getByRole("dialog", { name: "Hubungkan akun TikTok?" })).toBeInTheDocument();
    expect(screen.getByText(tiktokText)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Setuju dan lanjut ke TikTok" })).toBeInTheDocument();
  });

  it("varian connect: judul, pengantar, empat butir, tautan Kebijakan Privasi tab baru, dua tombol", () => {
    setup();
    const dialog = screen.getByRole("dialog", { name: "Hubungkan akun Meta?" });
    expect(dialog).toHaveAccessibleDescription(/Anda yang memutuskan\. Bila Anda menolak, fitur lain di LINOE tetap berjalan; hanya koneksi Meta yang tidak dibuat\./);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText("Izin rinci dipilih dan ditampilkan oleh Meta pada layar berikutnya.")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Baca Kebijakan Privasi/ });
    expect(link).toHaveAttribute("href", "/privacy");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveClass("min-h-11");
    expect(link).toHaveTextContent("(dibuka di tab baru)");
    expect(screen.getByRole("button", { name: "Setuju dan lanjut ke Meta" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Batal" })).toBeInTheDocument();
  });

  it("varian reconnect memakai judul dan tombol yang sama dengan connect", () => {
    setup({ variant: "reconnect" });
    expect(screen.getByRole("dialog", { name: "Hubungkan akun Meta?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Setuju dan lanjut ke Meta" })).toBeInTheDocument();
  });

  it("varian review: judul, pengantar, tanpa butir izin rinci, tombol 'Saya setuju'", () => {
    setup({ variant: "review" });
    expect(screen.getByRole("dialog", { name: "Tinjau persetujuan koneksi Meta" })).toHaveAccessibleDescription(/Koneksi Meta Anda sudah ada/);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByText(/Izin rinci dipilih/)).toBeNull();
    expect(screen.getByRole("button", { name: "Saya setuju" })).toBeInTheDocument();
  });

  it("tombol aksi >= 44px dan membungkus label panjang (whitespace-normal, h-auto, min-h-11)", () => {
    setup();
    for (const name of ["Setuju dan lanjut ke Meta", "Batal"]) {
      const b = screen.getByRole("button", { name });
      expect(b).toHaveClass("min-h-11", "h-auto", "whitespace-normal", "w-full");
    }
  });

  it("Batal, Tutup, Esc, dan latar tidak memanggil server", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    fireEvent.click(screen.getByRole("button", { name: "Tutup" }));
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(4);
    expect(grantMock).not.toHaveBeenCalled();
  });

  it("Setuju memanggil aksi tepat sekali dengan platform dan versi yang ditampilkan; klik ganda tidak menggandakan; navigasi setelah error null", async () => {
    let resolve!: (v: { error: null }) => void;
    grantMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const { navigate } = setup();
    const primary = screen.getByRole("button", { name: "Setuju dan lanjut ke Meta" });
    fireEvent.click(primary);
    fireEvent.click(primary);
    expect(grantMock).toHaveBeenCalledTimes(1);
    expect(grantMock).toHaveBeenCalledWith("META", 1);
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Menyimpan pilihan Anda...");
    expect(primary).toBeDisabled();
    expect(primary).toHaveAttribute("aria-disabled", "true");
    resolve({ error: null });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/api/connections/meta/authorize"));
    expect(screen.getByRole("status")).toHaveTextContent("Persetujuan tersimpan. Mengarahkan ke Meta...");
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["saveFailed", CONSENT_MESSAGES.saveFailed],
    ["tooMany", CONSENT_MESSAGES.tooMany],
    ["ownerOnly", CONSENT_MESSAGES.ownerOnly],
    ["staleText", CONSENT_MESSAGES.staleText],
  ])("galat %s: tampil di role=alert, tidak navigasi, tombol aktif lagi, isi dialog tetap", async (_name, message) => {
    grantMock.mockResolvedValue({ error: message });
    const { navigate, onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Setuju dan lanjut ke Meta" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(message));
    expect(navigate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Setuju dan lanjut ke Meta" })).toBeEnabled();
    expect(screen.getByText(metaText)).toBeInTheDocument();
  });

  it("aksi melempar (jaringan): pesan galat jaringan umum, bukan navigasi", async () => {
    grantMock.mockRejectedValue(new Error("down"));
    const { navigate } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Setuju dan lanjut ke Meta" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(CONSENT_MESSAGES.networkError));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("wilayah status dan alert sudah ada di DOM sebelum isi muncul", () => {
    setup();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
  });

  it("varian review: setelah tersimpan memanggil onSaved dan TIDAK menavigasi ke OAuth", async () => {
    const { onSaved, navigate } = setup({ variant: "review" });
    fireEvent.click(screen.getByRole("button", { name: "Saya setuju" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(grantMock).toHaveBeenCalledWith("META", 1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("teks ketiga varian bebas pola terlarang (durasi, SLA, retensi, 'bukti', 'immutable', pasal)", () => {
    const FORBIDDEN = /immutable|tidak dapat diubah|independen|\bDPO\b|\bSLA\b|3x24|\d+\s*(jam|hari|minggu|bulan|tahun)\b|segera|secepatnya|Pasal \d+|PP 33|bukti (persetujuan|penerimaan)|berdasarkan (persetujuan|kontrak)|lokasi server|analitik|pelacak|terenkripsi|aman 100/i;
    for (const variant of ["connect", "reconnect", "review"] as const) {
      const { container, unmount } = setup({ variant });
      expect(container.ownerDocument.body.textContent ?? "").not.toMatch(FORBIDDEN);
      unmount();
    }
  });
});
