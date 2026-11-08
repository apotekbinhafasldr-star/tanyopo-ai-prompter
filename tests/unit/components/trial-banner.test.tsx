import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
vi.mock("@/features/auth/actions", () => ({ logoutAction: vi.fn() }));
vi.mock("@/components/brand/linoe-logo", () => ({ LinoeLogo: () => <span>LINOE</span> }));
vi.mock("@/services/platform-admin", () => ({ canSeeAdminCenterLink: vi.fn(async () => false) }));
vi.mock("@/services/session", () => ({
  requireSessionContext: vi.fn(async () => ({
    tenantId: "t1",
    businessName: "Toko Contoh",
    userName: "Pelanggan",
    role: "owner",
  })),
}));

const hoisted = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  throws: false,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => {
    if (hoisted.throws) throw new Error("no cookies");
    return {
      from: (table: string) => {
        if (table !== "prompter_subscriptions") throw new Error(`Unexpected table: ${table}`);
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: hoisted.row, error: null }) }) }) };
      },
    };
  }),
}));

import { TrialBanner } from "@/components/layout/trial-banner";
import { AppShell } from "@/components/layout/app-shell";
import AppLayout from "@/app/(app)/layout";

const DAY = 24 * 60 * 60 * 1000;

function subscription(overrides: Record<string, unknown>) {
  // Same shape getOrCreateSubscription() inserts for a new tenant.
  return {
    tenant_id: "t1",
    plan: "FREE",
    status: "TRIALING",
    billing_provider: null,
    current_period_start: new Date(Date.now() - 9 * DAY).toISOString(),
    current_period_end: new Date(Date.now() + 5 * DAY - 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

async function layoutBanner(): Promise<ReactElement | null> {
  const shell = (await AppLayout({ children: null })) as ReactElement<{ banner: ReactElement | null }>;
  return shell.props.banner;
}

beforeEach(() => {
  hoisted.row = null;
  hoisted.throws = false;
});
afterEach(() => cleanup());

describe("TrialBanner", () => {
  it("shows the remaining days and links to /billing", () => {
    render(<TrialBanner daysRemaining={5} expired={false} />);
    expect(screen.getByText("Trial LINOE: sisa 5 hari")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Lihat paket" })).toHaveAttribute("href", "/billing");
  });

  it("says honestly that the trial ended and AI features are paused", () => {
    render(<TrialBanner daysRemaining={0} expired />);
    expect(screen.getByText(/Trial berakhir, fitur AI dijeda/)).toBeInTheDocument();
    expect(screen.getByText(/Pembayaran online belum tersedia/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Lihat paket" })).toHaveAttribute("href", "/billing");
  });

  it("renders nothing without a day count when not expired", () => {
    const { container } = render(<TrialBanner daysRemaining={null} expired={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("AppShell banner slot", () => {
  it("renders the banner above the page content", () => {
    render(
      <AppShell businessName="T" userName="U" userRole="owner" banner={<p>spanduk</p>}>
        <p>isi halaman</p>
      </AppShell>,
    );
    const banner = screen.getByText("spanduk");
    const content = screen.getByText("isi halaman");
    expect(banner.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("(app) layout trial banner", () => {
  it("shows days left for a TRIALING tenant using the real getTrialState", async () => {
    hoisted.row = subscription({});
    const banner = await layoutBanner();
    expect(banner).not.toBeNull();
    render(banner as ReactElement);
    expect(screen.getByText("Trial LINOE: sisa 5 hari")).toBeInTheDocument();
  });

  it("shows the expired message once the trial period has ended (status is still TRIALING)", async () => {
    hoisted.row = subscription({ current_period_end: new Date(Date.now() - DAY).toISOString() });
    render((await layoutBanner()) as ReactElement);
    expect(screen.getByText(/Trial berakhir, fitur AI dijeda/)).toBeInTheDocument();
  });

  it("shows nothing for a non-trialing subscription", async () => {
    hoisted.row = subscription({ status: "ACTIVE" });
    expect(await layoutBanner()).toBeNull();
  });

  it("shows nothing when there is no subscription row yet (the layout never creates one)", async () => {
    hoisted.row = null;
    expect(await layoutBanner()).toBeNull();
  });

  it("never breaks the app when the lookup fails", async () => {
    hoisted.throws = true;
    expect(await layoutBanner()).toBeNull();
  });
});
