"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateBrandProfileAction, type SettingsActionState } from "@/features/settings/actions";

const initialState: SettingsActionState = { error: null };

export interface BrandProfileValues {
  brandName: string;
  whatDoYouSell: string;
  websiteUrl: string;
  whatsappNumber: string;
}

function ClearOption({ name, label, show }: { name: string; label: string; show: boolean }) {
  if (!show) return null;
  return (
    <label className="flex min-h-11 items-center gap-2 text-xs text-muted-foreground">
      <input type="checkbox" name={name} className="size-5" />
      {label}
    </label>
  );
}

/**
 * Edit Profil Brand. Mobile-first: satu kolom, input tinggi 44px, tipe/inputMode sesuai agar keyboard Android
 * tepat (url / tel). Field opsional dikosongkan = nilai lama dipertahankan; hapus lewat centang eksplisit.
 */
export function BrandProfileForm({ values, readOnly }: { values: BrandProfileValues; readOnly: boolean }) {
  const [state, formAction, pending] = useActionState(updateBrandProfileAction, initialState);

  if (readOnly) {
    return (
      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        {(
          [
            ["Nama brand", values.brandName],
            ["Website", values.websiteUrl],
            ["Kontak WhatsApp", values.whatsappNumber],
            ["Yang dijual", values.whatDoYouSell],
          ] as const
        ).map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="break-words font-medium text-foreground">{v || "—"}</dd>
          </div>
        ))}
        <p className="text-xs text-muted-foreground sm:col-span-2">Hanya Owner atau Marketing yang dapat mengubah profil brand.</p>
      </dl>
    );
  }

  // key: form dipasang ulang dengan nilai terbaru setelah tersimpan (centang "Hapus" ikut ter-reset)
  const formKey = JSON.stringify(values);

  return (
    <form key={formKey} action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="brandName">Nama brand</Label>
        <Input id="brandName" name="brandName" defaultValue={values.brandName} required minLength={2} maxLength={120} autoComplete="organization" />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="websiteUrl">Website brand (opsional)</Label>
        <Input
          id="websiteUrl"
          name="websiteUrl"
          type="url"
          inputMode="url"
          autoComplete="url"
          maxLength={300}
          defaultValue={values.websiteUrl}
          placeholder="https://tokoanda.id"
          aria-describedby="websiteUrl-hint"
        />
        <p id="websiteUrl-hint" className="text-xs text-muted-foreground">
          Alamat resmi bisnis Anda sendiri (http:// atau https://). Dikosongkan = nilai lama tidak berubah.
        </p>
        <ClearOption name="clearWebsiteUrl" label="Hapus website yang tersimpan" show={!!values.websiteUrl} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="whatsappNumber">Kontak WhatsApp (opsional)</Label>
        <Input
          id="whatsappNumber"
          name="whatsappNumber"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={40}
          defaultValue={values.whatsappNumber}
          placeholder="08123456789"
          aria-describedby="whatsappNumber-hint"
        />
        <p id="whatsappNumber-hint" className="text-xs text-muted-foreground">
          8–15 digit, boleh diawali +. Dipakai sebagai tujuan kontak/CTA, bukan dipublikasikan otomatis.
        </p>
        <ClearOption name="clearWhatsappNumber" label="Hapus nomor yang tersimpan" show={!!values.whatsappNumber} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="whatDoYouSell">Yang Anda jual (opsional)</Label>
        <Textarea id="whatDoYouSell" name="whatDoYouSell" rows={3} maxLength={500} defaultValue={values.whatDoYouSell} />
        <ClearOption name="clearWhatDoYouSell" label="Hapus deskripsi yang tersimpan" show={!!values.whatDoYouSell} />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      {state.saved && !state.error ? (
        <p role="status" className="text-sm text-success">
          Profil brand tersimpan.
        </p>
      ) : null}
      {state.notice ? (
        <p role="status" className="text-sm text-warning">
          {state.notice}
        </p>
      ) : null}

      <div>
        <Button type="submit" size="sm" loading={pending} className="min-h-11">
          Simpan
        </Button>
      </div>
    </form>
  );
}
