"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Upload, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { recordProductMediaAction } from "@/features/products/actions";
import { ALLOWED_PRODUCT_MEDIA_TYPES, MAX_PRODUCT_MEDIA_BYTES } from "@/schemas/products";

const GENERIC_UPLOAD_ERROR = "Foto/video belum berhasil diunggah. Coba lagi.";

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
 */
export function MediaUploader({ productId, tenantId }: { productId: string; tenantId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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
