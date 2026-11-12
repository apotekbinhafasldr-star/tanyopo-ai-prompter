import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const { completeMock, skipMock } = vi.hoisted(() => ({ completeMock: vi.fn(), skipMock: vi.fn() }));
vi.mock("@/features/onboarding/actions", () => ({
  completeOnboardingAction: completeMock,
  skipOnboardingAction: skipMock,
}));

import { OnboardingWizard } from "@/features/onboarding/onboarding-wizard";

const STEP7 = "Tambahkan produk pertama Anda";
const STEP8 = "Hubungkan channel marketing";

beforeEach(() => {
  completeMock.mockReset();
  skipMock.mockReset();
  completeMock.mockResolvedValue({ error: null });
});

afterEach(() => cleanup());

const click = async (el: Element) => {
  await act(async () => {
    fireEvent.click(el);
  });
};
const next = () => screen.getByRole("button", { name: /Lanjut/ });
const pickFirstOption = () => document.querySelectorAll("button[aria-pressed]")[0] as HTMLButtonElement;

async function goToStep7() {
  render(<OnboardingWizard />);
  fireEvent.change(screen.getByLabelText("Nama bisnis"), { target: { value: "Kopi Nusantara" } });
  await click(next()); // 1 -> 2
  await click(next()); // 2 -> 3
  await click(pickFirstOption());
  await click(next()); // 3 -> 4
  fireEvent.change(document.querySelector("textarea")!, { target: { value: "Kopi kemasan siap seduh" } });
  await click(next()); // 4 -> 5
  await click(pickFirstOption());
  await click(next()); // 5 -> 6
  await click(next()); // 6 -> 7
  expect(screen.getByText(STEP7)).toBeInTheDocument();
}

describe("OnboardingWizard: navigasi langkah 7 ke 8", () => {
  it("Lanjut di langkah 7 hanya membuka langkah 8 dan TIDAK mengirim form", async () => {
    await goToStep7();
    const nextButton = next();
    await click(nextButton); // 7 -> 8

    expect(screen.getByText(STEP8)).toBeInTheDocument();
    expect(completeMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Lanjut/ })).toBeNull();
    const finish = screen.getByRole("button", { name: "Selesai, ke Dashboard" });
    // AKAR MASALAH: tombol yang diklik (type=button) tidak boleh menjadi elemen yang sama dengan tombol submit. Bila React
    // memakai ulang elemen itu, browser nyata memperlakukan klik yang sama sebagai submit (langkah 8 terlewati).
    expect(finish).not.toBe(nextButton);
    expect(nextButton.isConnected).toBe(false);
    expect(finish).toBeEnabled();
    expect(finish).not.toHaveAttribute("aria-busy");
    expect(finish).toHaveAttribute("type", "submit");
  });

  it("fokus pindah ke tombol Selesai saat langkah 8 terbuka (tidak jatuh ke body)", async () => {
    await goToStep7();
    await click(next());
    expect(screen.getByRole("button", { name: "Selesai, ke Dashboard" })).toHaveFocus();
  });

  it("tombol Lanjut tidak pernah bertipe submit pada langkah 1 sampai 7", async () => {
    await goToStep7();
    expect(next()).toHaveAttribute("type", "button");
  });

  it("Selesai di langkah 8 mengirim form tepat satu kali dengan data yang diisi", async () => {
    await goToStep7();
    await click(next()); // 7 -> 8
    await click(screen.getByRole("button", { name: "Selesai, ke Dashboard" }));

    expect(completeMock).toHaveBeenCalledTimes(1);
    const formData = completeMock.mock.calls[0][1] as FormData;
    expect(formData.get("brandName")).toBe("Kopi Nusantara");
    expect(formData.get("whatDoYouSell")).toBe("Kopi kemasan siap seduh");
    expect(formData.get("countryCode")).toBe("ID");
    expect(String(formData.get("businessCategory"))).not.toBe("");
    expect(String(formData.get("primaryGoal"))).not.toBe("");
  });

  it("Kembali dari langkah 8 ke 7 lalu Lanjut lagi bekerja tanpa mengirim form", async () => {
    await goToStep7();
    await click(next()); // 7 -> 8
    await click(screen.getByRole("button", { name: /Kembali/ }));
    expect(screen.getByText(STEP7)).toBeInTheDocument();
    expect(completeMock).not.toHaveBeenCalled();

    await click(next()); // 7 -> 8 lagi
    expect(screen.getByText(STEP8)).toBeInTheDocument();
    expect(completeMock).not.toHaveBeenCalled();
  });

  it("data tetap ada setelah Kembali (nama bisnis tidak hilang)", async () => {
    render(<OnboardingWizard />);
    fireEvent.change(screen.getByLabelText("Nama bisnis"), { target: { value: "Kopi Nusantara" } });
    await click(next());
    await click(screen.getByRole("button", { name: /Kembali/ }));
    expect(screen.getByLabelText("Nama bisnis")).toHaveValue("Kopi Nusantara");
  });
});

describe("OnboardingWizard: validasi, submit liar, dan loading", () => {
  it("Lanjut dinonaktifkan di langkah 1 sampai nama bisnis minimal 2 karakter", () => {
    render(<OnboardingWizard />);
    expect(next()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Nama bisnis"), { target: { value: "K" } });
    expect(next()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Nama bisnis"), { target: { value: "Ko" } });
    expect(next()).toBeEnabled();
  });

  it("submit liar (mis. Enter) sebelum langkah terakhir tidak memanggil action", async () => {
    render(<OnboardingWizard />);
    const form = document.querySelector("form")!;

    await act(async () => {
      fireEvent.submit(form);
    });
    expect(completeMock).not.toHaveBeenCalled();
    expect(screen.getByText("Apa nama bisnis Anda?")).toBeInTheDocument(); // nama kosong: tetap di langkah 1

    fireEvent.change(screen.getByLabelText("Nama bisnis"), { target: { value: "Kopi Nusantara" } });
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(completeMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Apa nama bisnis Anda?")).toBeNull(); // valid: maju ke langkah 2, tetap tanpa kirim
  });

  it("saat mengirim: tombol Selesai sibuk dan klik ulang tidak mengirim dua kali", async () => {
    let resolve!: (v: { error: null }) => void;
    completeMock.mockImplementation(() => new Promise((r) => (resolve = r)));
    await goToStep7();
    await click(next());
    const finish = screen.getByRole("button", { name: "Selesai, ke Dashboard" });
    await click(finish);

    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(finish).toBeDisabled();
    expect(finish).toHaveAttribute("aria-busy", "true");
    await click(finish);
    expect(completeMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve({ error: null });
    });
  });

  it("'Lewati' hanya muncul mulai langkah 7", async () => {
    render(<OnboardingWizard />);
    expect(screen.queryByRole("button", { name: /Lewati/ })).toBeNull();
    await goToStep7Again();
    expect(screen.getByRole("button", { name: /Lewati/ })).toBeInTheDocument();
  });
});

async function goToStep7Again() {
  fireEvent.change(screen.getByLabelText("Nama bisnis"), { target: { value: "Kopi Nusantara" } });
  await click(next());
  await click(next());
  await click(pickFirstOption());
  await click(next());
  fireEvent.change(document.querySelector("textarea")!, { target: { value: "Kopi kemasan siap seduh" } });
  await click(next());
  await click(pickFirstOption());
  await click(next());
  await click(next());
}
