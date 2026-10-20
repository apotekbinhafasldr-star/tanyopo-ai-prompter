import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync, existsSync } from "node:fs";
import { CompanyContact } from "@/features/legal/company-contact";
import { LEGAL } from "@/features/legal/legal-meta";

afterEach(() => cleanup());

describe("official operator contact block", () => {
  it("shows operator, address, phone and email from LEGAL only", () => {
    const { container } = render(<CompanyContact />);
    const text = container.textContent ?? "";
    expect(text).toContain("PT Tanyopo Future Technology");
    expect(text).toContain("Ladang Rimba, Aceh Selatan, Indonesia");
    expect(text).toContain("085831815889");
    expect(text).toContain("tanyopofuturetechnology@gmail.com");
    expect(container.querySelector('a[href="tel:+6285831815889"]')).not.toBeNull();
    expect(container.querySelector(`a[href="mailto:${LEGAL.contactEmail}"]`)).not.toBeNull();
    expect(container.querySelector("address")).not.toBeNull();
  });
});

describe("landing and legal footers", () => {
  it("both footers render the contact block and name the legal operator", () => {
    for (const f of ["app/(marketing)/layout.tsx", "app/(legal)/layout.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src).toContain("<CompanyContact");
    }
    const landing = readFileSync("app/(marketing)/layout.tsx", "utf8");
    expect(landing).toContain("LEGAL.operator");
    expect(landing).toContain("<LegalLinks");
  });

  it("Tanyopo Labs is documented as an ecosystem name, not the legal operator", () => {
    const brand = readFileSync("lib/brand.ts", "utf8");
    expect(brand).toMatch(/NOT the legal\s+\*?\s*operator/);
  });
});

describe("landing pricing does not send visitors into a non-working checkout", () => {
  const src = readFileSync("features/marketing/sections/pricing.tsx", "utf8");
  it("keeps the payment-live switch off and shows the honest status", () => {
    expect(src).toContain("const ONLINE_PAYMENT_LIVE = false;");
    expect(src).toContain("Pembayaran online segera tersedia");
    expect(src).toContain("belum ada penagihan");
  });
  it("only the free trial links to /register while payment is not live", () => {
    expect(src).toContain("Coba Gratis");
    // The "Pilih Paket Ini" link is only reachable behind ONLINE_PAYMENT_LIVE.
    expect(src.indexOf("ONLINE_PAYMENT_LIVE ? (")).toBeLessThan(src.indexOf("Pilih Paket Ini"));
  });
});

describe("official logo asset", () => {
  it("is a real JPEG served with a .jpg extension and no stale .png reference remains", () => {
    const p = "public/brand/linoe/linoe-logo-official.jpg";
    expect(existsSync(p)).toBe(true);
    expect(existsSync("public/brand/linoe/linoe-logo-official.png")).toBe(false);
    const head = readFileSync(p).subarray(0, 3);
    expect([...head]).toEqual([0xff, 0xd8, 0xff]);
    for (const f of ["components/brand/linoe-logo.tsx", "features/marketing/components/hero-integrated-nav.tsx"]) {
      expect(readFileSync(f, "utf8")).not.toContain("linoe-logo-official.png");
    }
  });
});

describe("refund policy draft is not published", () => {
  it("is marked BLOCKED FOR APPROVAL and not linked from any app code", () => {
    const d = readFileSync("docs/drafts/REFUND_CANCELLATION_POLICY_DRAFT.md", "utf8");
    expect(d).toContain("BLOCKED FOR APPROVAL");
    expect(existsSync("app/(legal)/refund-policy")).toBe(false);
    expect(readFileSync("features/legal/legal-meta.ts", "utf8")).not.toContain("/refund");
  });
});
