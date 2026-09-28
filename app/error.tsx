"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * P1-2 — Custom error boundary for this route segment. Required by Next.js
 * to be a Client Component. Renders inside the existing root layout
 * (app/layout.tsx already provides <html>/<body> and loads globals.css) —
 * only reached when a rendering error happens below the root layout
 * itself; see global-error.tsx for a failure in the root layout.
 *
 * Never renders error.message, error.stack, error.digest, or any other
 * detail from the thrown error to the user — only a generic Indonesian
 * message. The error object itself is logged to the console for
 * debugging only (visible solely in that engineer's/user's own browser
 * console, never sent anywhere or shown in the page).
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-1 items-center justify-center p-8">
      <EmptyState
        icon={AlertTriangle}
        title="Terjadi kesalahan"
        description="Maaf, terjadi kesalahan saat memuat halaman ini. Silakan coba lagi."
        action={
          <Button onClick={reset}>Coba Lagi</Button>
        }
      />
    </div>
  );
}
