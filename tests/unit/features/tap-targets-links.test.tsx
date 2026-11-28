import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { registerActionMock } = vi.hoisted(() => ({ registerActionMock: vi.fn() }));
vi.mock("@/features/auth/actions", () => ({ registerAction: registerActionMock }));

import { RegisterForm } from "@/features/auth/register-form";
import { LegalLinks } from "@/features/legal/legal-links";

afterEach(() => cleanup());

// jsdom tidak menerapkan Tailwind: ini kontrak kelas (UNIT), bukan ukuran piksel terukur.
const has = (el: Element, cls: string) => el.className.split(/\s+/).includes(cls);

describe("target ketuk >=44px pada tautan kecil (kontrak kelas, UNIT)", () => {
  it("LegalLinks: setiap tautan min-h-11 dan min-w-11", () => {
    render(<LegalLinks />);
    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThanOrEqual(3);
    for (const a of links) {
      expect(has(a, "min-h-11")).toBe(true);
      expect(has(a, "min-w-11")).toBe(true);
    }
  });

  it("RegisterForm: tautan Masuk dan Lupa kata sandi setelah galat tak pasti memakai min-h-11", async () => {
    registerActionMock.mockResolvedValue({
      error: "Kami tidak menerima kepastian dari server, jadi permintaan Anda mungkin sudah diproses.",
      uncertain: true,
      values: { nama: "Budi", namaUsaha: "Toko Budi", email: "budi@example.com" },
    });
    render(<RegisterForm />);
    await act(async () => {
      fireEvent.submit(document.querySelector("form")!);
    });
    const alert = screen.getByRole("alert");
    const links = Array.from(alert.querySelectorAll("a"));
    expect(links.map((a) => a.textContent)).toEqual(["Masuk", "Lupa kata sandi?"]);
    for (const a of links) {
      expect(has(a, "min-h-11")).toBe(true);
      expect(has(a, "min-w-11")).toBe(true);
    }
  });
});
