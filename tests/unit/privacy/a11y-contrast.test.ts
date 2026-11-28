import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Kontras WCAG 2.x dihitung dari token pada app/globals.css (bukan angka tempelan). Ambang: teks >= 4,5; komponen/indikator >= 3. */
const css = readFileSync(path.resolve(__dirname, "../../../app/globals.css"), "utf-8");
const rootBlock = css.slice(css.indexOf(":root"), css.indexOf("}", css.indexOf(":root")));

function token(name: string): string {
  const m = rootBlock.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!m) throw new Error(`token --${name} tidak ditemukan`);
  return m[1];
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE = "#ffffff";

describe("kontras token yang dipakai dialog dan kartu Koneksi (Paket 5a)", () => {
  const TEXT_PAIRS: Array<[string, string, string, number]> = [
    ["foreground di surface (isi dialog)", token("foreground"), token("surface"), 17.7],
    ["foreground di surface-muted (kutipan persetujuan)", token("foreground"), token("surface-muted"), 16.1],
    ["foreground di background", token("foreground"), token("background"), 4.5],
    ["tautan brand di surface", token("brand"), token("surface"), 7.8],
    ["teks putih di brand (tombol primer)", token("brand-foreground"), token("brand"), 7.8],
    ["danger di surface (alert galat)", token("danger"), token("surface"), 6.4],
    ["danger di danger-muted (banner galat)", token("danger"), token("danger-muted"), 4.5],
    ["success di surface (status tersimpan)", token("success"), token("surface"), 4.5],
    ["muted-foreground di surface (versi persetujuan)", token("muted-foreground"), token("surface"), 4.5],
    ["muted-foreground di background (catatan kartu)", token("muted-foreground"), token("background"), 4.5],
    ["putih di danger (tombol destruktif)", WHITE, token("danger"), 4.5],
  ];

  it.each(TEXT_PAIRS)("%s", (_name, fg, bg, min) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(min);
  });

  it("muted-foreground di surface-muted GAGAL 4,5 (alasan kutipan memakai foreground, bukan muted)", () => {
    expect(ratio(token("muted-foreground"), token("surface-muted"))).toBeLessThan(4.5);
  });

  it("indikator fokus: brand di surface >= 3", () => {
    expect(ratio(token("brand"), token("surface"))).toBeGreaterThanOrEqual(3);
  });

  it("angka spesifikasi terbukti: foreground/surface ~ 17,72 dan brand/surface ~ 7,90", () => {
    expect(ratio(token("foreground"), token("surface"))).toBeCloseTo(17.72, 1);
    expect(ratio(token("brand"), token("surface"))).toBeCloseTo(7.9, 1);
  });
});
