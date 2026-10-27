import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AdAccountOption } from "@/features/connections/meta-ad-account-selection-core";

const hoisted = vi.hoisted(() => ({
  list: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@/features/connections/actions", () => ({
  listMetaAdAccountsAction: (...a: unknown[]) => hoisted.list(...a),
  selectMetaAdAccountAction: (...a: unknown[]) => hoisted.select(...a),
}));

import { MetaAdAccountPicker } from "@/features/connections/meta-ad-account-picker";

const A: AdAccountOption = { id: "act_111", name: "Akun Lama", currency: "IDR", statusLabel: "Aktif", readiness: "READY", notes: [], isCurrent: true };
const B: AdAccountOption = { id: "act_222", name: "PT Tanyopo", currency: "IDR", statusLabel: "Aktif", readiness: "READY", notes: [], isCurrent: false };

function listed(accounts: AdAccountOption[], over: Record<string, unknown> = {}) {
  return { error: null, accounts, truncated: false, selectionConfirmed: false, currentMissing: false, ...over };
}

beforeEach(() => {
  hoisted.list.mockReset();
  hoisted.select.mockReset();
});
afterEach(() => cleanup());

async function open(accounts: AdAccountOption[], over: Record<string, unknown> = {}) {
  hoisted.list.mockResolvedValue(listed(accounts, over));
  const onSelected = vi.fn();
  render(<MetaAdAccountPicker currentAccountName="Akun Lama" onSelected={onSelected} />);
  fireEvent.click(screen.getByRole("button", { name: /Pilih \/ Ganti Akun Iklan/ }));
  await screen.findByTestId("meta-ad-account-list");
  return onSelected;
}

describe("MetaAdAccountPicker", () => {
  it("shows the stored account and loads nothing until the Owner asks", () => {
    render(<MetaAdAccountPicker currentAccountName="Akun Lama" onSelected={() => {}} />);
    expect(screen.getByText("Akun Lama")).toBeInTheDocument();
    expect(hoisted.list).not.toHaveBeenCalled();
  });

  it("with several accounts, selects none for the Owner and keeps Save disabled", async () => {
    await open([A, B]);
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios).toHaveLength(2);
    expect(radios.every((r) => !r.checked)).toBe(true);
    expect(screen.getByRole("button", { name: "Gunakan Akun Ini" })).toBeDisabled();
    expect(screen.getByText(/belum ada yang dipilihkan untuk Anda/)).toBeInTheDocument();
  });

  it("saves the account the Owner chose and reports it", async () => {
    hoisted.select.mockResolvedValue({ error: null, selected: { id: "act_222", name: "PT Tanyopo" } });
    const onSelected = await open([A, B]);
    fireEvent.click(screen.getAllByRole("radio")[1]);
    const save = screen.getByRole("button", { name: "Gunakan Akun Ini" });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(hoisted.select).toHaveBeenCalledWith("act_222"));
    await waitFor(() => expect(onSelected).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Akun iklan “PT Tanyopo” dipilih/)).toBeInTheDocument();
  });

  it("pre-selects the only account when there is exactly one", async () => {
    await open([A], { selectionConfirmed: false });
    expect((screen.getByRole("radio") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/Hanya ada satu akun iklan/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gunakan Akun Ini" })).toBeEnabled();
  });

  it("keeps an already confirmed current account selected but disables Save until something changes", async () => {
    await open([A, B], { selectionConfirmed: true });
    expect((screen.getAllByRole("radio")[0] as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("button", { name: "Gunakan Akun Ini" })).toBeDisabled();
    fireEvent.click(screen.getAllByRole("radio")[1]);
    expect(screen.getByRole("button", { name: "Gunakan Akun Ini" })).toBeEnabled();
  });

  it("explains the no-account case in plain Indonesian", async () => {
    hoisted.list.mockResolvedValue(listed([], { currentMissing: true }));
    render(<MetaAdAccountPicker currentAccountName={null} onSelected={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Pilih Akun Iklan" }));
    expect(await screen.findByText(/Tidak ada akun iklan pada akun Meta yang terhubung/)).toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByRole("button", { name: "Muat Ulang" })).toBeInTheDocument();
  });

  it("warns when the stored account is no longer accessible", async () => {
    await open([B], { currentMissing: true });
    expect(await screen.findByText(/tidak termasuk akun yang dapat diakses/)).toBeInTheDocument();
  });

  it("shows a load error (expired token, permission, Meta failure) and no list", async () => {
    hoisted.list.mockResolvedValue({ error: "Akses ke Meta sudah kedaluwarsa atau dicabut.", accounts: null });
    render(<MetaAdAccountPicker currentAccountName="Akun Lama" onSelected={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Pilih \/ Ganti Akun Iklan/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("kedaluwarsa");
    expect(screen.queryByTestId("meta-ad-account-list")).toBeNull();
  });

  it("survives a thrown action without ever showing success", async () => {
    hoisted.list.mockRejectedValue(new Error("network"));
    render(<MetaAdAccountPicker currentAccountName="Akun Lama" onSelected={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Pilih \/ Ganti Akun Iklan/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("gagal dimuat");
  });

  it("shows a save error and does not signal success", async () => {
    hoisted.select.mockResolvedValue({ error: "Sudah ada iklan yang dibuat di akun iklan saat ini.", selected: null });
    const onSelected = await open([A, B]);
    fireEvent.click(screen.getAllByRole("radio")[1]);
    fireEvent.click(screen.getByRole("button", { name: "Gunakan Akun Ini" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Sudah ada iklan");
    expect(onSelected).not.toHaveBeenCalled();
  });

  it("states that choosing only stores the choice (no ads, no cost)", () => {
    render(<MetaAdAccountPicker currentAccountName="Akun Lama" onSelected={() => {}} />);
    expect(screen.getByText(/tidak membuat iklan dan tidak mengeluarkan biaya/)).toBeInTheDocument();
  });
});
