"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { grantConnectionConsentAction } from "@/features/consent/actions";
import { CONSENT_MESSAGES, getConsentEntry } from "@/lib/consent/catalog";
import { CONNECT_CONSENT_CODE, type ConnectConsentPlatform } from "@/lib/consent/connect-status";

export type ConnectDialogVariant = "connect" | "reconnect" | "review";

export const PLATFORM_LABEL: Record<ConnectConsentPlatform, string> = { META: "Meta", TIKTOK: "TikTok" };

export interface ConnectConsentDialogProps {
  variant: ConnectDialogVariant;
  platform: ConnectConsentPlatform;
  /** Tujuan OAuth setelah persetujuan tersimpan (varian connect/reconnect). */
  authorizePath: string;
  onClose: () => void;
  /** Varian review: dipanggil setelah persetujuan tersimpan (tanpa OAuth). */
  onSaved?: () => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  /** Hanya untuk pengujian/peningkatan: cara berpindah halaman. Default window.location.assign. */
  navigate?: (url: string) => void;
}

/**
 * Dialog persetujuan koneksi platform (Paket 5a). Teks persetujuan = entri katalog APA ADANYA; versi yang tampil dikirim ke server agar
 * persetujuan tidak menunjuk teks yang tidak dilihat pengguna. Tidak ada kotak centang terpilih-awal, tidak ada timer, tidak ada auto-submit:
 * menutup (Batal, Tutup, Esc, latar) tidak menyimpan apa pun. OAuth dimulai HANYA setelah server mengonfirmasi tersimpan.
 * Persetujuan ini diberikan Owner atas nama dirinya sendiri; dialog bukan lapisan pengaman (pemeriksaan peran ada di server dan database).
 * Komponen ini dipasang HANYA saat dialog dibuka (pemanggil: `{open ? <ConnectConsentDialog /> : null}`), sehingga keadaan selalu bersih.
 */
export function ConnectConsentDialog({ variant, platform, authorizePath, onClose, onSaved, returnFocusRef, navigate }: ConnectConsentDialogProps) {
  const entry = getConsentEntry(CONNECT_CONSENT_CODE[platform]);
  const label = PLATFORM_LABEL[platform];
  const [pending, setPending] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inFlight = React.useRef(false);

  if (!entry || !entry.active) return null;

  async function confirm() {
    if (!entry || inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setPending(true);
    let result: { error: string | null };
    try {
      result = await grantConnectionConsentAction(platform, entry.version);
    } catch {
      result = { error: CONSENT_MESSAGES.networkError };
    }
    if (result.error) {
      inFlight.current = false;
      setPending(false);
      setError(result.error);
      return;
    }
    setSaved(true);
    if (variant === "review") {
      setPending(false);
      inFlight.current = false;
      onSaved?.();
      return;
    }
    // Tombol tetap nonaktif sampai halaman berpindah ke platform.
    (navigate ?? ((url: string) => window.location.assign(url)))(authorizePath);
  }

  const isReview = variant === "review";
  const title = isReview ? `Tinjau persetujuan koneksi ${label}` : `Hubungkan akun ${label}?`;
  const description = isReview
    ? `Koneksi ${label} Anda sudah ada. Tinjau teks di bawah dan putuskan apakah Anda menyetujuinya.`
    : `Anda yang memutuskan. Bila Anda menolak, fitur lain di LINOE tetap berjalan; hanya koneksi ${label} yang tidak dibuat.`;
  const primaryLabel = isReview ? "Saya setuju" : `Setuju dan lanjut ke ${label}`;
  const statusText = pending && !saved ? "Menyimpan pilihan Anda..." : saved ? (isReview ? CONSENT_MESSAGES.saved : `Persetujuan tersimpan. Mengarahkan ke ${label}...`) : "";

  return (
    <SheetDialog
      open
      onClose={onClose}
      title={title}
      description={description}
      busy={pending}
      returnFocusRef={returnFocusRef}
      footer={
        <div className="flex flex-col gap-2">
          {/* Wilayah live sudah ada di DOM sebelum isi muncul; tinggi minimum menahan pergeseran tata letak. */}
          <div role="status" aria-live="polite" className="min-h-5 text-sm text-foreground">
            {statusText}
          </div>
          <div role="alert" className="min-h-0 text-sm font-medium text-danger">
            {error}
          </div>
          <Button
            type="button"
            className="h-auto min-h-11 w-full whitespace-normal py-2 text-center"
            disabled={pending}
            aria-disabled={pending || undefined}
            onClick={confirm}
          >
            {primaryLabel}
          </Button>
          <Button type="button" variant="secondary" className="h-auto min-h-11 w-full whitespace-normal py-2 text-center" disabled={pending} onClick={onClose}>
            Batal
          </Button>
        </div>
      }
    >
      <blockquote className="rounded-[var(--radius-md)] border-l-4 border-brand bg-surface-muted p-3">
        {/* Di atas surface-muted: text-foreground (16,12:1), bukan muted-foreground (4,40:1). */}
        <p className="break-words text-sm text-foreground">{entry.text}</p>
      </blockquote>
      <p className="text-xs text-muted-foreground">Persetujuan versi {entry.version}</p>
      <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-foreground">
        {isReview ? null : <li>Izin rinci dipilih dan ditampilkan oleh {label} pada layar berikutnya.</li>}
        <li>Anda dapat memutus koneksi kapan saja dari halaman Koneksi, dan menarik persetujuan dari Privasi &amp; Data Saya.</li>
        <li>Persetujuan ini Anda berikan atas nama diri sendiri. Persetujuan ini tidak otomatis mewakili orang lain yang datanya ada di akun tersebut.</li>
        <li>Menyetujui Syarat &amp; Ketentuan atau membaca Kebijakan Privasi bukan persetujuan ini; ini persetujuan terpisah.</li>
      </ul>
      <a
        href="/privacy"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center self-start text-sm font-medium text-brand underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        Baca Kebijakan Privasi<span className="sr-only"> (dibuka di tab baru)</span>
      </a>
    </SheetDialog>
  );
}
