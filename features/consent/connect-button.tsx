"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConnectConsentDialog } from "@/features/consent/connect-consent-dialog";
import type { ConnectConsentPlatform, ConnectConsentState } from "@/lib/consent/connect-status";

export const CONSENT_UNREADABLE_NOTE = "Status persetujuan belum dapat dibaca.";
export const REVIEW_NOTE = "Koneksi ini dibuat sebelum persetujuan diminta. Tinjau persetujuan Anda.";

/**
 * Pengganti tautan "Hubungkan"/"Sambungkan Ulang" (hanya dipakai bila CONSENT_UI_ENABLED hidup). Rendering di server tetap `<a href>` ke OAuth
 * (peningkatan progresif: tanpa JavaScript, perilaku lama). Dengan JavaScript dan persetujuan yang masih dibutuhkan, klik membuka dialog.
 * Klik dengan tombol pengubah / tab baru tetap mengikuti tautan.
 */
export function ConnectButton({
  platform,
  authorizePath,
  label,
  variant,
  consent,
  appearance = "primary",
}: {
  platform: ConnectConsentPlatform;
  authorizePath: string;
  label: string;
  variant: "connect" | "reconnect";
  consent: ConnectConsentState;
  appearance?: "primary" | "secondary";
}) {
  const [open, setOpen] = React.useState(false);
  const anchorRef = React.useRef<HTMLAnchorElement | null>(null);

  function onClick(event: React.MouseEvent<HTMLAnchorElement>) {
    if (consent !== "REQUIRED") return;
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setOpen(true);
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <a ref={anchorRef} href={authorizePath} onClick={onClick} className={buttonVariants({ variant: appearance, size: "sm" })}>
          {label}
        </a>
        {consent === "UNREADABLE" ? <p className="text-xs text-muted-foreground">{CONSENT_UNREADABLE_NOTE}</p> : null}
      </div>
      {consent === "REQUIRED" && open ? (
        <ConnectConsentDialog
          variant={variant}
          platform={platform}
          authorizePath={authorizePath}
          onClose={() => setOpen(false)}
          returnFocusRef={anchorRef}
        />
      ) : null}
    </>
  );
}

/** Koneksi lama tanpa persetujuan: tinjau tanpa memulai OAuth. */
export function ReviewConsentButton({ platform, titleId }: { platform: ConnectConsentPlatform; titleId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);

  // Setelah sukses, fokus ke judul kartu platform. Efek ini berjalan SETELAH dialog dilepas (yang mengembalikan fokus ke tombol).
  React.useEffect(() => {
    if (done) document.getElementById(titleId)?.focus();
  }, [done, titleId]);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-foreground">{REVIEW_NOTE}</p>
      <div>
        <Button ref={buttonRef} type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
          Tinjau persetujuan
        </Button>
      </div>
      <p role="status" className="text-xs text-success">
        {done ? "Persetujuan tersimpan." : ""}
      </p>
      {open ? (
        <ConnectConsentDialog
          variant="review"
          platform={platform}
          authorizePath=""
          returnFocusRef={buttonRef}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            setDone(true);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
