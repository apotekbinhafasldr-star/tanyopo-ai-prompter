import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

afterEach(cleanup);

const css = readFileSync(path.resolve(__dirname, "../../../app/globals.css"), "utf8");
const token = (name: string) => {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!m) throw new Error(`token --${name} tidak ditemukan di globals.css`);
  return m[1];
};
function luminance(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("batas kontrol formulir (WCAG 1.4.11, UNIT: dihitung dari globals.css)", () => {
  it("--border-input >= 3:1 terhadap --surface dan --background", () => {
    expect(ratio(token("border-input"), token("surface"))).toBeGreaterThanOrEqual(3);
    expect(ratio(token("border-input"), token("background"))).toBeGreaterThanOrEqual(3);
  });

  it("token dipetakan ke utilitas Tailwind border-input", () => {
    expect(css).toMatch(/--color-border-input:\s*var\(--border-input\)/);
  });

  it("Input dan Textarea memakai border-border-input, bukan border-border-strong", () => {
    render(
      <>
        <Input aria-label="Nama" />
        <Textarea aria-label="Catatan" />
      </>,
    );
    for (const el of [screen.getByLabelText("Nama"), screen.getByLabelText("Catatan")]) {
      expect(el.className).toContain("border-border-input");
      expect(el.className).not.toContain("border-border-strong");
    }
  });
});
