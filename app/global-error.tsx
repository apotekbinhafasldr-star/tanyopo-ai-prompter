"use client";

import { useEffect } from "react";
import { AlertOctagon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import "./globals.css";

/**
 * P1-2 — Custom global-error boundary. Required by Next.js to be a Client
 * Component, and to render its own <html>/<body> — this replaces the root
 * layout (app/layout.tsx) entirely, which is why it re-imports
 * "./globals.css" directly rather than relying on that layout (the same
 * CSS module Next.js already dedupes at build time, so this stays on the
 * existing LINOE design tokens instead of a new design system). Only
 * reached when the root layout itself fails to render — an ordinary route
 * error is handled by error.tsx instead, one level down.
 *
 * Deliberately skips next/font and next/image here (both used by the
 * normal root layout/logo) to keep this last-resort boundary as small and
 * dependency-free as possible; the system font stack still picks up the
 * existing color/spacing tokens from globals.css.
 *
 * Never renders error.message, error.stack, error.digest, or any other
 * detail from the thrown error to the user — only a generic Indonesian
 * message. The error object itself is logged to the console for
 * debugging only.
 */
export default function GlobalError({
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
    <html lang="id">
      <body className="min-h-full flex flex-col antialiased">
        <div className="flex min-h-screen flex-1 items-center justify-center p-8">
          <EmptyState
            icon={AlertOctagon}
            title="LINOE mengalami kendala"
            description="Maaf, terjadi kesalahan yang tidak terduga. Silakan coba muat ulang halaman."
            action={<Button onClick={reset}>Muat Ulang</Button>}
          />
        </div>
      </body>
    </html>
  );
}
