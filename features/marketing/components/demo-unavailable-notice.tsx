"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

function Notice() {
  const params = useSearchParams();
  if (params.get("demo") !== "unavailable") return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-16 z-50 mx-auto w-[calc(100%-2rem)] max-w-xl rounded-[var(--radius-md)] border border-border bg-surface p-3 text-center text-sm text-foreground shadow-[var(--shadow-sm)]"
    >
      Demo sedang tidak tersedia saat ini. Silakan coba lagi nanti atau hubungi kami melalui kontak di bagian bawah
      halaman.
    </div>
  );
}

/** Shown only when /api/demo/start redirected here with ?demo=unavailable (demo not configured). */
export function DemoUnavailableNotice() {
  return (
    <Suspense fallback={null}>
      <Notice />
    </Suspense>
  );
}
