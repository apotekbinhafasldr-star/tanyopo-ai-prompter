import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { changeMock, checkoutMock } = vi.hoisted(() => ({ changeMock: vi.fn(), checkoutMock: vi.fn() }));
vi.mock("@/features/billing/actions", () => ({ changePlanAction: changeMock, startCheckoutAction: checkoutMock }));

import { PlanSelectConfirm } from "@/features/billing/plan-select-confirm";

const KEY = "__backLayer";
const layerOnTop = () => Boolean((window.history.state as Record<string, unknown> | null)?.[KEY]);

function renderCard(props: Partial<React.ComponentProps<typeof PlanSelectConfirm>> = {}) {
  return render(
    <PlanSelectConfirm
      planId="GROWTH"
      planName="Growth"
      priceIDR={299000}
      pricePeriodLabel="/ bulan"
      primaryCtaClassName="bg-brand text-white"
      mutedTextClassName="text-white/90"
      dividerClassName="border-white/20"
      readOnly={false}
      useCheckout={false}
      {...props}
    />,
  );
}
const choose = () => fireEvent.click(screen.getByRole("button", { name: "Pilih Paket Ini" }));

beforeEach(() => {
  changeMock.mockReset();
  checkoutMock.mockReset();
  changeMock.mockResolvedValue({ error: null });
  window.history.replaceState(null, "", "/billing");
});
afterEach(() => cleanup());

describe("PlanSelectConfirm: Back Android dan target ketuk (UNIT/jsdom)", () => {
  it("membuka konfirmasi mendorong satu entri; Back menutup konfirmasi dan kembali ke 'Pilih Paket Ini'", async () => {
    renderCard();
    const before = window.history.length;
    choose();
    expect(screen.getByText("Anda memilih Paket Growth")).toBeInTheDocument();
    expect(window.history.length).toBe(before + 1);

    await act(async () => {
      window.history.back();
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Pilih Paket Ini" })).toBeInTheDocument());
    expect(screen.queryByText("Anda memilih Paket Growth")).toBeNull();
    expect(window.location.pathname).toBe("/billing");
  });

  it("'Kembali' menutup konfirmasi dan membuang entri lapisan", async () => {
    renderCard();
    choose();
    fireEvent.click(screen.getByRole("button", { name: "Kembali" }));
    expect(screen.queryByText("Anda memilih Paket Growth")).toBeNull();
    await waitFor(() => expect(layerOnTop()).toBe(false));
  });

  it("'Kembali' memenuhi kontrak target ketuk: min-h-11, min-w-11, text-sm", () => {
    renderCard();
    choose();
    const cls = screen.getByRole("button", { name: "Kembali" }).className.split(/\s+/);
    expect(cls).toEqual(expect.arrayContaining(["min-h-11", "min-w-11", "text-sm"]));
    expect(cls).not.toContain("text-xs");
  });

  it("tampil hanya-baca: tidak ada entri riwayat yang didorong", () => {
    const before = window.history.length;
    renderCard({ readOnly: true });
    expect(screen.getByText("Hanya Owner yang dapat memilih paket.")).toBeInTheDocument();
    expect(window.history.length).toBe(before);
  });

  it("wilayah status aria-live ada, kosong saat tidak diproses", () => {
    renderCard();
    choose();
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("");
  });
});
