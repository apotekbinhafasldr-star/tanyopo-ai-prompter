"use client";

import { useActionState, useRef } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActionState } from "@/features/products/actions";

const initialState: ActionState = { error: null };

export function MediaUploader({
  action,
}: {
  action: (formData: FormData) => Promise<ActionState>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(async (_prev: ActionState, formData: FormData) => {
    const result = await action(formData);
    if (!result.error) {
      formRef.current?.reset();
    }
    return result;
  }, initialState);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <input
          type="file"
          name="files"
          multiple
          accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
          className="text-sm text-muted-foreground file:mr-3 file:rounded-[var(--radius-md)] file:border-0 file:bg-surface-muted file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-border"
        />
        <Button type="submit" size="sm" variant="secondary" loading={pending}>
          <Upload />
          Unggah
        </Button>
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
