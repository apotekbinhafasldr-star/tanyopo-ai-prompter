import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MediaUploader } from "@/features/products/media-uploader";

const uploadMock = vi.fn();
const removeMock = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        upload: uploadMock,
        remove: removeMock,
      }),
    },
  }),
}));

const recordProductMediaActionMock = vi.fn();

vi.mock("@/features/products/actions", () => ({
  recordProductMediaAction: (...args: unknown[]) => recordProductMediaActionMock(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

function makeFile(name: string, type: string, sizeBytes?: number): File {
  const file = new File(["fake-bytes"], name, { type });
  if (sizeBytes !== undefined) {
    Object.defineProperty(file, "size", { value: sizeBytes });
  }
  return file;
}

function selectFiles(input: HTMLInputElement, files: File[]) {
  Object.defineProperty(input, "files", { value: files, configurable: true });
  fireEvent.change(input);
}

describe("MediaUploader", () => {
  beforeEach(() => {
    uploadMock.mockReset();
    removeMock.mockReset();
    recordProductMediaActionMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  /**
   * Batch B4 hotfix regression test. Production crashed ("This page
   * couldn't load") because the old implementation sent the raw file
   * through a Server Action, which Next.js rejected outright above a
   * 1MB body — a failure the component's own error handling never got a
   * chance to catch. Now the upload happens directly against Storage
   * from the browser, so any failure (network, RLS, a rejected MIME
   * type/size at the Storage API itself) is a normal awaited rejection
   * this component can catch — this test proves a failed upload renders
   * an inline error and leaves the form mounted, instead of crashing.
   */
  it("shows an inline error and stays mounted when the Storage upload itself fails", async () => {
    uploadMock.mockResolvedValue({ error: { message: "network error" } });

    render(<MediaUploader productId="product-1" tenantId="tenant-1" />);

    const input = screen.getByTestId("product-media-file-input") as HTMLInputElement;
    selectFiles(input, [makeFile("produk.jpg", "image/jpeg")]);
    fireEvent.click(screen.getByRole("button", { name: /unggah/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Foto/video belum berhasil diunggah. Coba lagi.");
    });

    // The component is still rendered (the crash bug tore the whole page
    // down instead) and never reached the metadata-recording step.
    expect(screen.getByTestId("product-media-file-input")).toBeInTheDocument();
    expect(recordProductMediaActionMock).not.toHaveBeenCalled();
  });

  it("records the media and shows success after a successful upload", async () => {
    uploadMock.mockResolvedValue({ error: null });
    recordProductMediaActionMock.mockResolvedValue({ error: null });

    render(<MediaUploader productId="product-1" tenantId="tenant-1" />);

    const input = screen.getByTestId("product-media-file-input") as HTMLInputElement;
    selectFiles(input, [makeFile("produk.jpg", "image/jpeg")]);
    fireEvent.click(screen.getByRole("button", { name: /unggah/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Media berhasil diunggah.");
    });

    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(recordProductMediaActionMock).toHaveBeenCalledWith(
      "product-1",
      expect.stringMatching(/^tenant-1\/product-1\//),
      "IMAGE",
    );
  });

  it("rolls back the uploaded object and shows the server's error when recording the metadata fails", async () => {
    uploadMock.mockResolvedValue({ error: null });
    recordProductMediaActionMock.mockResolvedValue({ error: "Media tidak valid untuk produk ini." });

    render(<MediaUploader productId="product-1" tenantId="tenant-1" />);

    const input = screen.getByTestId("product-media-file-input") as HTMLInputElement;
    selectFiles(input, [makeFile("produk.jpg", "image/jpeg")]);
    fireEvent.click(screen.getByRole("button", { name: /unggah/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Media tidak valid untuk produk ini.");
    });

    expect(removeMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an oversized file client-side before ever calling Storage", async () => {
    render(<MediaUploader productId="product-1" tenantId="tenant-1" />);

    const input = screen.getByTestId("product-media-file-input") as HTMLInputElement;
    selectFiles(input, [makeFile("video-besar.mp4", "video/mp4", 200 * 1024 * 1024)]);
    fireEvent.click(screen.getByRole("button", { name: /unggah/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("File terlalu besar");
    });

    expect(uploadMock).not.toHaveBeenCalled();
  });
});
