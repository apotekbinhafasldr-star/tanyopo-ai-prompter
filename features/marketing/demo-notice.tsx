"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Info } from "lucide-react";

/** Messages for the redirects of app/api/demo/start/route.ts (`/?demo=busy|unavailable`). */
export const DEMO_NOTICE_MESSAGES = {
  busy: {
    title: "Demo sedang ramai",
    body: "Terlalu banyak sesi demo dibuka dari jaringan Anda dalam satu jam terakhir. Silakan coba lagi nanti (paling lama sekitar 1 jam), atau langsung buat akun gratis.",
  },
  unavailable: {
    title: "Demo belum tersedia",
    body: "Demo sedang tidak aktif. Silakan coba lagi nanti, atau langsung buat akun gratis.",
  },
} as const;

/**
 * Small notice on the landing page for `/?demo=busy` and `/?demo=unavailable`. Client component reading the query so the
 * landing page itself stays statically rendered. Unknown values render nothing.
 */
export function DemoNotice() {
  const value = useSearchParams()?.get("demo");
  if (value !== "busy" && value !== "unavailable") return null;
  const message = DEMO_NOTICE_MESSAGES[value];

  return (
    <div role="status" className="border-b border-border bg-brand-muted px-4 py-3 text-sm sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1">
        <Info className="size-4 shrink-0 text-brand" aria-hidden />
        <p className="text-foreground">
          <span className="font-semibold">{message.title}.</span> {message.body}
        </p>
        <Link href="/register" className="font-medium text-brand underline-offset-4 hover:underline">
          Buat akun gratis
        </Link>
      </div>
    </div>
  );
}
