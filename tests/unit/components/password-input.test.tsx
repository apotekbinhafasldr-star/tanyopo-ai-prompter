import { afterEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PasswordInput } from "@/components/ui/password-input";

// This project's vitest config doesn't set `globals: true`, so
// Testing Library's usual auto-cleanup (which detects a global
// `afterEach`) never registers — without this, each render below would
// stack up in the shared jsdom document and later assertions here would
// see duplicate accessible names from earlier tests in this file.
afterEach(cleanup);

describe("PasswordInput", () => {
  it("defaults to hidden (type=password)", () => {
    render(<PasswordInput aria-label="Kata Sandi" />);
    expect(screen.getByLabelText("Kata Sandi")).toHaveAttribute("type", "password");
  });

  it("reveals the password on toggle click, and hides it again on a second click", () => {
    render(<PasswordInput aria-label="Kata Sandi" />);
    const input = screen.getByLabelText("Kata Sandi");
    const toggle = screen.getByRole("button", { name: "Tampilkan kata sandi" });

    fireEvent.click(toggle);
    expect(input).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Sembunyikan kata sandi" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sembunyikan kata sandi" }));
    expect(input).toHaveAttribute("type", "password");
  });

  it("never changes the typed value while toggling visibility", () => {
    render(<PasswordInput aria-label="Kata Sandi" defaultValue="rahasia123" />);
    const input = screen.getByLabelText("Kata Sandi") as HTMLInputElement;
    const toggle = screen.getByRole("button", { name: "Tampilkan kata sandi" });

    expect(input.value).toBe("rahasia123");
    fireEvent.click(toggle);
    expect(input.value).toBe("rahasia123");
    fireEvent.click(screen.getByRole("button", { name: "Sembunyikan kata sandi" }));
    expect(input.value).toBe("rahasia123");
  });

  it("the toggle button is type=button so it never submits the surrounding form", () => {
    render(<PasswordInput aria-label="Kata Sandi" />);
    expect(screen.getByRole("button", { name: "Tampilkan kata sandi" })).toHaveAttribute("type", "button");
  });
});
