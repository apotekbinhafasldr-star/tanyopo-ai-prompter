import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let session: { tenantId: string; userId: string; role: string };
vi.mock("@/services/session", () => ({ requireSessionContext: vi.fn(async () => session) }));

interface Call { table: string; op: "upsert" | "insert"; payload: Record<string, unknown> }
let calls: Call[];
let failUpsert = false;
let failAudit = false;
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => ({
      upsert: async (payload: Record<string, unknown>) => {
        calls.push({ table, op: "upsert", payload });
        return { error: failUpsert ? { message: "rls" } : null };
      },
      insert: async (payload: Record<string, unknown>) => {
        calls.push({ table, op: "insert", payload });
        return { error: failAudit ? { message: "audit down" } : null };
      },
    }),
  })),
}));

import { updateBrandProfileAction } from "@/features/settings/actions";
import { BrandProfileForm } from "@/features/settings/brand-profile-form";
import { normalizeWebsiteUrl, normalizeWhatsapp } from "@/schemas/brand-profile";
import { buildVerifiedFacts } from "@/lib/seo/ai-search-readiness";

const LINOE_URL = "https://tanyopo-ai-prompter.netlify.app";
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const prev = { error: null };
const upsert = () => calls.find((c) => c.op === "upsert");
const audit = () => calls.find((c) => c.table === "prompter_audit_logs");

beforeEach(() => {
  session = { tenantId: "t1", userId: "u1", role: "owner" };
  calls = [];
  failUpsert = false;
  failAudit = false;
});
afterEach(cleanup);

describe("normalisasi & validasi", () => {
  it("URL: hanya http/https; tanpa skema → https; skema berbahaya/rusak ditolak", () => {
    expect(normalizeWebsiteUrl("https://tokoanda.id/")).toBe("https://tokoanda.id");
    expect(normalizeWebsiteUrl("tokoanda.id")).toBe("https://tokoanda.id");
    expect(normalizeWebsiteUrl("http://tokoanda.id/menu?x=1")).toBe("http://tokoanda.id/menu?x=1");
    for (const bad of ["javascript:alert(1)", "ftp://a.id", "data:text/html,x", "mailto:a@b.id", "https://localhost", "https://user:pw@a.id", "a b.id", "", "https://" + "a".repeat(300) + ".id"]) {
      expect(normalizeWebsiteUrl(bad), bad).toBeNull();
    }
  });
  it("WhatsApp: 8–15 digit, +opsional; format sisipan dibersihkan; huruf ditolak", () => {
    expect(normalizeWhatsapp("0812-3456-789")).toBe("08123456789");
    expect(normalizeWhatsapp("+62 812 3456 789")).toBe("+628123456789");
    for (const bad of ["abc", "123", "08123456789012345678", "0812x456789", ""]) expect(normalizeWhatsapp(bad), bad).toBeNull();
  });
});

describe("updateBrandProfileAction — role guard", () => {
  it.each(["owner", "marketing"])("%s boleh menyimpan", async (role) => {
    session.role = role;
    const r = await updateBrandProfileAction(prev, fd({ brandName: "Kopi Nusa" }));
    expect(r.error).toBeNull();
    expect(upsert()?.payload.brand_name).toBe("Kopi Nusa");
  });
  it.each(["apoteker", "kasir", "admin_gudang", "hr", "viewer", ""])("%s ditolak tanpa penulisan apa pun", async (role) => {
    session.role = role;
    const r = await updateBrandProfileAction(prev, fd({ brandName: "Kopi Nusa" }));
    expect(r.error).toMatch(/izin/);
    expect(calls).toHaveLength(0);
  });
});

