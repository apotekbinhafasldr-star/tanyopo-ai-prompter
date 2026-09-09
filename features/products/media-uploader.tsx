"use client";

import { useActionState, useRef } from "react";
import { Upload, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/features/products/actions";

interface UploadState extends ActionState {
  success: boolean;
}

const initialState: UploadState = { error: null, success: false };

export function MediaUploader({
  action,
}: {
  action: (formData: FormData) => Promise<ActionState>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<UploadState, FormData>(async (_prev, formData) => {
    const result = await action(formData);
    if (!result.error) {
      formRef.current?.reset();
      return { error: null, success: true };
    }
    return { error: result.error, success: false };
  }, initialState);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="file"
          name="files"
          multiple
          disabled={pending}
          accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
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
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      {!pending && state.success ? (
        <p role="status" className="flex items-center gap-1.5 text-sm text-success">
          <CheckCircle2 className="size-4" aria-hidden />
          Media berhasil diunggah.
        </p>
      ) : null}
    </form>
  );
}
