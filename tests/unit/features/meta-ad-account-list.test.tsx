import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MetaAdAccountList } from "@/features/connections/meta-ad-account-list";
import type { AdAccountOption } from "@/features/connections/meta-ad-account-selection-core";

const A: AdAccountOption = {
  id: "act_111",
  name: "Akun Lama",
  currency: "IDR",
  statusLabel: "Aktif",
  readiness: "READY",
  notes: [],
  isCurrent: true,
};
const B: AdAccountOption = {
  id: "act_222",
  name: "PT Tanyopo Future Technology dengan nama akun iklan yang sangat panjang sekali untuk layar sempit",
  currency: "USD",
  statusLabel: "Dinonaktifkan",
  readiness: "NOT_READY",
  notes: ["Mata uang akun iklan adalah USD, bukan IDR."],
  isCurrent: false,
};
const C: AdAccountOption = {
  id: "act_333",
  name: "Akun Baru",
  currency: null,
  statusLabel: "Status tidak dikenal",
  readiness: "UNKNOWN",
  notes: ["Metode pembayaran belum bisa dipastikan."],
  isCurrent: false,
};

function html(over: Partial<Parameters<typeof MetaAdAccountList>[0]> = {}) {
  return renderToStaticMarkup(
    <MetaAdAccountList accounts={[A, B, C]} chosenId="" selectionConfirmed={false} {...over} />,
  );
}

describe("MetaAdAccountList", () => {
  it("renders one radio option per account and pre-selects nothing", () => {
    const out = html();
    expect(out.match(/type="radio"/g)).toHaveLength(3);
    expect(out).not.toMatch(/checked=""/);
    expect(out).toContain('data-account-id="act_111"');
    expect(out).toContain('data-account-id="act_333"');
  });

  it("marks exactly the chosen account as checked", () => {
    const out = html({ chosenId: "act_222" });
    expect(out.match(/checked=""/g)).toHaveLength(1);
    expect(out).toMatch(/value="act_222"[^>]*checked=""|checked=""[^>]*value="act_222"/);
  });

  it("shows name, id, currency, status and readiness for each account", () => {
    const out = html();
    for (const text of ["Akun Lama", "act_111", "IDR", "Aktif", "Siap", "USD", "Dinonaktifkan", "Belum siap", "Belum bisa dipastikan"]) {
      expect(out).toContain(text);
    }
    expect(out).toContain("Mata uang belum diketahui");
    expect(out).toContain("Mata uang akun iklan adalah USD, bukan IDR.");
  });

  it("says plainly whether the current account was confirmed by the Owner", () => {
    expect(html({ selectionConfirmed: true })).toContain("Sedang dipakai");
    const unconfirmed = html({ selectionConfirmed: false });
    expect(unconfirmed).toContain("Tersimpan, belum Anda konfirmasi");
    expect(unconfirmed).not.toContain("Sedang dipakai");
  });

  it("is mobile-first: full-width stacked cards, 48px tap target, wrapping text, no fixed widths", () => {
    const out = html();
    expect(out).toContain("flex-col");
    expect(out).toContain("min-h-12");
    expect(out).toContain("break-words");
    expect(out).toContain("break-all");
    expect(out).toContain("min-w-0");
    expect(out).not.toMatch(/\bw-\[\d+px\]|\bmin-w-\[\d+px\]|\bwidth:\s*\d+px/);
    expect(out).not.toContain("overflow-x-scroll");
    expect(out).toContain('class="sr-only"'); // legend for screen readers
  });

  it("escapes names (no markup injection from an ad-account name)", () => {
    const evil: AdAccountOption = { ...A, name: '<img src=x onerror="alert(1)">' };
    const out = renderToStaticMarkup(<MetaAdAccountList accounts={[evil]} chosenId="" selectionConfirmed={false} />);
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });

  it("never renders a funding identifier or token", () => {
    const out = html();
    expect(out.toLowerCase()).not.toContain("funding");
    expect(out.toLowerCase()).not.toContain("token");
  });

  it("can be disabled while saving", () => {
    expect(html({ disabled: true })).toMatch(/<fieldset[^>]*disabled/);
  });
});
