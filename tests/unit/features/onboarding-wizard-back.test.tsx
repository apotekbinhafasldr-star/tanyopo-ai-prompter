import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { completeMock, skipMock } = vi.hoisted(() => ({ completeMock: vi.fn(), skipMock: vi.fn() }));
vi.mock("@/features/onboarding/actions", () => ({
  completeOnboardingAction: completeMock,
  skipOnboardingAction: skipMock,
}));

import { OnboardingWizard } from "@/features/onboarding/onboarding-wizard";

const T = {
  1: "Apa nama bisnis Anda?",
  2: "Pasar & Preferensi Global",
  3: "Apa jenis bisnis Anda?",
  4: "Apa yang Anda jual?",
  5: "Apa tujuan utama Anda?",
  6: "Target Pasar Campaign (opsional)",
} as const;

beforeEach(() => {
  completeMock.mockReset();
  skipMock.mockReset();
  completeMock.mockResolvedValue({ error: null });
  window.history.replaceState(null, "", "/onboarding");
});
afterEach(() => cleanup());

const click = async (el: Element) => {
  await act(async () => {
    fireEvent.click(el);
  });
};
const next = () => screen.getByRole("button", { name: /Lanjut/ });
const pickFirstOption = () => document.querySelectorAll("button[aria-pressed]")[0] as HTMLButtonElement;
const stepInState = () => (window.history.state as { onbStep?: number } | null)?.onbStep;
const heading = (n: keyof typeof T) => screen.getByRole("heading", { level: 2, name: T[n] });
const back = async () => {
  await act(async () => {
    window.history.back();
  });
};

/** Mengisi dan maju sampai langkah `target` (1..6). */
async function advanceTo(target: number) {
  render(<OnboardingWizard />);
  fireEvent.change(screen.getByLabelText("Nama bisnis"), { target: { value: "Kopi Nusantara" } });
  if (target >= 2) await click(next());
  if (target >= 3) await click(next());
  if (target >= 4) {
    await click(pickFirstOption());
    await click(next());
  }
  if (target >= 5) {
    fireEvent.change(document.querySelector("textarea")!, { target: { value: "Kopi kemasan siap seduh" } });
    await click(next());
  }
  if (target >= 6) {
    await click(pickFirstOption());
    await click(next());
  }
}

describe("OnboardingWizard: tombol Back Android memundurkan satu langkah (UNIT/jsdom)", () => {
  it("setiap langkah menambah satu entri riwayat dengan nomor langkahnya", async () => {
    render(<OnboardingWizard />);
    expect(stepInState()).toBe(1);
    const before = window.history.length;
    fireEvent.change(screen.getByLabelText("Nama bisnis"), { target: { value: "Kopi Nusantara" } });
    await click(next());
    expect(stepInState()).toBe(2);
    expect(window.history.length).toBe(before + 1);
    expect(window.location.pathname).toBe("/onboarding");
  });

  it("Back di langkah 5 kembali ke langkah 4 (bukan keluar), isian tetap utuh", async () => {
    await advanceTo(5);
    heading(5);
    await back();
    await waitFor(() => expect(heading(4)).toBeInTheDocument());
    expect(window.location.pathname).toBe("/onboarding");
    expect(document.querySelector("textarea")).toHaveValue("Kopi kemasan siap seduh");

    await back();
    await waitFor(() => expect(heading(3)).toBeInTheDocument());
    expect(pickFirstOption()).toHaveAttribute("aria-pressed", "true");

    await back();
    await back();
    await waitFor(() => expect(heading(1)).toBeInTheDocument());
    expect(screen.getByLabelText("Nama bisnis")).toHaveValue("Kopi Nusantara");
  });

  it("Forward setelah Back memulihkan langkah dengan isian yang sama", async () => {
    await advanceTo(4);
    await back();
    await waitFor(() => expect(heading(3)).toBeInTheDocument());
    await act(async () => {
      window.history.forward();
    });
    await waitFor(() => expect(heading(4)).toBeInTheDocument());
    expect(document.querySelector("textarea")).toHaveValue("Kopi kemasan siap seduh");
  });

  it("Back tidak mengirim form dan fokus pindah ke judul langkah", async () => {
    await advanceTo(4);
    await back();
    await waitFor(() => expect(heading(3)).toHaveFocus());
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("tombol 'Kembali' di layar mundur langsung dan menyamakan riwayat", async () => {
    await advanceTo(3);
    await click(screen.getByRole("button", { name: /Kembali/ }));
    expect(heading(2)).toBeInTheDocument();
    await waitFor(() => expect(stepInState()).toBe(2));
    // Satu Back lagi menuju langkah 1, bukan langkah 3 yang sudah ditinggalkan.
    await back();
    await waitFor(() => expect(heading(1)).toBeInTheDocument());
  });
});
