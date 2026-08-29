"use client";

import { useActionState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { contentPlatforms, contentTypes } from "@/schemas/content";
import { primaryGoals } from "@/schemas/onboarding";
import { generateContentAction, type ContentActionState } from "@/features/content/actions";

interface ProductOption {
  id: string;
  name: string;
}

const initialState: ContentActionState = { error: null };

const selectClass =
  "h-10 rounded-[var(--radius-md)] border border-border-strong bg-surface px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40";

export function ContentGeneratorForm({
  products,
  preselectedProductId,
}: {
  products: ProductOption[];
  preselectedProductId?: string;
}) {
  const [state, formAction, pending] = useActionState(generateContentAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="productId">Produk</Label>
          <select id="productId" name="productId" defaultValue={preselectedProductId ?? ""} required className={selectClass}>
            <option value="" disabled>
              Pilih produk
            </option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="platform">Platform</Label>
          <select id="platform" name="platform" defaultValue="" required className={selectClass}>
            <option value="" disabled>
              Pilih platform
            </option>
            {contentPlatforms.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="contentType">Jenis Konten</Label>
          <select id="contentType" name="contentType" defaultValue="" required className={selectClass}>
            <option value="" disabled>
              Pilih jenis
            </option>
            {contentTypes.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="goal">Tujuan (opsional)</Label>
          <select id="goal" name="goal" defaultValue="" className={selectClass}>
            <option value="">Tidak ditentukan</option>
            {primaryGoals.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tone">Tone (opsional)</Label>
          <Input id="tone" name="tone" placeholder="Contoh: santai, profesional" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="language">Bahasa</Label>
          <select id="language" name="language" defaultValue="id" className={selectClass}>
            <option value="id">Bahasa Indonesia</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      <div>
        <Button type="submit" loading={pending}>
          <Sparkles />
          Buat Konten dengan AI
        </Button>
      </div>
    </form>
  );
}
