import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import { MetricCard } from "@/features/dashboard/metric-card";
import { Activity } from "lucide-react";
import AppLoading from "@/app/(app)/loading";

afterEach(cleanup);

// jsdom does not apply Tailwind, so these assert the class contract: phones
// (below the `sm` breakpoint) get >=44px targets (h-11 / size-11); compact
// heights only return from `sm:` up.
describe("mobile touch targets (>=44px on phones)", () => {
  it.each(["sm", "md", "icon"] as const)("Button size=%s is 44px below the sm breakpoint", (size) => {
    render(<Button size={size}>Aksi</Button>);
    const cls = screen.getByRole("button").className;
    expect(cls).toMatch(/(^|\s)(h-11|size-11)(\s|$)/);
    expect(cls).not.toMatch(/(^|\s)(h-8|h-10|w-10)(\s|$)/);
  });

  it("Input is 44px tall on phones", () => {
    render(<Input aria-label="Email" />);
    expect(screen.getByLabelText("Email").className).toMatch(/(^|\s)h-11(\s|$)/);
  });
});

describe("status and empty/loading states", () => {
  it("shows a provider block as its own danger state, not as 'Kedaluwarsa'", () => {
    render(<StatusPill status="BLOCKED_EXTERNAL" />);
    expect(screen.getByText("Diblokir Penyedia")).toBeInTheDocument();
    expect(screen.queryByText("Kedaluwarsa")).toBeNull();
  });

  it("MetricCard empty state exposes 'Belum ada data' to assistive tech", () => {
    render(<MetricCard label="ROAS" icon={Activity} />);
    expect(screen.getByLabelText("Belum ada data")).toBeInTheDocument();
  });

  it("app segment loading state is an announced status region", () => {
    render(<AppLoading />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(region).toHaveTextContent("Memuat halaman");
  });
});
