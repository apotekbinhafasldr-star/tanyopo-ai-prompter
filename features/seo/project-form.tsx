"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils/cn";
import { createSeoProjectAction, type SeoActionState } from "@/features/seo/actions";

const initialState: SeoActionState = { error: null };

/**
 * Batch B5 — SEO & Discovery. Leads with a mode choice instead of
 * assuming every tenant has a website (schemas/seo.ts's discoveryMode).
 * "Saya belum punya website" never shows an error or forces a URL — it
 * switches to a lighter set of fields and the honest reassurance copy
 * the brief asks for. Context Inheritance: preselectedProductId/
 * contextNote are set by the caller (app/(app)/seo/page.tsx) when this
 * is opened from a product, same pattern Content Studio already uses.
 */
export function SeoProjectForm({
  preselectedProductId,
  contextNote,
  existingWhatsappNumber,
}: {
  preselectedProductId?: string;
  contextNote?: string;
  existingWhatsappNumber?: string | null;
}) {
  const [state, formAction, pending] = useActionState(createSeoProjectAction, initialState);
  const [mode, setMode] = useState<"WEBSITE" | "NO_WEBSITE" | null>(null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {mode ? <input type="hidden" name="discoveryMode" value={mode} /> : null}
      {preselectedProductId ? <input type="hidden" name="productId" value={preselectedProductId} /> : null}

      {contextNote ? <p className="text-xs text-muted-foreground">{contextNote}</p> : null}

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-foreground">Bagaimana pelanggan menemukan bisnis Anda?</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setMode("WEBSITE")}
            aria-pressed={mode === "WEBSITE"}
            className={cn(
              "min-h-11 rounded-[var(--radius-md)] border px-4 py-3 text-left text-sm font-medium transition-colors",
              mode === "WEBSITE"
                ? "border-brand bg-brand-muted text-brand"
                : "border-border-strong text-foreground hover:bg-surface-muted",
            )}
          >
            Saya punya website
          </button>
          <button
            type="button"
            onClick={() => setMode("NO_WEBSITE")}
            aria-pressed={mode === "NO_WEBSITE"}
            className={cn(
              "min-h-11 rounded-[var(--radius-md)] border px-4 py-3 text-left text-sm font-medium transition-colors",
              mode === "NO_WEBSITE"
                ? "border-brand bg-brand-muted text-brand"
                : "border-border-strong text-foreground hover:bg-surface-muted",
            )}
          >
            Saya belum punya website
          </button>
        </div>
      </div>

      {mode === "WEBSITE" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="websiteUrl">URL Website</Label>
            <Input id="websiteUrl" name="websiteUrl" type="url" placeholder="https://usaha-anda.com" className="h-11" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="targetKeywords">Kata Kunci Target (opsional, pisahkan dengan koma)</Label>
            <Input
              id="targetKeywords"
              name="targetKeywords"
              placeholder="apotek dekat saya, obat batuk anak"
              className="h-11"
            />
          </div>
        </div>
      ) : null}

      {mode === "NO_WEBSITE" ? (
        <div className="flex flex-col gap-4">
          <p className="rounded-[var(--radius-md)] bg-brand-muted p-3 text-sm text-brand">
            Tidak masalah. LINOE tetap bisa membantu bisnis Anda lebih mudah ditemukan lewat Instagram, Facebook,
            TikTok, WhatsApp, atau marketplace.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="targetKeywords">Kata Kunci Target (opsional, pisahkan dengan koma)</Label>
            <Input
              id="targetKeywords"
              name="targetKeywords"
              placeholder="kopi kekinian jakarta, kopi susu enak"
              className="h-11"
            />
          </div>
          {existingWhatsappNumber ? (
            <p className="text-xs text-muted-foreground">
              Kontak CTA yang akan dipakai: <span className="font-medium text-foreground">{existingWhatsappNumber}</span>
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="whatsappNumber">Nomor/Link WhatsApp untuk CTA (opsional)</Label>
              <Input
                id="whatsappNumber"
                name="whatsappNumber"
                placeholder="08xxxxxxxxxx atau wa.me/62xxxxxxxxxx"
                className="h-11"
              />
              <p className="text-xs text-muted-foreground">
                Hanya dipakai sebagai saran CTA/kontak di rekomendasi — bukan untuk mengirim pesan otomatis.
              </p>
            </div>
          )}
        </div>
      ) : null}

      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      {mode ? (
        <div>
          <Button type="submit" size="sm" className="min-h-11" loading={pending}>
            Buat Project {mode === "WEBSITE" ? "SEO" : "Discovery"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
