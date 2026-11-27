import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// Integrasi UI-server: FormData yang dibentuk dari form ASLI (bukan tangan) dibaca registerAction ASLI; pencatat
// dimock agar argumennya terlihat. Versi yang tampil di UI = hidden input = yang dibandingkan server.

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(() => ({ allowed: true })), getClientIp: vi.fn(() => "127.0.0.1") }));

const { signUpMock, getUserMock, recordMock } = vi.hoisted(() => ({
  signUpMock: vi.fn(),
  getUserMock: vi.fn(async () => ({ data: { user: null } })),
  recordMock: vi.fn(async () => true),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { signUp: signUpMock, getUser: getUserMock } })),
}));
vi.mock("@/lib/consent/signup-legal", () => ({ recordSignupLegal: recordMock }));

import { registerAction } from "@/features/auth/actions";
import { RegisterForm } from "@/features/auth/register-form";
import { PRIVACY_NOTICE_VERSION } from "@/features/legal/legal-versions";

beforeEach(() => {
  signUpMock.mockReset();
  recordMock.mockReset();
  recordMock.mockResolvedValue(true);
  signUpMock.mockResolvedValue({ data: { user: { id: "uid-ui", identities: [{}] }, session: null }, error: null });
});
afterEach(() => cleanup());

function filledFormData(): FormData {
  render(<RegisterForm />);
  fireEvent.change(screen.getByLabelText("Nama Anda"), { target: { value: "Budi" } });
  fireEvent.change(screen.getByLabelText("Nama Bisnis"), { target: { value: "Toko Budi" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "budi@example.com" } });
  fireEvent.change(document.getElementById("password") as HTMLInputElement, { target: { value: "Rahasia-123" } });
  fireEvent.click(document.getElementById("acceptLegal") as HTMLInputElement);
  return new FormData(document.querySelector("form")!);
}

describe("RegisterForm -> registerAction: versi pemberitahuan privasi", () => {
  it("FormData form asli memuat privacyNoticeVersion = versi yang tampil di UI = PRIVACY_NOTICE_VERSION", () => {
    const fd = filledFormData();
    expect(fd.get("privacyNoticeVersion")).toBe(String(PRIVACY_NOTICE_VERSION));
    expect(fd.get("acceptLegal")).toBe("on");
    expect(document.getElementById("pemberitahuan-privasi")!.textContent).toContain(`Versi pemberitahuan: ${fd.get("privacyNoticeVersion")}`);
  });

  it("registerAction asli menerima FormData form asli: Terms diterima dan DELIVERED dicatat (privacyNoticeDelivered true)", async () => {
    const fd = filledFormData();
    const result = await registerAction({ error: null }, fd);
    expect(result.error).toBeNull();
    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordMock).toHaveBeenCalledWith("uid-ui", { privacyNoticeDelivered: true });
  });

  it("bila versi hidden dirusak (bukan versi saat ini), server tidak mencatat DELIVERED", async () => {
    const fd = filledFormData();
    fd.set("privacyNoticeVersion", String(PRIVACY_NOTICE_VERSION + 1));
    await registerAction({ error: null }, fd);
    expect(recordMock).toHaveBeenCalledWith("uid-ui", { privacyNoticeDelivered: false });
  });
});
