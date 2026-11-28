import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SheetDialog } from "@/components/ui/sheet-dialog";

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

function Harness({ closeOnBackdrop, busy, initiallyOpen = true }: { closeOnBackdrop?: boolean; busy?: boolean; initiallyOpen?: boolean }) {
  const [open, setOpen] = React.useState(initiallyOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Buka
      </button>
      <SheetDialog open={open} onClose={() => setOpen(false)} title="Judul dialog" description="Pengantar dialog" closeOnBackdrop={closeOnBackdrop} busy={busy} footer={<button type="button">Aksi</button>}>
        <p>Isi</p>
      </SheetDialog>
    </>
  );
}

describe("SheetDialog", () => {
  it("dirender sebagai <dialog> terbuka dengan nama dari judul dan deskripsi dari pengantar", () => {
    render(<Harness />);
    const dialog = screen.getByRole("dialog", { name: "Judul dialog" });
    expect(dialog.tagName).toBe("DIALOG");
    expect(dialog).toHaveAttribute("open");
    expect(dialog).toHaveAccessibleDescription("Pengantar dialog");
  });

  it("tidak ada di DOM bila tertutup", () => {
    render(<Harness initiallyOpen={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("fokus awal ke judul (tabIndex -1), bukan tombol Tutup", () => {
    render(<Harness />);
    const heading = screen.getByRole("heading", { name: "Judul dialog" });
    expect(heading).toHaveAttribute("tabindex", "-1");
    expect(document.activeElement).toBe(heading);
  });

  it("tombol Tutup: nama 'Tutup', target >= 44px (size-11), menutup dialog", () => {
    render(<Harness />);
    const close = screen.getByRole("button", { name: "Tutup" });
    expect(close).toHaveClass("size-11");
    fireEvent.click(close);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Esc (kejadian cancel) menutup lewat state dan mencegah penutupan bawaan", () => {
    render(<Harness />);
    const dialog = screen.getByRole("dialog");
    const event = new Event("cancel", { cancelable: true, bubbles: false });
    fireEvent(dialog, event);
    expect(event.defaultPrevented).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("klik latar (elemen dialog itu sendiri) menutup; klik isi tidak", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Isi"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closeOnBackdrop=false: klik latar tidak menutup", () => {
    render(<Harness closeOnBackdrop={false} />);
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("busy: Esc, latar, dan Tutup diabaikan", () => {
    render(<Harness busy />);
    const dialog = screen.getByRole("dialog");
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    fireEvent.click(dialog);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tutup" })).toBeDisabled();
  });

  it("gulir body dikunci saat terbuka dan nilai sebelumnya dipulihkan saat tertutup", () => {
    document.body.style.overflow = "scroll";
    render(<Harness />);
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Tutup" }));
    expect(document.body.style.overflow).toBe("scroll");
  });

  it("fokus kembali ke elemen yang aktif sebelum dibuka", () => {
    render(<Harness initiallyOpen={false} />);
    const opener = screen.getByRole("button", { name: "Buka" });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tutup" }));
    expect(document.activeElement).toBe(opener);
  });

  it("returnFocusRef dipakai sebagai tujuan fokus bila diberikan", () => {
    const ref = React.createRef<HTMLButtonElement>();
    function WithRef() {
      const [open, setOpen] = React.useState(true);
      return (
        <>
          <button ref={ref} type="button">
            Pemicu
          </button>
          <SheetDialog open={open} onClose={() => setOpen(false)} title="T" returnFocusRef={ref} />
        </>
      );
    }
    render(<WithRef />);
    fireEvent.click(screen.getByRole("button", { name: "Tutup" }));
    expect(document.activeElement).toBe(ref.current);
  });

  it("pemanggilan showModal terjadi tepat sekali saat dibuka", () => {
    const spy = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    render(<Harness />);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("bottom-sheet di HP (inset-x-0 bottom-0, max-h 90dvh) dan kartu tengah mulai sm; tanpa animasi non-motion-safe", () => {
    render(<Harness />);
    const cls = screen.getByRole("dialog").className;
    expect(cls).toContain("bottom-0");
    expect(cls).toContain("max-h-[90dvh]");
    expect(cls).toContain("sm:max-w-md");
    expect(cls).not.toMatch(/(^|\s)animate-/);
  });
});
