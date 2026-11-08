"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { businessCategories } from "@/schemas/onboarding";
import { SUPPORTED_CURRENCIES } from "@/schemas/global-preferences";
import { categorySuggestionsFor } from "@/lib/constants/product-categories";
import { STOCK_UNIT_SUGGESTIONS } from "@/lib/constants/stock-units";
import { CountryMultiSelect } from "@/features/products/country-multi-select";
import { SuggestSelect } from "@/features/products/suggest-select";
import type { ActionState } from "@/features/products/actions";
import type { Database, Json } from "@/types/database";

type Product = Database["public"]["Tables"]["prompter_products"]["Row"];

const selectClass =
  "h-11 rounded-[var(--radius-md)] border border-border-strong bg-surface px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40";

function targetCountriesToText(value: Json | undefined): string {
  if (!Array.isArray(value)) return "";
  return value.filter((v): v is string => typeof v === "string").join(", ");
}

const initialState: ActionState = { error: null };

export function ProductForm({
  action,
  product,
  submitLabel,
  defaultCurrency = "IDR",
}: {
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  product?: Product;
  submitLabel: string;
  /** Tenant's own configured currency (session.defaultCurrency) — used
   * only when creating a new product with no currency of its own yet. */
  defaultCurrency?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [productType, setProductType] = useState(product?.product_type ?? "");
  const categoryOptions = categorySuggestionsFor(productType);
  const needsStock = productType === "PHYSICAL_PRODUCT" || productType === "";

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
            value={productType}
            onChange={(e) => setProductType(e.target.value)}
            required
            className={selectClass}
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
          <SuggestSelect
            id="category"
            name="category"
            label="Kategori"
            options={categoryOptions}
            defaultValue={product?.category}
            emptyLabel="Pilih kategori (opsional)"
            customLabel="Kategori (ketik sendiri)"
            customPlaceholder="Ketik kategori Anda"
            maxLength={100}
            describedBy="category-hint"
          />
          <p id="category-hint" className="text-xs text-muted-foreground">
            Pilih dari daftar atau pilih "Lainnya" untuk mengetik kategori sendiri.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="price">Harga</Label>
          <Input
            id="price"
            name="price"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            defaultValue={product?.price ?? ""}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="currency">Mata Uang</Label>
          <select id="currency" name="currency" defaultValue={product?.currency ?? defaultCurrency} className={selectClass}>
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="stock">{needsStock ? "Stok (opsional)" : "Stok (opsional, jika relevan)"}</Label>
          <div className="flex items-start gap-2">
            <Input
              id="stock"
              name="stock"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              defaultValue={product?.stock ?? ""}
              className="flex-1"
              placeholder="0"
            />
            <SuggestSelect
              id="stockUnit"
              name="stockUnit"
              label="Satuan stok"
              hideLabel
              options={STOCK_UNIT_SUGGESTIONS}
              defaultValue={product?.stock_unit}
              emptyLabel="Satuan"
              customLabel="Satuan stok (ketik sendiri)"
              customPlaceholder="Satuan"
              maxLength={40}
              describedBy="stockUnit-hint"
              className="w-36 shrink-0"
            />
          </div>
          <p id="stockUnit-hint" className="text-xs text-muted-foreground">
            Contoh: 12 pcs, 5 box. Pilih satuan dari daftar atau pilih "Lainnya" untuk mengetik sendiri.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="hpp">HPP / Modal (opsional)</Label>
          <Input id="hpp" name="hpp" type="number" inputMode="decimal" min={0} step="0.01" defaultValue={product?.hpp ?? ""} />
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

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="language">Bahasa Produk (opsional)</Label>
          <select id="language" name="language" defaultValue={product?.language ?? ""} className={selectClass}>
            <option value="">— (ikuti bahasa bisnis)</option>
            <option value="id">Bahasa Indonesia</option>
            <option value="en">English</option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="targetCountriesSearch">Target Negara Pemasaran (opsional)</Label>
          <CountryMultiSelect
            name="targetCountries"
            inputId="targetCountriesSearch"
            defaultValue={targetCountriesToText(product?.target_countries)}
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
