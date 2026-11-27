"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { grantOptionalConsentAction, withdrawConsentAction } from "@/features/consent/actions";
import type { ConsentItemView } from "@/lib/consent/view";

const INTRO =
  "Di sini Anda mengatur persetujuan untuk fitur opsional. Menyetujui Syarat & Ketentuan atau membaca Kebijakan Privasi tidak sama dengan memberi persetujuan di halaman ini. Anda bebas menolak; fitur lain tetap berjalan.";

const WITHDRAW_BODY: Record<ConsentItemView["kind"], string> = {
  CONNECTION:
    "LINOE akan berhenti mengakses akun ini dan menghapus token akses dari sistem kami. Pencabutan akses di sisi platform (Meta/TikTok) kami upayakan sebaik mungkin, tetapi tidak dapat dijamin; Anda juga dapat mencabutnya langsung di pengaturan akun platform tersebut. Data kinerja yang sudah diimpor tidak otomatis terhapus; lihat Penghapusan Data. Penarikan tidak memengaruhi pemrosesan yang sudah berlangsung sebelumnya.",
  OPTIONAL: "Anda tidak akan menerima komunikasi opsional ini lagi. Pesan layanan tetap dikirim. Penarikan tidak memengaruhi pemrosesan yang sudah berlangsung sebelumnya.",
};

function badgeVariant(status: ConsentItemView["status"]): "success" | "neutral" | "warning" {
  if (status === "GRANTED") return "success";
  if (status === "OUTDATED") return "warning";
  return "neutral";
}

/**
 * Panel "Kelola persetujuan opsional" (Paket 3). Terpasang hanya bila CONSENT_UI_ENABLED === "true".
 * Status berubah HANYA setelah server mengonfirmasi (tanpa pembaruan optimistis); sesudahnya halaman dimuat ulang dari server.
 */
