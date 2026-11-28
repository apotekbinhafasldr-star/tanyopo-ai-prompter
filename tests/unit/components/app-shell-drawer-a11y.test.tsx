import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
vi.mock("next/link", () => ({
  default: ({ href, children, onClick, ...rest }: { href: string; children: React.ReactNode; onClick?: () => void }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        onClick?.();
      }}
      {...rest}
    >
      {children}
    </a>
  ),
}));
vi.mock("@/features/auth/actions", () => ({ logoutAction: vi.fn() }));
vi.mock("@/components/brand/linoe-logo", () => ({ LinoeLogo: () => <span>LINOE</span> }));

import { AppShell } from "@/components/layout/app-shell";

const KEY = "__backLayer";

// jsdom tidak punya matchMedia: tiru layar HP (di bawah 1024px) supaya drawer dipakai.
beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  window.history.replaceState(null, "", "/");
});
afterEach(() => cleanup());

function setup() {
  render(
    <AppShell businessName="Toko" userName="Budi" userRole="owner">
      <p>isi halaman</p>
    </AppShell>,
  );
  const trigger = () => screen.getByRole("button", { name: /menu/i });
  const main = () => document.querySelector("main") as HTMLElement;
  const drawer = () => document.getElementById("app-sidebar-drawer") as HTMLElement;
  return { trigger, main, drawer };
}
const layerOnTop = () => Boolean((window.history.state as Record<string, unknown> | null)?.[KEY]);

describe("AppShell drawer: fokus, inert, Escape (UNIT)", () => {
  it("tertutup: main tidak inert dan drawer inert", () => {
    const { main, drawer } = setup();
    expect(main()).not.toHaveAttribute("inert");
    expect(drawer()).toHaveAttribute("inert");
  });

  it("buka: fokus pindah ke drawer, main inert dan aria-hidden", () => {
    const { trigger, main, drawer } = setup();
    fireEvent.click(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(drawer()).not.toHaveAttribute("inert");
    expect(document.activeElement).toBe(drawer());
    expect(main()).toHaveAttribute("inert");
    expect(main()).toHaveAttribute("aria-hidden", "true");
  });

  it("Escape menutup drawer, fokus kembali ke tombol menu, main aktif lagi", () => {
    const { trigger, main } = setup();
    fireEvent.click(trigger());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(trigger());
    expect(main()).not.toHaveAttribute("inert");
    expect(main()).not.toHaveAttribute("aria-hidden");
  });

  it("Escape tidak berbuat apa pun saat drawer tertutup", () => {
    const { trigger } = setup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
  });
});

describe("AppShell drawer: tombol Back Android (popstate) (UNIT/jsdom)", () => {
  it("buka mendorong satu entri riwayat; Back menutup drawer dan fokus kembali ke tombol menu", async () => {
    const { trigger } = setup();
    const before = window.history.length;
    fireEvent.click(trigger());
    expect(window.history.length).toBe(before + 1);
    expect(layerOnTop()).toBe(true);

    await act(async () => {
      window.history.back();
    });
    await waitFor(() => expect(trigger()).toHaveAttribute("aria-expanded", "false"));
    expect(document.activeElement).toBe(trigger());
    expect(layerOnTop()).toBe(false);
  });

  it("menutup lewat tombol X membuang entri lapisan (tidak ada Back kosong tersisa)", async () => {
    const { trigger } = setup();
    fireEvent.click(trigger());
    fireEvent.click(trigger()); // tombol yang sama menjadi "Tutup menu"
    await waitFor(() => expect(layerOnTop()).toBe(false));
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
  });

  it("mengetuk tautan menu menutup drawer tanpa history.back() (tidak berbalapan dengan navigasi)", async () => {
    const { trigger } = setup();
    const back = vi.spyOn(window.history, "back");
    fireEvent.click(trigger());
    fireEvent.click(screen.getAllByRole("link", { name: /overview/i })[0]);
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(layerOnTop()).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(back).not.toHaveBeenCalled();
    back.mockRestore();
  });
});