describe("updateBrandProfileAction — isolasi tenant", () => {
  it("tenant_id selalu dari sesi server; tenantId/tenant_id dari form diabaikan", async () => {
    await updateBrandProfileAction(prev, fd({ brandName: "Kopi Nusa", tenantId: "t-lain", tenant_id: "t-lain", tenant: "t-lain" }));
    expect(upsert()?.payload.tenant_id).toBe("t1");
    expect(JSON.stringify(calls)).not.toContain("t-lain");
    expect(audit()?.payload.tenant_id).toBe("t1");
    expect(audit()?.payload.actor_user_id).toBe("u1");
  });
  it("hanya kolom brand yang ditulis (tidak menyentuh billing/preferensi)", async () => {
    await updateBrandProfileAction(prev, fd({ brandName: "K", websiteUrl: "tokoanda.id", whatsappNumber: "08123456789", whatDoYouSell: "Kopi" }));
    expect(Object.keys(upsert()!.payload).sort()).toEqual(["brand_name", "tenant_id", "website_url", "what_do_you_sell", "whatsapp_number"].sort());
  });
});

describe("updateBrandProfileAction — tidak menimpa dengan kosong", () => {
  it("field opsional kosong → kolom tidak disertakan (nilai lama dipertahankan)", async () => {
    await updateBrandProfileAction(prev, fd({ brandName: "Kopi Nusa", websiteUrl: "", whatsappNumber: "  ", whatDoYouSell: "" }));
    expect(Object.keys(upsert()!.payload).sort()).toEqual(["brand_name", "tenant_id"]);
  });
  it("hapus hanya lewat centang eksplisit → null", async () => {
    await updateBrandProfileAction(prev, fd({ brandName: "Kopi Nusa", websiteUrl: "", clearWebsiteUrl: "on" }));
    expect(upsert()!.payload).toMatchObject({ website_url: null });
    expect("whatsapp_number" in upsert()!.payload).toBe(false);
  });
  it("nilai baru menang atas centang hapus; nama brand tidak boleh kosong", async () => {
    await updateBrandProfileAction(prev, fd({ brandName: "Kopi Nusa", websiteUrl: "tokoanda.id", clearWebsiteUrl: "on" }));
    expect(upsert()!.payload.website_url).toBe("https://tokoanda.id");
    calls = [];
    const r = await updateBrandProfileAction(prev, fd({ brandName: " " }));
    expect(r.error).toMatch(/minimal 2/);
    expect(calls).toHaveLength(0);
  });
  it("validasi: URL/WhatsApp/panjang tidak valid → error, tanpa penulisan", async () => {
    for (const bad of [{ websiteUrl: "javascript:alert(1)" }, { websiteUrl: "ftp://a.id" }, { whatsappNumber: "abc" }, { brandName: "x".repeat(121) }, { whatDoYouSell: "y".repeat(501) }]) {
      calls = [];
      const r = await updateBrandProfileAction(prev, fd({ brandName: "Kopi Nusa", ...bad }));
      expect(r.error, JSON.stringify(bad)).toBeTruthy();
      expect(calls).toHaveLength(0);
    }
  });
});

describe("updateBrandProfileAction — audit jujur", () => {
  it("audit memuat nama field yang berubah, bukan nilainya", async () => {
    await updateBrandProfileAction(prev, fd({ brandName: "Rahasia Brand", whatsappNumber: "08123456789" }));
    expect(audit()?.payload.action).toBe("brand_profile.updated");
    expect(audit()?.payload.context).toEqual({ changed_fields: ["brand_name", "whatsapp_number"] });
    expect(JSON.stringify(audit()?.payload)).not.toMatch(/Rahasia Brand|08123456789/);
  });
  it("audit gagal → data tersimpan tetapi hasil memberi notice, bukan klaim sukses audit", async () => {
    failAudit = true;
    const r = await updateBrandProfileAction(prev, fd({ brandName: "Kopi Nusa" }));
    expect(r.error).toBeNull();
    expect(r.saved).toBe(true);
    expect(r.notice).toMatch(/audit gagal/i);
  });
  it("simpan gagal (mis. ditolak RLS) → error, audit tidak dicatat", async () => {
    failUpsert = true;
    const r = await updateBrandProfileAction(prev, fd({ brandName: "Kopi Nusa" }));
    expect(r.error).toBeTruthy();
    expect(r.saved).toBeUndefined();
    expect(audit()).toBeUndefined();
  });
});

