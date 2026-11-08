import { describe, expect, it } from "vitest";
import { FAQS } from "@/features/marketing/faq-data";
import { LEGAL } from "@/features/legal/legal-meta";

const find = (fragment: string) => FAQS.find((f) => f.q.includes(fragment));

describe("FAQ — pricing, trial, refund and support", () => {
  it("has the four entries", () => {
    for (const fragment of ["harga", "trial 14 hari", "refund", "menghubungi dukungan"]) {
      expect(find(fragment), fragment).toBeDefined();
    }
  });

  it("every one of them says online payment is not active yet (except pure support contact)", () => {
    for (const fragment of ["harga", "trial 14 hari", "refund"]) {
      expect(find(fragment)!.a, fragment).toContain("belum aktif");
    }
  });

  it("refund is manual by email, like /refund", () => {
    const a = find("refund")!.a;
    expect(a).toContain(LEGAL.contactEmail);
    expect(a).toContain("manual");
    expect(a).not.toMatch(/otomatis dikembalikan|garansi|dijamin/i);
  });

  it("support entry uses the shared contact email", () => {
    expect(find("menghubungi dukungan")!.a).toContain(LEGAL.contactEmail);
  });

  it("trial entry matches the 14-day, no-card trial", () => {
    const a = find("trial 14 hari")!.a;
    expect(a).toContain("14 hari");
    expect(a).toContain("fitur AI dijeda");
  });

  it("does not promise anything that is not live", () => {
    for (const f of FAQS) expect(f.a, f.q).not.toMatch(/pembayaran (online )?(sudah )?aktif/i);
  });
});
