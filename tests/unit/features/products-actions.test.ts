import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/services/session", () => ({
  requireSessionContext: vi.fn(async () => ({ tenantId: "t1", userId: "u1", role: "owner" })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

function buildSupabase(opts: {
  insertResult: { data: { id: string } | null; error: { message: string } | null };
  rpcResult: { data: unknown; error: { message: string } | null };
}) {
  const single = vi.fn(async () => opts.insertResult);
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ insert }));
  const rpc = vi.fn(async () => opts.rpcResult);
  return { from, insert, select, single, rpc };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => currentSupabase),
}));

// Populated per-test before calling the action; the mocked createClient()
// above always returns whatever this currently points at.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentSupabase: any;

function validFormData(): FormData {
  // productSchema's optional fields use `.optional().or(z.literal(""))` —
  // FormData.get() returns null (not undefined) for a field the real form
  // never omits, so every field is set explicitly here, blank where N/A,
  // matching how the real product form always submits every input.
  const fd = new FormData();
  fd.set("name", "Produk Uji");
  fd.set("description", "");
  fd.set("productType", "PHYSICAL_PRODUCT");
  fd.set("category", "");
  fd.set("price", "");
  fd.set("stock", "");
  fd.set("stockUnit", "");
  fd.set("hpp", "");
  fd.set("websiteUrl", "");
  fd.set("targetCountries", "");
  return fd;
}

import { createProductAction, archiveProductAction, reactivateProductAction } from "@/features/products/actions";

describe("createProductAction — Batch B9 P0-1/P2-3", () => {
  beforeEach(() => {
    redirectMock.mockClear();
  });

  it("inserts the product as DRAFT, then activates it via the atomic RPC and redirects on success", async () => {
    currentSupabase = buildSupabase({
      insertResult: { data: { id: "p1" }, error: null },
      rpcResult: { data: [{ allowed: true, reason: null }], error: null },
    });

    await expect(createProductAction({ error: null }, validFormData())).rejects.toThrow("REDIRECT:/products/p1?created=1");

    expect(currentSupabase.insert).toHaveBeenCalledWith(expect.objectContaining({ status: "DRAFT" }));
    expect(currentSupabase.rpc).toHaveBeenCalledWith("fn_activate_product", { p_product_id: "p1" });
  });

  it("the 10th active product on Starter succeeds (RPC allows) — product stays saved even when rejected", async () => {
    currentSupabase = buildSupabase({
      insertResult: { data: { id: "p10" }, error: null },
      rpcResult: { data: [{ allowed: true, reason: null }], error: null },
    });

    await expect(createProductAction({ error: null }, validFormData())).rejects.toThrow("REDIRECT:/products/p10?created=1");
  });

  it("the 11th active product is rejected (PRODUCT_LIMIT_REACHED) without losing the saved DRAFT product", async () => {
    currentSupabase = buildSupabase({
      insertResult: { data: { id: "p11" }, error: null },
      rpcResult: { data: [{ allowed: false, reason: "PRODUCT_LIMIT_REACHED" }], error: null },
    });

    const result = await createProductAction({ error: null }, validFormData());

    expect(result.error).toMatch(/batas jumlah produk aktif/i);
    expect(redirectMock).not.toHaveBeenCalled();
    // The insert already happened — the product was not lost.
    expect(currentSupabase.insert).toHaveBeenCalled();
  });
});

describe("archiveProductAction / reactivateProductAction — Batch B9 P2-3", () => {
  it("archiving a product calls fn_archive_product, freeing its slot", async () => {
    const rpc = vi.fn(async () => ({ data: [{ allowed: true, reason: null }], error: null }));
    currentSupabase = { rpc };

    const result = await archiveProductAction("p1");

    expect(rpc).toHaveBeenCalledWith("fn_archive_product", { p_product_id: "p1" });
    expect(result.error).toBeNull();
  });

  it("reactivating succeeds when the cap has room", async () => {
    const rpc = vi.fn(async () => ({ data: [{ allowed: true, reason: null }], error: null }));
    currentSupabase = { rpc };

    const result = await reactivateProductAction("p1");

    expect(rpc).toHaveBeenCalledWith("fn_activate_product", { p_product_id: "p1" });
    expect(result.error).toBeNull();
  });

  it("reactivation is rejected when the cap is full again (re-runs the same entitlement check as create)", async () => {
    const rpc = vi.fn(async () => ({ data: [{ allowed: false, reason: "PRODUCT_LIMIT_REACHED" }], error: null }));
    currentSupabase = { rpc };

    const result = await reactivateProductAction("p1");

    expect(result.error).toMatch(/batas jumlah produk aktif/i);
  });
});
