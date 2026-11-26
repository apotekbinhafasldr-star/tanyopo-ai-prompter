import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MediaUploader } from "@/features/products/media-uploader";

const uploadMock = vi.fn();
const removeMock = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ storage: { from: () => ({ upload: uploadMock, remove: removeMock }) } }),
}));

const recordMock = vi.fn();
vi.mock("@/features/products/actions", () => ({
  recordProductMediaAction: (...args: unknown[]) => recordMock(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const reencodeMock = vi.fn();
vi.mock("@/lib/media/strip-image-metadata", () => ({
  reencodeImageStrippingMetadata: (...args: unknown[]) => reencodeMock(...args),
}));

function makeFile(name: string, type: string, size?: number): File {
  const f = new File(["fake-bytes"], name, { type });
  if (size !== undefined) Object.defineProperty(f, "size", { value: size });
  return f;
}
function selectFiles(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, "files", { value: files, configurable: true });
  fireEvent.change(input);
}
const HINT = "Centang pernyataan di bawah ini untuk mengaktifkan tombol Unggah.";
const uploadButton = () => screen.getByRole("button", { name: /unggah/i });
const MB = 1024 * 1024;

describe("MediaUploader hardened (flag AKTIF)", () => {
  beforeEach(() => {
    uploadMock.mockReset();
    removeMock.mockReset();
    recordMock.mockReset();
    reencodeMock.mockReset();
    reencodeMock.mockResolvedValue({ ok: true, blob: new Blob(["x"]), mime: "image/jpeg", width: 10, height: 10 });
  });
  afterEach(() => cleanup());

  it("menampilkan teks bantuan dan hanya menerima foto JPG/PNG/WebP", () => {
    render(<MediaUploader productId="p1" tenantId="t1" hardened />);
    expect(screen.getByText("Foto besar akan diperkecil otomatis; hasil akhir maks. 8 MB.")).toBeInTheDocument();
    const input = screen.getByTestId("product-media-file-input") as HTMLInputElement;
    expect(input.accept).toBe("image/jpeg,image/png,image/webp");
    expect(input.accept).not.toMatch(/video/);
  });

  it("tombol nonaktif sebelum pernyataan dicentang, dengan petunjuk dan aria-describedby ke petunjuk itu", () => {
    render(<MediaUploader productId="p1" tenantId="t1" hardened />);
    const btn = uploadButton();
    expect(btn).toBeDisabled();
    const hint = screen.getByText(HINT);
    expect(hint.id).toBeTruthy();
    expect(btn.getAttribute("aria-describedby")).toBe(hint.id);

    fireEvent.click(screen.getByRole("checkbox"));
    expect(uploadButton()).toBeEnabled();
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
    expect(uploadButton().getAttribute("aria-describedby")).toBeNull();
  });

  it("target sentuh >= 44px (min-h-11), satu kolom, dan wilayah status aria-live", () => {
    render(<MediaUploader productId="p1" tenantId="t1" hardened />);
    expect(uploadButton().className).toMatch(/min-h-11/);
    expect(uploadButton().className).toMatch(/w-full/);
    expect(screen.getByRole("checkbox").closest("label")?.className).toMatch(/min-h-11/);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("unggah sukses: encode ulang, nama acak tanpa nama asli, contentType hasil encode, lalu catat sebagai IMAGE", async () => {
    uploadMock.mockResolvedValue({ error: null });
    recordMock.mockResolvedValue({ error: null });
    render(<MediaUploader productId="p1" tenantId="t1" hardened />);
    selectFiles(screen.getByTestId("product-media-file-input") as HTMLInputElement, [
      makeFile("Foto Rahasia Budi.WEBP", "image/webp", 12 * MB),
    ]);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(uploadButton());

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Media berhasil diunggah."));
    expect(reencodeMock).toHaveBeenCalledWith(expect.any(File), "image/webp");
    const [path, , options] = uploadMock.mock.calls[0];
    expect(path).toMatch(/^t1\/p1\/[0-9a-f-]{36}\.jpg$/);
    expect(path).not.toMatch(/Rahasia|Budi|WEBP/i);
    expect(options).toMatchObject({ contentType: "image/jpeg", upsert: false });
    expect(recordMock).toHaveBeenCalledWith("p1", path, "IMAGE");
  });

  it("berkas 26 MB ditolak dengan pesan khusus tanpa memproses atau mengunggah", async () => {
    render(<MediaUploader productId="p1" tenantId="t1" hardened />);
    selectFiles(screen.getByTestId("product-media-file-input") as HTMLInputElement, [makeFile("a.jpg", "image/jpeg", 26 * MB)]);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(uploadButton());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("25 MB"));
    expect(reencodeMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("HEIC ditolak sebagai format tidak didukung", async () => {
    render(<MediaUploader productId="p1" tenantId="t1" hardened />);
    selectFiles(screen.getByTestId("product-media-file-input") as HTMLInputElement, [makeFile("a.heic", "image/heic", MB)]);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(uploadButton());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/format foto tidak didukung/i));
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it.each([
    ["OUTPUT_TOO_LARGE", /8 MB/],
    ["TOO_MANY_PIXELS", /150 megapiksel/],
    ["BROWSER_UNSUPPORTED", /belum mendukung/],
    ["UNREADABLE", /tidak dapat dibaca/],
  ])("kegagalan encode %s menampilkan pesan sebabnya (role=alert) dan tidak mengunggah", async (code, pattern) => {
    reencodeMock.mockResolvedValue({ ok: false, code });
    render(<MediaUploader productId="p1" tenantId="t1" hardened />);
    selectFiles(screen.getByTestId("product-media-file-input") as HTMLInputElement, [makeFile("a.jpg", "image/jpeg", MB)]);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(uploadButton());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(pattern));
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("gagal unggah/jaringan memakai pesan jaringan, bukan pesan generik lama", async () => {
    uploadMock.mockRejectedValue(new Error("offline"));
    render(<MediaUploader productId="p1" tenantId="t1" hardened />);
    selectFiles(screen.getByTestId("product-media-file-input") as HTMLInputElement, [makeFile("a.jpg", "image/jpeg", MB)]);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(uploadButton());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/koneksi internet/i));
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("galat dari server menghapus objek dan ditampilkan apa adanya", async () => {
    uploadMock.mockResolvedValue({ error: null });
    recordMock.mockResolvedValue({ error: "Batas 20 foto per produk sudah tercapai. Hapus foto yang tidak dipakai, lalu coba lagi." });
    render(<MediaUploader productId="p1" tenantId="t1" hardened />);
    selectFiles(screen.getByTestId("product-media-file-input") as HTMLInputElement, [makeFile("a.jpg", "image/jpeg", MB)]);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(uploadButton());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Batas 20 foto"));
    expect(removeMock).toHaveBeenCalledTimes(1);
  });

  it("menampilkan pratinjau foto terpilih bila URL.createObjectURL tersedia", () => {
    const create = vi.fn(() => "blob:preview-1");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    try {
      render(<MediaUploader productId="p1" tenantId="t1" hardened />);
      selectFiles(screen.getByTestId("product-media-file-input") as HTMLInputElement, [makeFile("a.jpg", "image/jpeg", MB)]);
      expect(screen.getByAltText("Pratinjau a.jpg")).toHaveAttribute("src", "blob:preview-1");
      cleanup();
      expect(revoke).toHaveBeenCalledWith("blob:preview-1");
    } finally {
      delete (URL as unknown as Record<string, unknown>).createObjectURL;
      delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
    }
  });
});

describe("MediaUploader dengan flag MATI (default) tidak berubah", () => {
  afterEach(() => cleanup());

  it.each([[undefined], [false]])("hardened=%s: tanpa teks bantuan baru, tanpa kotak centang, video tetap diterima input", (value) => {
    render(<MediaUploader productId="p1" tenantId="t1" hardened={value} />);
    expect(screen.queryByText(/diperkecil otomatis/)).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(uploadButton()).toBeEnabled();
    expect((screen.getByTestId("product-media-file-input") as HTMLInputElement).accept).toContain("video/mp4");
    expect(screen.getByText("Format: JPG, PNG, WebP, MP4, MOV. Maks. 100MB per file.")).toBeInTheDocument();
  });
});
