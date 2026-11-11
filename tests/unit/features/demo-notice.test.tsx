import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const params = vi.hoisted(() => ({ value: null as string | null }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: (k: string) => (k === "demo" ? params.value : null) }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { DemoNotice } from "@/features/marketing/demo-notice";

describe("DemoNotice", () => {
  afterEach(() => {
    cleanup();
    params.value = null;
  });

  it("shows a clear message for ?demo=busy with a way to register", () => {
    params.value = "busy";
    render(<DemoNotice />);
    expect(screen.getByRole("status").textContent).toContain("Demo sedang ramai");
    expect(screen.getByRole("link", { name: "Buat akun gratis" }).getAttribute("href")).toBe("/register");
  });

  it("shows a message for ?demo=unavailable", () => {
    params.value = "unavailable";
    render(<DemoNotice />);
    expect(screen.getByRole("status").textContent).toContain("Demo belum tersedia");
  });

  it("renders nothing without the parameter or for unknown values", () => {
    render(<DemoNotice />);
    expect(screen.queryByRole("status")).toBeNull();
    params.value = "<b>x</b>";
    render(<DemoNotice />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
