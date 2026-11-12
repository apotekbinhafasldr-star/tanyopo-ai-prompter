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

  it("fokus pindah ke judul langkah 8 (bukan body, bukan tombol Selesai)", async () => {
    await goToStep7();
    await click(next());
    const heading = screen.getByRole("heading", { level: 2, name: STEP8 });
    expect(heading).toHaveFocus();
    expect(screen.getByRole("button", { name: "Selesai, ke Dashboard" })).not.toHaveFocus();
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

describe("OnboardingWizard: aksesibilitas dan fokus (mobile gate 360px)", () => {
  it("setiap pindah langkah memfokuskan judul langkah, termasuk saat Lanjut menjadi nonaktif", async () => {
    render(<OnboardingWizard />);
    fireEvent.change(screen.getByLabelText("Nama bisnis"), { target: { value: "Kopi Nusantara" } });
    await click(next()); // 1 -> 2
    expect(screen.getByRole("heading", { level: 2, name: "Pasar & Preferensi Global" })).toHaveFocus();
    await click(next()); // 2 -> 3 (Lanjut nonaktif sampai ada pilihan)
    expect(next()).toBeDisabled();
    expect(screen.getByRole("heading", { level: 2, name: "Apa jenis bisnis Anda?" })).toHaveFocus();
    expect(document.body).not.toHaveFocus();
    await click(screen.getByRole("button", { name: "Kembali" }));
    expect(screen.getByRole("heading", { level: 2, name: "Pasar & Preferensi Global" })).toHaveFocus();
  });

  it("textarea langkah 4 dan select langkah 6 punya nama aksesibel dari label, bukan placeholder", async () => {
    render(<OnboardingWizard />);
    fireEvent.change(screen.getByLabelText("Nama bisnis"), { target: { value: "Kopi Nusantara" } });
    await click(next());
    await click(next());
    await click(pickFirstOption());
    await click(next()); // -> 4
    const textarea = screen.getByRole("textbox", { name: "Apa yang Anda jual" });
    expect(textarea).toHaveAttribute("id", "whatDoYouSellInput");
    fireEvent.change(textarea, { target: { value: "Kopi kemasan" } });
    await click(next()); // -> 5
    await click(pickFirstOption());
    await click(next()); // -> 6
    expect(screen.getByRole("combobox", { name: "Target pasar campaign" })).toBeInTheDocument();
  });

  it("tombol navigasi, Selesai dan Lewati memiliki tinggi minimal 44px (kelas min-h-11) dan baris tombol boleh membungkus", async () => {
    await goToStep7();
    expect(screen.getByRole("button", { name: "Kembali" }).className).toContain("min-h-11");
    expect(next().className).toContain("min-h-11");
    expect(screen.getByRole("button", { name: /Lewati/ }).className).toContain("min-h-11");
    await click(next());
    const finish = screen.getByRole("button", { name: "Selesai, ke Dashboard" });
    expect(finish.className).toContain("min-h-11");
    expect(finish.className).toContain("whitespace-normal");
    expect(finish.parentElement?.className).toContain("flex-wrap");
  });

  it("Enter tambahan setelah tiba di langkah 8 tidak mengirim form (fokus ada di judul)", async () => {
    await goToStep7();
    await click(next()); // 7 -> 8
    fireEvent.keyDown(document.activeElement as Element, { key: "Enter" });
    expect(completeMock).not.toHaveBeenCalled();
  });
});
