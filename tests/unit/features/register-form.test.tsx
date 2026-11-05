import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { EMAIL_FORMAT_MESSAGE } from "@/schemas/auth";

const VALUES = { nama: "Budi", namaUsaha: "Toko Budi", email: "budi@example.com" };

async function submit() {
  const form = document.querySelector("form")!;
  await act(async () => {
    fireEvent.submit(form);
  });
}

beforeEach(() => {
  registerActionMock.mockReset();
});

afterEach(() => cleanup());

describe("RegisterForm — email format on blur (client only)", () => {
  it("shows a clear message when the email format is wrong after leaving the field", () => {
    render(<RegisterForm />);
    const email = screen.getByLabelText("Email") as HTMLInputElement;

    fireEvent.change(email, { target: { value: "budi@" } });
    fireEvent.blur(email);

    expect(screen.getByRole("alert").textContent).toBe(EMAIL_FORMAT_MESSAGE);
    expect(email.getAttribute("aria-invalid")).toBe("true");
  });

  it("shows nothing for a valid email, and nothing for an empty field", () => {
    render(<RegisterForm />);
    const email = screen.getByLabelText("Email") as HTMLInputElement;

    fireEvent.blur(email);
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.change(email, { target: { value: "budi@example.com" } });
    fireEvent.blur(email);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(email.getAttribute("aria-invalid")).toBeNull();
  });

  it("does not validate on every keystroke, and clears the message once the value becomes valid", () => {
    render(<RegisterForm />);
    const email = screen.getByLabelText("Email") as HTMLInputElement;

    fireEvent.change(email, { target: { value: "bud" } });
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.blur(email);
    expect(screen.getByRole("alert")).toBeTruthy();

    fireEvent.change(email, { target: { value: "budi@example.com" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("makes no server request on blur: no server action, no fetch, no lookup", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}"));
    render(<RegisterForm />);
    const email = screen.getByLabelText("Email") as HTMLInputElement;

    fireEvent.change(email, { target: { value: "sudah-terdaftar@example.com" } });
    fireEvent.blur(email);
    fireEvent.change(email, { target: { value: "salah@" } });
    fireEvent.blur(email);

    expect(registerActionMock).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("does not block submit on a client-side format error (the server stays the authority)", async () => {
    registerActionMock.mockResolvedValue({ error: "Format email tidak valid", values: VALUES });
    render(<RegisterForm />);
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    fireEvent.change(email, { target: { value: "budi@" } });
    fireEvent.blur(email);

    await submit();

    expect(registerActionMock).toHaveBeenCalledTimes(1);
  });
});

describe("RegisterForm — sign-in hint", () => {
  it("always shows 'Sudah punya akun? Masuk' pointing at /login, without any lookup", () => {
    render(<RegisterForm />);
    expect(screen.getByText(/Sudah punya akun\?/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Masuk" }).getAttribute("href")).toBe("/login");
  });
});

describe("RegisterForm — email already registered", () => {
  const existing = { error: null, info: null, existingAccount: true, values: VALUES };

  it("offers the three choices: sign in, forgot password, use another email", async () => {
    registerActionMock.mockResolvedValue(existing);
    render(<RegisterForm />);
    await submit();

    expect(screen.getByText("Email sudah terdaftar")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Masuk ke akun Anda" }).getAttribute("href")).toBe("/login");
    expect(screen.getByRole("link", { name: "Lupa kata sandi?" }).getAttribute("href")).toBe("/forgot-password");
    expect(screen.getByRole("button", { name: "Gunakan email lain" })).toBeTruthy();
    expect(document.body.textContent).toMatch(/tidak mengubah akun yang ada/i);
  });

  it("'Gunakan email lain' returns to the form with nama, bisnis and email kept and the password empty", async () => {
    registerActionMock.mockResolvedValue(existing);
    render(<RegisterForm />);
    await submit();

    fireEvent.click(screen.getByRole("button", { name: "Gunakan email lain" }));

    expect((screen.getByLabelText("Nama Anda") as HTMLInputElement).value).toBe("Budi");
    expect((screen.getByLabelText("Nama Bisnis") as HTMLInputElement).value).toBe("Toko Budi");
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("budi@example.com");
    expect((document.getElementById("password") as HTMLInputElement).value).toBe("");
    expect((document.getElementById("acceptLegal") as HTMLInputElement).checked).toBe(false);
  });

  it("the password is never rendered back: no password value anywhere in the DOM after the card", async () => {
    registerActionMock.mockResolvedValue(existing);
    render(<RegisterForm />);
    await submit();
    fireEvent.click(screen.getByRole("button", { name: "Gunakan email lain" }));
    const inputs = Array.from(document.querySelectorAll("input")) as HTMLInputElement[];
    for (const input of inputs.filter((i) => i.type === "password")) expect(input.value).toBe("");
  });
});

describe("RegisterForm — unknown outcome", () => {
  it("says the request may have been processed, keeps the typed values, and offers sign-in / reset links", async () => {
    registerActionMock.mockResolvedValue({
      error: "Kami tidak menerima kepastian dari server, jadi permintaan Anda mungkin sudah diproses.",
      uncertain: true,
      values: VALUES,
    });
    render(<RegisterForm />);
    await submit();

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/mungkin sudah diproses/i);
    expect(alert.textContent).not.toMatch(/belum dibuat/i);
    expect(screen.getAllByRole("link", { name: "Masuk" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Lupa kata sandi?" })).toBeTruthy();
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("budi@example.com");
  });

  it("an ordinary error does not show the sign-in / reset links", async () => {
    registerActionMock.mockResolvedValue({ error: "Kata sandi minimal 8 karakter", values: VALUES });
    render(<RegisterForm />);
    await submit();
    expect(screen.queryByRole("link", { name: "Lupa kata sandi?" })).toBeNull();
  });
});