describe("aktivasi fakta publik LINOE (PR #106) dari hasil form", () => {
  const brandFrom = (payload: Record<string, unknown>) => ({ brand_name: payload.brand_name as string, website_url: (payload.website_url as string) ?? null });
  const hasLinoe = (b: ReturnType<typeof brandFrom>) => buildVerifiedFacts({ brand: b, product: { name: "X" } }).some((f) => f.key.startsWith("linoe_"));

  it("brand LINOE + website resmi dari form → fakta LINOE aktif", async () => {
    await updateBrandProfileAction(prev, fd({ brandName: "LINOE by Tanyopo", websiteUrl: "tanyopo-ai-prompter.netlify.app" }));
    expect(upsert()!.payload.website_url).toBe(LINOE_URL);
    expect(hasLinoe(brandFrom(upsert()!.payload))).toBe(true);
  });
  it("Kopi Nusa memakai URL LINOE sebagai referensi → tidak aktif", async () => {
    await updateBrandProfileAction(prev, fd({ brandName: "Kopi Nusa", websiteUrl: LINOE_URL }));
    expect(hasLinoe(brandFrom(upsert()!.payload))).toBe(false);
  });
  it("brand LINOE tanpa website → tidak aktif", async () => {
    await updateBrandProfileAction(prev, fd({ brandName: "LINOE" }));
    expect(hasLinoe(brandFrom(upsert()!.payload))).toBe(false);
  });
  it("host tiruan → tidak aktif", async () => {
    await updateBrandProfileAction(prev, fd({ brandName: "LINOE", websiteUrl: "https://tanyopo-ai-prompter.netlify.app.evil.com" }));
    expect(hasLinoe(brandFrom(upsert()!.payload))).toBe(false);
  });
});

describe("BrandProfileForm (UI)", () => {
  const values = { brandName: "Kopi Nusa", whatDoYouSell: "Kopi", websiteUrl: "https://kopinusa.id", whatsappNumber: "08123456789" };
  it("prefill data lama + atribut keyboard Android (url/tel) + batas panjang", () => {
    render(<BrandProfileForm values={values} readOnly={false} />);
    expect(screen.getByLabelText("Nama brand")).toHaveValue("Kopi Nusa");
    const url = screen.getByLabelText(/Website brand/);
    expect(url).toHaveValue("https://kopinusa.id");
    expect(url).toHaveAttribute("inputmode", "url");
    expect(url).toHaveAttribute("maxlength", "300");
    const wa = screen.getByLabelText(/Kontak WhatsApp/);
    expect(wa).toHaveValue("08123456789");
    expect(wa).toHaveAttribute("inputmode", "tel");
    expect(screen.getByLabelText(/Yang Anda jual/)).toHaveValue("Kopi");
  });
  it("centang Hapus hanya muncul bila ada nilai tersimpan", () => {
    render(<BrandProfileForm values={{ ...values, websiteUrl: "", whatsappNumber: "" }} readOnly={false} />);
    expect(screen.queryByLabelText("Hapus website yang tersimpan")).toBeNull();
    expect(screen.queryByLabelText("Hapus nomor yang tersimpan")).toBeNull();
    expect(screen.getByLabelText("Hapus deskripsi yang tersimpan")).toBeInTheDocument();
  });
  it("readOnly (role lain): tanpa form/input/tombol simpan", () => {
    const { container } = render(<BrandProfileForm values={values} readOnly />);
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
    expect(screen.queryByRole("button", { name: "Simpan" })).toBeNull();
    expect(screen.getByText("Kopi Nusa")).toBeInTheDocument();
    expect(screen.getByText(/Hanya Owner atau Marketing/)).toBeInTheDocument();
  });
});
