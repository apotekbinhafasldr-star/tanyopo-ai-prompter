"use client";

import { useEffect, useId, useRef, useState, useTransition, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Upload, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { recordProductMediaAction } from "@/features/products/actions";
import { ALLOWED_PRODUCT_MEDIA_TYPES, MAX_PRODUCT_MEDIA_BYTES } from "@/schemas/products";
import {
  UPLOAD_ERROR_MESSAGES,
  buildRandomMediaPath,
  validateInputFile,
} from "@/lib/media/media-upload-validation";
import { reencodeImageStrippingMetadata } from "@/lib/media/strip-image-metadata";

const GENERIC_UPLOAD_ERROR = "Foto/video belum berhasil diunggah. Coba lagi.";

const HARDENED_HELP_TEXT = "Foto besar akan diperkecil otomatis; hasil akhir maks. 8 MB.";
const ACK_HINT_TEXT = "Centang pernyataan di bawah ini untuk mengaktifkan tombol Unggah.";
const ACK_LABEL_TEXT = "Saya menyatakan berhak mengunggah foto ini dan foto ini tidak melanggar hak pihak lain.";

/**
 * Batch B4 hotfix. Uploads straight from the browser to the `product-media`
 * Storage bucket (lib/supabase/client.ts — anon/publishable key only,
 * never service-role; the existing tenant-scoped storage.objects RLS
 * policy is what actually enforces isolation, same as every server-side
 * write already relied on it) instead of sending the file through a
 * Server Action. Next.js caps a Server Action's own request body at 1MB
 * by default, which every real product photo exceeds — routing the bytes
 * around that Server Action entirely, rather than raising a global
 * limit, is the fix. Only the resulting storage path (a few bytes) is
 * sent server-side, to recordProductMediaAction, to write the metadata
 * row. Every failure path here is caught locally and shown inline —
 * never left to bubble up and crash the page.
 *
 * Paket 2 L2: prop `hardened` (dari flag server MEDIA_UPLOAD_HARDENING_ENABLED, default MATI). Bila false,
 * perilaku identik dengan sebelumnya. Bila true: hanya foto JPG/PNG/WebP, batas masukan 25 MB, foto di-encode
 * ulang di peramban (EXIF dibuang, WebP menjadi JPEG, hasil maks. 8 MB), nama berkas acak, dan pernyataan hak
 * unggah wajib dicentang. BUKAN batas keamanan (lihat docs/MEDIA_UPLOAD_HARDENING.md).
 */
export function MediaUploader({
  productId,
  tenantId,
  hardened = false,
}: {
  productId: string;
  tenantId: string;
  hardened?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [ack, setAck] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [previews, setPreviews] = useState<{ url: string; name: string }[]>([]);
  const hintId = useId();

  // Pratinjau hanya pada mode diperkeras. URL objek dilepas saat daftar berganti atau komponen dilepas.
  useEffect(() => {
    return () => {
      for (const p of previews) {
        try {
          URL.revokeObjectURL(p.url);
        } catch {
          // lingkungan tanpa URL.revokeObjectURL
        }
      }
    };
  }, [previews]);

  function handleHardenedChange(event: ChangeEvent<HTMLInputElement>) {
    const next: { url: string; name: string }[] = [];
    if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      for (const f of Array.from(event.target.files ?? [])) {
        if (!f.type.startsWith("image/")) continue;
        try {
          next.push({ url: URL.createObjectURL(f), name: f.name });
        } catch {
          // pratinjau opsional
        }
      }
    }
    setPreviews(next);
    setSuccess(false);
    setError(null);
  }

  function handleHardenedSubmit(files: File[]) {
    // Validasi per berkas lebih dulu (format, lalu 25 MB), sebelum apa pun diproses atau diunggah.
    for (const file of files) {
      const check = validateInputFile(file);
      if (!check.ok) {
        setError(check.message);
        return;
      }
    }

    setError(null);
    setSuccess(false);

    startTransition(async () => {
      const supabase = createClient();
      let succeeded = 0;

      // Berhenti di kegagalan pertama. Bila sebagian sudah berhasil: segarkan daftar media, laporkan "N berhasil,
      // M gagal", dan buang yang berhasil dari pilihan agar coba ulang tidak mengunggah ganda.
      function stopWithError(message: string) {
        setProgress(null);
        if (succeeded > 0) {
          const failed = files.length - succeeded;
          setError(`${succeeded} foto berhasil, ${failed} gagal. ${message}`);
          keepOnlyFiles(files.slice(succeeded));
          router.refresh();
        } else {
          setError(message);
        }
      }

      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        const check = validateInputFile(file);
        if (!check.ok) {
          stopWithError(check.message);
          return;
        }

        setProgress(`Memproses foto ${index + 1} dari ${files.length}...`);
        const encoded = await reencodeImageStrippingMetadata(file, check.mime);
        if (!encoded.ok) {
          stopWithError(UPLOAD_ERROR_MESSAGES[encoded.code]);
          return;
        }

        const path = buildRandomMediaPath(tenantId, productId, encoded.mime);
        setProgress(`Mengunggah foto ${index + 1} dari ${files.length}...`);

        let failure: string | null = null;
        let rollbackPath = false;
        try {
          const { error: uploadError } = await supabase.storage
            .from("product-media")
            .upload(path, encoded.blob, { contentType: encoded.mime, upsert: false });

          if (uploadError) {
            failure = UPLOAD_ERROR_MESSAGES.UPLOAD_FAILED;
          } else {
            const result = await recordProductMediaAction(productId, path, "IMAGE");
            if (result.error) {
              failure = result.error;
              rollbackPath = true;
            }
          }
        } catch {
          // Hasil action tidak diketahui (jaringan putus): objek TIDAK dihapus agar tidak merusak baris yang
          // mungkin sudah tercatat. Pengguna cukup mencoba lagi.
          failure = UPLOAD_ERROR_MESSAGES.UPLOAD_FAILED;
        }

        if (failure) {
          if (rollbackPath) {
            // Di luar try di atas agar galat penghapusan tidak menimpa pesan sebab yang sebenarnya.
            try {
              await supabase.storage.from("product-media").remove([path]);
            } catch {
              // upaya terbaik
            }
          }
          stopWithError(failure);
          return;
        }
        succeeded++;
      }

      formRef.current?.reset();
      setPreviews([]);
      setAck(false);
      setProgress(null);
      setSuccess(true);
      router.refresh();
    });
  }

  /** Menyisakan hanya berkas yang belum terunggah pada input dan pratinjau (DataTransfer; bila tak ada, input dikosongkan). */
  function keepOnlyFiles(remaining: File[]) {
    const input = formRef.current?.elements.namedItem("files");
    if (!(input instanceof HTMLInputElement)) return;
    try {
      const dt = new DataTransfer();
      for (const f of remaining) dt.items.add(f);
      input.files = dt.files;
      if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
        setPreviews(remaining.map((f) => ({ url: URL.createObjectURL(f), name: f.name })));
      } else {
        setPreviews([]);
      }
    } catch {
      try {
        input.value = "";
      } catch {
        // abaikan
      }
      setPreviews([]);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const input = formRef.current?.elements.namedItem("files");
    const files = Array.from(input instanceof HTMLInputElement ? (input.files ?? []) : []).filter(
      (f) => f.size > 0,
    );

    if (files.length === 0) {
      setError("Pilih minimal satu file.");
      return;
    }

    if (hardened) {
      if (!ack) return;
      handleHardenedSubmit(files);
      return;
    }

    for (const file of files) {
      if (!ALLOWED_PRODUCT_MEDIA_TYPES.includes(file.type)) {
        setError(`Tipe file tidak didukung: ${file.type || file.name}`);
        return;
      }
      if (file.size > MAX_PRODUCT_MEDIA_BYTES) {
        setError(`File terlalu besar: ${file.name}`);
        return;
      }
    }

    setError(null);
    setSuccess(false);

    startTransition(async () => {
      const supabase = createClient();

      for (const file of files) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${tenantId}/${productId}/${Date.now()}-${safeName}`;

        try {
          const { error: uploadError } = await supabase.storage
            .from("product-media")
            .upload(path, file, { contentType: file.type, upsert: false });

          if (uploadError) {
            setError(GENERIC_UPLOAD_ERROR);
            return;
          }

          const mediaType = file.type.startsWith("video") ? "VIDEO" : "IMAGE";
          const result = await recordProductMediaAction(productId, path, mediaType);

          if (result.error) {
            // Roll back the orphaned object rather than leaving an
            // unreferenced file sitting in the bucket.
            await supabase.storage.from("product-media").remove([path]);
            setError(result.error);
            return;
          }
        } catch {
          setError(GENERIC_UPLOAD_ERROR);
          return;
        }
      }

      formRef.current?.reset();
      setSuccess(true);
      // Direct client call, not <form action>, so Next won't auto-refresh
      // this page's server-rendered media grid on its own.
      router.refresh();
    });
  }

  if (hardened) {
    const ackBlocked = !ack && !pending;
    return (
      <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
        <input
          type="file"
          name="files"
          multiple
          disabled={pending}
          onChange={handleHardenedChange}
          accept="image/jpeg,image/png,image/webp"
          data-testid="product-media-file-input"
          className="min-h-11 w-full min-w-0 text-sm text-muted-foreground file:mr-3 file:min-h-11 file:rounded-[var(--radius-md)] file:border-0 file:bg-surface-muted file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground hover:file:bg-border disabled:opacity-60"
        />
        <p className="text-xs text-muted-foreground">{HARDENED_HELP_TEXT}</p>
        <p className="text-xs text-muted-foreground">Format: JPG, PNG, WebP. Maks. 25 MB per foto sebelum diperkecil.</p>
        <p className="text-xs text-muted-foreground">Video belum bisa diunggah saat mode ini aktif.</p>
        {previews.length > 0 ? (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="product-media-previews">
            {previews.map((p) => (
              <li key={p.url} className="aspect-square overflow-hidden rounded-[var(--radius-md)] bg-surface-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={`Pratinjau ${p.name}`} className="h-full w-full object-cover" />
              </li>
            ))}
          </ul>
        ) : null}
        {ackBlocked ? (
          <p id={hintId} className="text-xs text-muted-foreground">
            {ACK_HINT_TEXT}
          </p>
        ) : null}
        <label className="flex min-h-11 items-start gap-3 py-2 text-sm text-foreground">
          <input
            type="checkbox"
            name="rightsAck"
            checked={ack}
            disabled={pending}
            onChange={(e) => setAck(e.target.checked)}
            className="mt-0.5 size-5 shrink-0"
          />
          <span>{ACK_LABEL_TEXT}</span>
        </label>
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          loading={pending}
          disabled={!ack}
          aria-describedby={ackBlocked ? hintId : undefined}
          className="min-h-11 w-full sm:w-auto sm:self-start"
        >
          <Upload />
          {pending ? "Mengunggah..." : "Unggah"}
        </Button>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <div role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {pending && progress ? progress : null}
          {!pending && success ? (
            <span className="flex items-center gap-1.5 text-success">
              <CheckCircle2 className="size-4" aria-hidden />
              Media berhasil diunggah.
            </span>
          ) : null}
        </div>
      </form>
    );
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="file"
          name="files"
          multiple
          disabled={pending}
          accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
          data-testid="product-media-file-input"
          className="min-w-0 flex-1 text-sm text-muted-foreground file:mr-3 file:rounded-[var(--radius-md)] file:border-0 file:bg-surface-muted file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground hover:file:bg-border disabled:opacity-60"
        />
        <Button type="submit" size="sm" variant="secondary" loading={pending} className="min-h-11 shrink-0">
          <Upload />
          {pending ? "Mengunggah..." : "Unggah"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Format: JPG, PNG, WebP, MP4, MOV. Maks. 100MB per file.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {!pending && success ? (
        <p role="status" className="flex items-center gap-1.5 text-sm text-success">
          <CheckCircle2 className="size-4" aria-hidden />
          Media berhasil diunggah.
        </p>
      ) : null}
    </form>
  );
}
