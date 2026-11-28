"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export interface SheetDialogProps {
  open: boolean;
  /** Dipanggil saat pengguna meminta menutup (Esc, tombol Tutup, klik latar bila diizinkan). Pemanggil yang mengatur `open`. */
  onClose: () => void;
  title: React.ReactNode;
  /** Pengantar singkat; menjadi aria-describedby. */
  description?: React.ReactNode;
  children?: React.ReactNode;
  /** Area aksi menempel di dasar (di luar area gulir). */
  footer?: React.ReactNode;
  /** Klik pada latar menutup dialog. Default true. */
  closeOnBackdrop?: boolean;
  /** Selama true, Esc/latar/Tutup diabaikan (mis. sedang menyimpan). */
  busy?: boolean;
  /** Elemen yang menerima fokus saat dialog ditutup; default elemen yang aktif saat dibuka. */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  className?: string;
}

/**
 * Primitif dialog modal berbasis elemen <dialog> bawaan (showModal): latar di belakang inert dan fokus terkurung oleh browser.
 * Bottom-sheet di layar < 640px, kartu di tengah >= 640px. Fokus awal ke judul; Esc menutup; fokus kembali ke pemicu; gulir body dikunci
 * selama terbuka dan dipulihkan ke nilai sebelumnya. Dirender hanya saat `open`.
 */
export function SheetDialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  closeOnBackdrop = true,
  busy = false,
  returnFocusRef,
  className,
}: SheetDialogProps) {
  const uid = React.useId();
  const titleId = `${uid}-title`;
  const descId = `${uid}-desc`;
  const dialogRef = React.useRef<HTMLDialogElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const returnTarget = returnFocusRef;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!dialog.open) dialog.showModal();
    document.getElementById(titleId)?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- ref dibaca saat ditutup (menunjuk elemen pemicu yang tetap terpasang)
      const target = returnTarget?.current ?? previouslyFocused;
      if (target && target.isConnected) target.focus();
    };
  }, [open, titleId, returnFocusRef]);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(event) => {
        // Esc: tutup lewat state pemanggil, bukan oleh browser, agar keadaan tetap satu sumber.
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        // Padding sengaja 0 pada elemen <dialog>: klik langsung pada elemen ini = klik di latar (::backdrop).
        if (closeOnBackdrop && !busy && event.target === event.currentTarget) onClose();
      }}
      className={cn(
        "m-0 w-full max-w-none flex-col overflow-hidden bg-surface p-0 text-foreground shadow-[var(--shadow-lg)] backdrop:bg-black/50 open:flex",
        "fixed inset-x-0 bottom-0 top-auto max-h-[90dvh] rounded-t-[var(--radius-xl)]",
        "sm:inset-0 sm:m-auto sm:h-fit sm:max-w-md sm:rounded-[var(--radius-lg)]",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2 px-4 pb-2 pt-4">
        <h2 id={titleId} tabIndex={-1} className="min-w-0 break-words text-base font-semibold tracking-tight text-foreground outline-none focus-visible:underline">
          {title}
        </h2>
        <button
          type="button"
          aria-label="Tutup"
          disabled={busy}
          onClick={onClose}
          className="-mr-2 -mt-2 inline-flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-foreground hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-3">
        {description ? (
          <p id={descId} className="text-sm text-foreground">
            {description}
          </p>
        ) : null}
        {children}
      </div>
      {footer ? <div className="border-t border-border bg-surface p-4">{footer}</div> : null}
    </dialog>
  );
}
