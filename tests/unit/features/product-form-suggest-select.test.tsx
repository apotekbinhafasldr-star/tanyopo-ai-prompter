import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProductForm } from "@/features/products/product-form";
import { SUGGEST_SELECT_OTHER } from "@/features/products/suggest-select";
import { PRODUCT_CATEGORY_SUGGESTIONS } from "@/lib/constants/product-categories";
import { STOCK_UNIT_SUGGESTIONS } from "@/lib/constants/stock-units";
import type { Database } from "@/types/database";

type Product = Database["public"]["Tables"]["prompter_products"]["Row"];

afterEach(cleanup);

const noopAction = async () => ({ error: null });

function renderForm(product?: Partial<Product>) {
  const view = render(
    <ProductForm action={noopAction} product={product as Product | undefined} submitLabel="Simpan" />,
  );
  const form = view.container.querySelector("form") as HTMLFormElement;
  const submitted = (field: string) => new FormData(form).get(field);
  return { ...view, form, submitted };
}

const categorySelect = () => screen.getByLabelText("Kategori") as HTMLSelectElement;
const unitSelect = () => screen.getByLabelText("Satuan stok") as HTMLSelectElement;

describe("ProductForm — Kategori & Satuan pakai <select> native (Chrome Android)", () => {
  it("tidak lagi memakai <datalist> / atribut list", () => {
    const { container } = renderForm();
    expect(container.querySelector("datalist")).toBeNull();
    expect(container.querySelector("input[list]")).toBeNull();
  });

  it("nilai bawaan produk baru: kosong, daftar saran tersedia + opsi Lainnya", () => {
    const { submitted } = renderForm();
    expect(categorySelect().tagName).toBe("SELECT");
    expect(categorySelect().value).toBe("");
    const values = Array.from(categorySelect().options).map((o) => o.value);
    for (const c of PRODUCT_CATEGORY_SUGGESTIONS.PHYSICAL_PRODUCT) expect(values).toContain(c);
    expect(values).toContain(SUGGEST_SELECT_OTHER);
    const unitValues = Array.from(unitSelect().options).map((o) => o.value);
    for (const u of STOCK_UNIT_SUGGESTIONS) expect(unitValues).toContain(u);
    expect(submitted("category")).toBe("");
    expect(submitted("stockUnit")).toBe("");
    // select-nya sendiri tidak ikut terkirim (hanya input tersembunyi bernama)
    expect(categorySelect().getAttribute("name")).toBeNull();
    expect(unitSelect().getAttribute("name")).toBeNull();
  });

  it("memilih saran mengirim nilai itu di bawah nama field yang sama", () => {
    const { submitted } = renderForm();
    fireEvent.change(categorySelect(), { target: { value: "Fashion" } });
    fireEvent.change(unitSelect(), { target: { value: "box" } });
    expect(submitted("category")).toBe("Fashion");
    expect(submitted("stockUnit")).toBe("box");
    expect(screen.queryByLabelText("Kategori (ketik sendiri)")).toBeNull();
  });

  it("Lainnya memunculkan kolom ketik sendiri dan mengirim nilai kustom", () => {
    const { submitted } = renderForm();
    fireEvent.change(categorySelect(), { target: { value: SUGGEST_SELECT_OTHER } });
    const custom = screen.getByLabelText("Kategori (ketik sendiri)") as HTMLInputElement;
    expect(submitted("category")).toBe("");
    fireEvent.change(custom, { target: { value: "Kopi Spesial" } });
    expect(submitted("category")).toBe("Kopi Spesial");

    fireEvent.change(unitSelect(), { target: { value: SUGGEST_SELECT_OTHER } });
    fireEvent.change(screen.getByLabelText("Satuan stok (ketik sendiri)"), { target: { value: "bungkus" } });
    expect(submitted("stockUnit")).toBe("bungkus");
  });

  it("kembali ke saran atau ke kosong menghapus nilai kustom", () => {
    const { submitted } = renderForm();
    fireEvent.change(categorySelect(), { target: { value: SUGGEST_SELECT_OTHER } });
    fireEvent.change(screen.getByLabelText("Kategori (ketik sendiri)"), { target: { value: "Kustom" } });
    fireEvent.change(categorySelect(), { target: { value: "Kesehatan" } });
    expect(submitted("category")).toBe("Kesehatan");
    expect(screen.queryByLabelText("Kategori (ketik sendiri)")).toBeNull();
    fireEvent.change(categorySelect(), { target: { value: "" } });
    expect(submitted("category")).toBe("");
  });

  it("edit: nilai tersimpan yang ada di daftar terpilih di <select>", () => {
    const { submitted } = renderForm({ product_type: "PHYSICAL_PRODUCT", category: "Fashion", stock_unit: "pcs" } as Partial<Product>);
    expect(categorySelect().value).toBe("Fashion");
    expect(unitSelect().value).toBe("pcs");
    expect(screen.queryByLabelText("Kategori (ketik sendiri)")).toBeNull();
    expect(submitted("category")).toBe("Fashion");
    expect(submitted("stockUnit")).toBe("pcs");
  });

  it("edit: nilai lama/kustom yang tidak ada di daftar dipertahankan di kolom ketik sendiri", () => {
    const { submitted } = renderForm({ product_type: "PHYSICAL_PRODUCT", category: "Kategori Lama Saya", stock_unit: "bungkus" } as Partial<Product>);
    expect(categorySelect().value).toBe(SUGGEST_SELECT_OTHER);
    expect((screen.getByLabelText("Kategori (ketik sendiri)") as HTMLInputElement).value).toBe("Kategori Lama Saya");
    expect(unitSelect().value).toBe(SUGGEST_SELECT_OTHER);
    expect((screen.getByLabelText("Satuan stok (ketik sendiri)") as HTMLInputElement).value).toBe("bungkus");
    expect(submitted("category")).toBe("Kategori Lama Saya");
    expect(submitted("stockUnit")).toBe("bungkus");
  });

  it("mengganti jenis produk: kategori yang tidak ada di daftar baru tidak hilang (jadi kustom)", () => {
    const { submitted } = renderForm({ product_type: "PHYSICAL_PRODUCT", category: "Fashion" } as Partial<Product>);
    fireEvent.change(screen.getByLabelText("Jenis Produk"), { target: { value: "SERVICE" } });
    const values = Array.from(categorySelect().options).map((o) => o.value);
    expect(values).toContain("Jasa Konsultasi");
    expect(values).not.toContain("Fashion");
    expect(categorySelect().value).toBe(SUGGEST_SELECT_OTHER);
    expect(submitted("category")).toBe("Fashion");
  });

  it("validasi: batas panjang mengikuti skema (kategori 100, satuan 40) dan nilai kosong tetap boleh", () => {
    renderForm();
    fireEvent.change(categorySelect(), { target: { value: SUGGEST_SELECT_OTHER } });
    fireEvent.change(unitSelect(), { target: { value: SUGGEST_SELECT_OTHER } });
    expect(screen.getByLabelText("Kategori (ketik sendiri)")).toHaveAttribute("maxlength", "100");
    expect(screen.getByLabelText("Satuan stok (ketik sendiri)")).toHaveAttribute("maxlength", "40");
    expect(categorySelect()).not.toBeRequired();
    expect(unitSelect()).not.toBeRequired();
  });

  it("aksesibilitas: label terhubung, petunjuk terhubung, select native terfokus tanpa role kustom", () => {
    renderForm();
    expect(screen.getByRole("combobox", { name: "Kategori" })).toBe(categorySelect());
    expect(categorySelect()).toHaveAttribute("aria-describedby", "category-hint");
    expect(document.getElementById("category-hint")).toBeInTheDocument();
    expect(unitSelect()).toHaveAttribute("aria-describedby", "stockUnit-hint");
    expect(document.getElementById("stockUnit-hint")).toBeInTheDocument();
    // label satuan hanya untuk pembaca layar (judul "Stok" sudah tampak)
    expect(screen.getByText("Satuan stok", { selector: "label" })).toHaveClass("sr-only");
    fireEvent.change(categorySelect(), { target: { value: SUGGEST_SELECT_OTHER } });
    expect(screen.getByLabelText("Kategori (ketik sendiri)").tagName).toBe("INPUT");
  });
});
