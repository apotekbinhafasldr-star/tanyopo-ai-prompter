"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { businessCategories } from "@/schemas/onboarding";
import type { ActionState } from "@/features/products/actions";
import type { Database } from "@/types/database";

type Product = Database["public"]["Tables"]["prompter_products"]["Row"];

const initialState: ActionState = { error: null };

export function ProductForm({
  action,
  product,
  submitLabel,
}: {
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  product?: Product;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Nama Produk</Label>
        <Input id="name" name="name" defaultValue={product?.name} placeholder="Contoh: Kopi Robusta 200gr" required />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Deskripsi</Label>
        <Textarea
          id="description"
          name="description"
          defaultValue={product?.description ?? ""}
          placeholder="Ceritakan produk ini secara singkat"
          rows={4}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="productType">Jenis Produk</Label>
          <select
            id="productType"
            name="productType"
            defaultValue={product?.product_type ?? ""}
            required
            className="h-10 rounded-[var(--radius-md)] border border-border-strong bg-surface px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <option value="" disabled>
              Pilih jenis
            </option>
            {businessCategories.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="category">Kategori</Label>
          <Input id="category" name="category" defaultValue={product?.category ?? ""} placeholder="Contoh: Minuman" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="price">Harga (IDR)</Label>
          <Input id="price" name="price" type="number" min={0} step="0.01" defaultValue={product?.price ?? ""} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="stock">Stok (opsional)</Label>
          <Input id="stock" name="stock" type="number" min={0} step={1} defaultValue={product?.stock ?? ""} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="hpp">HPP / Modal (opsional)</Label>
          <Input id="hpp" name="hpp" type="number" min={0} step="0.01" defaultValue={product?.hpp ?? ""} />
          <p className="text-xs text-muted-foreground">Dipakai untuk estimasi profit marketing.</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="websiteUrl">URL (opsional)</Label>
          <Input
            id="websiteUrl"
            name="websiteUrl"
            type="url"
            defaultValue={product?.website_url ?? ""}
            placeholder="https://"
          />
        </div>
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      <div>
        <Button type="submit" loading={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
