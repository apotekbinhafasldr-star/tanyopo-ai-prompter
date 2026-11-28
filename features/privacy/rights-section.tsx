"use client";

import * as React from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const RIGHTS_BODY =
  "Anda dapat mengajukan permintaan akses, koreksi, atau penghapusan data pribadi, atau menarik persetujuan. Saat ini permintaan diajukan lewat email dan ditangani manual oleh tim kami. Menarik persetujuan koneksi dapat Anda lakukan sendiri di bagian Persetujuan opsional.";
export const COPY_OK = "Alamat email disalin.";
export const COPY_FAIL = "Alamat tidak dapat disalin. Salin dari teks di atas.";

export function buildMailto(email: string): string {
  const subject = encodeURIComponent("Permintaan Data LINOE");
  const body = encodeURIComponent("Jenis permintaan (akses / koreksi / penghapusan / tarik persetujuan):");
  return `mailto:${email}?subject=${subject}&body=${body}`;
}

/**
 * Permintaan hak subjek data lewat email/manual (belum ada formulir). Alamat hanya dari LEGAL.contactEmail (diteruskan pemanggil).
 * Tanpa janji waktu, tanpa angka durasi.
 */
export function RightsSection({ email }: { email: string }) {
  const [copyMessage, setCopyMessage] = React.useState("");

  async function copy() {
    try {
      await navigator.clipboard.writeText(email);
      setCopyMessage(COPY_OK);
    } catch {
      setCopyMessage(COPY_FAIL);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <p className="text-sm text-foreground">{RIGHTS_BODY}</p>
        <p className="break-all text-sm text-foreground">Email: {email}</p>
        <a href={buildMailto(email)} className={buttonVariants({ variant: "primary", size: "md" }) + " w-full whitespace-normal sm:w-auto"}>
          Kirim email permintaan
        </a>
        <Button type="button" variant="secondary" className="w-full whitespace-normal sm:w-auto" onClick={copy}>
          Salin alamat email
        </Button>
        <p role="status" aria-live="polite" className="min-h-5 text-sm text-foreground">
          {copyMessage}
        </p>
        <div className="flex flex-col">
          <a href="/privacy#hak" className="inline-flex min-h-11 items-center text-sm font-medium text-brand underline underline-offset-2">
            Hak Anda di Kebijakan Privasi
          </a>
          <a href="/data-deletion" className="inline-flex min-h-11 items-center text-sm font-medium text-brand underline underline-offset-2">
            Tata cara penghapusan data
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