export function ConsentPanel({ items, loadError }: { items: ConsentItemView[]; loadError?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [message, setMessage] = useState<{ code: string; text: string; kind: "error" | "info" } | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  function run(code: string, action: (code: string) => Promise<{ error: string | null; info?: string | null }>) {
    setMessage(null);
    setBusyCode(code);
    startTransition(async () => {
      let result: { error: string | null; info?: string | null };
      try {
        result = await action(code);
      } catch {
        result = { error: "Permintaan belum berhasil. Periksa koneksi internet, lalu coba lagi." };
      }
      setBusyCode(null);
      setConfirming(null);
      if (result.error) setMessage({ code, text: result.error, kind: "error" });
      else {
        setMessage({ code, text: result.info ?? "", kind: "info" });
        // Fokus kembali ke judul kartu (pemicu bisa berganti bentuk setelah data dimuat ulang).
        document.getElementById(`consent-${code}-title`)?.focus();
        router.refresh();
      }
    });
  }

  function closeConfirm(code: string) {
    setConfirming(null);
    triggerRefs.current[code]?.focus();
  }

  return (
    <section aria-labelledby="privasi-persetujuan-title" className="flex flex-col gap-3">
      <div>
        <h2 id="privasi-persetujuan-title" className="text-base font-semibold tracking-tight text-foreground">
          Privasi &amp; persetujuan
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{INTRO}</p>
      </div>

      {loadError ? (
        <Card>
          <CardContent className="flex flex-col gap-3 p-4">
            <p role="alert" className="text-sm text-danger">
              Daftar persetujuan belum dapat dimuat. Coba muat ulang halaman.
            </p>
            <Button variant="secondary" className="w-full sm:w-auto" onClick={() => router.refresh()}>
              Muat ulang
            </Button>
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Belum ada persetujuan opsional</CardTitle>
            <CardDescription>
              Saat ini LINOE tidak meminta persetujuan opsional dari Anda. Bila ada fitur opsional baru, Anda akan melihatnya di sini.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-3" />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => {
            const titleId = `consent-${item.code}-title`;
            const descId = `consent-${item.code}-desc`;
            const isBusy = pending && busyCode === item.code;
            const own = message && message.code === item.code ? message : null;
            return (
              <li key={item.code}>
                <Card>
                  <CardContent className="flex flex-col gap-3 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 id={titleId} tabIndex={-1} className="text-sm font-semibold text-foreground outline-none focus-visible:underline">
                        {item.title}
                      </h3>
                      <Badge variant={badgeVariant(item.status)}>{item.statusLabel}</Badge>
                    </div>
                    <p id={descId} className="text-sm text-muted-foreground">
                      {item.text}
                    </p>

                    {item.kind === "OPTIONAL" ? (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={item.status === "GRANTED"}
                        // Nama aksesibel = judul + teks yang terlihat pada tombol (Label in Name, WCAG 2.5.3).
                        aria-labelledby={`${titleId} ${titleId}-action`}
                        aria-describedby={descId}
                        disabled={isBusy}
                        ref={(el) => {
                          triggerRefs.current[item.code] = el;
                        }}
                        onClick={() => (item.status === "GRANTED" ? setConfirming(item.code) : run(item.code, grantOptionalConsentAction))}
                        className="inline-flex min-h-11 w-full items-center justify-between gap-3 rounded-[var(--radius-md)] border border-muted-foreground px-4 text-sm font-medium text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 sm:w-auto"
                      >
                        <span id={`${titleId}-action`}>{item.status === "GRANTED" ? "Matikan" : "Aktifkan"}</span>
                        {/* Trek sakelar: kontras >= 3:1 terhadap latar putih pada kedua keadaan (muted-foreground #71717a = 4.8:1; brand #4338ca = 7.9:1); kenop putih. */}
                        <span aria-hidden className={`relative inline-block h-6 w-11 shrink-0 rounded-full ${item.status === "GRANTED" ? "bg-brand" : "bg-muted-foreground"}`}>
                          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white ${item.status === "GRANTED" ? "left-[22px]" : "left-0.5"}`} />
                        </span>
                      </button>
                    ) : item.status === "GRANTED" ? (
                      <Button
                        variant="secondary"
                        className="w-full sm:w-auto"
                        loading={isBusy}
                        aria-label={`Putuskan koneksi: ${item.title}`}
                        aria-describedby={descId}
                        ref={(el) => {
                          triggerRefs.current[item.code] = el;
                        }}
                        onClick={() => setConfirming(item.code)}
                      >
                        Putuskan koneksi
                      </Button>
                    ) : (
                      <Link
                        href="/connections"
                        aria-label={`Buka halaman Koneksi untuk ${item.title}`}
                        className="inline-flex min-h-11 w-full items-center justify-center rounded-[var(--radius-md)] border border-border-strong px-4 text-sm font-medium text-foreground sm:w-auto"
                      >
                        Buka halaman Koneksi
                      </Link>
                    )}

                    {confirming === item.code ? (
                      <div
                        role="group"
                        aria-labelledby={`${titleId}-confirm`}
                        className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-border-strong bg-surface-muted p-4"
                        onKeyDown={(e) => {
                          if (e.key === "Escape") closeConfirm(item.code);
                        }}
                      >
                        <h4 id={`${titleId}-confirm`} tabIndex={-1} className="text-sm font-semibold text-foreground">
                          Tarik persetujuan ini?
                        </h4>
                        {/* Di atas surface-muted (#f4f4f5): teks abu #71717a hanya 4.4:1, jadi memakai foreground (>= 4.5:1). */}
                        <p className="text-sm text-foreground">{WITHDRAW_BODY[item.kind]}</p>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Button ref={cancelRef} autoFocus variant="secondary" className="w-full sm:w-auto" aria-label={`Batal menarik persetujuan: ${item.title}`} onClick={() => closeConfirm(item.code)}>
                            Batal
                          </Button>
                          <Button variant="destructive" className="w-full sm:w-auto" loading={isBusy} aria-label={`Ya, tarik persetujuan: ${item.title}`} onClick={() => run(item.code, withdrawConsentAction)}>
                            Ya, tarik persetujuan
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    <div role="status" aria-live="polite" className="text-sm">
                      {own && own.kind === "info" ? <p className="text-success">{own.text}</p> : null}
                    </div>
                    {own && own.kind === "error" ? (
                      <p role="alert" className="text-sm text-danger">
                        {own.text}
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link href="/privacy" className="inline-flex min-h-11 items-center underline">
          Baca Kebijakan Privasi
        </Link>
        <Link href="/data-deletion" className="inline-flex min-h-11 items-center underline">
          Penghapusan Data
        </Link>
      </p>
    </section>
  );
}
