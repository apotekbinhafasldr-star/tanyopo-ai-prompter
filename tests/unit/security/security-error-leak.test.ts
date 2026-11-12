// @vitest-environment node
/**
 * QA/Security (2026-11-11) — information leakage in error responses.
 *
 * VERIFIED GAP (SEC-03): the four UMKMpro integration routes answer a 500 with `err.message` of whatever was thrown
 * (a database/driver message can name tables, columns or constraints). The caller is an HMAC-authenticated service, so
 * the exposure is narrow, but the fix is one line per route and lives in a file this task does not own.
 *
 * How this file pins it:
 *  - the static scan lists EXACTLY the files that leak today, so a NEW leaking route fails CI, and fixing one of the
 *    four forces you to shrink KNOWN_LEAKS (the test then fails until you do);
 *  - the behavioural test asserts the CURRENT (leaking) behaviour: it passes while the leak exists and fails the day
 *    the leak is fixed, which is the signal to invert the two assertions (the body must then NOT contain the text).
 *
 * Label: CODE + UNIT TEST. No network, no database.
 */
import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function walk(dir: string, accept: (name: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, accept, out);
    else if (accept(name)) out.push(path.relative(ROOT, full).split(path.sep).join("/"));
  }
  return out;
}

// SEC-03 fixed: no route may echo a caught error. The list must stay empty.
const KNOWN_LEAKS: string[] = [];

/** `catch (err) { ... err instanceof Error ? err.message : ... }` feeding a response. */
const RAW_ERROR_TO_CLIENT = /instanceof Error\s*\?\s*\w+\.message[\s\S]{0,200}?(apiError|NextResponse\.json|new Response)\(/;

describe("security: caught error text must not be echoed to the client", () => {
  it("no route or server action echoes a caught error to the client (SEC-03 fixed)", () => {
    const files = [
      ...walk(path.join(ROOT, "app"), (n) => n === "route.ts"),
      ...walk(path.join(ROOT, "features"), (n) => /actions?\.ts$/.test(n) || /-actions\.ts$/.test(n)),
      ...walk(path.join(ROOT, "app"), (n) => /actions?\.ts$/.test(n)),
    ];
    const leaking = [...new Set(files)].filter((f) => RAW_ERROR_TO_CLIENT.test(readFileSync(path.join(ROOT, f), "utf8"))).sort();
    expect(leaking).toEqual([...KNOWN_LEAKS].sort());
  });

  it("auth failures on the HMAC routes never reveal the secret or the expected signature", () => {
    const helper = readFileSync(path.join(ROOT, "lib/umkmpro/route-helpers.ts"), "utf8");
    expect(helper).not.toMatch(/expected/i);
    // The reason code (MISSING_HEADERS / STALE_TIMESTAMP / INVALID_SIGNATURE) is the only detail returned.
    expect(helper).toContain("${auth.reason}");
  });
});

describe("security: SEC-03 — UMKMpro conversions route 500 hides internal detail", () => {
  it("the 500 body is a fixed message and never contains the thrown error text", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    vi.doMock("@/lib/umkmpro/route-helpers", () => ({
      authorizeUmkmproRequest: vi.fn(async () => ({ rawBody: "{}", admin: {} })),
      parseJsonBody: () => ({ ok: true, data: {} }),
    }));
    vi.doMock("@/schemas/umkmpro", () => ({
      umkmproConversionSchema: { safeParse: (d: unknown) => ({ success: true, data: { tenantId: "t-1", ...(d as object) } }) },
    }));
    vi.doMock("@/services/umkmpro", () => ({
      tenantExists: vi.fn(async () => true),
      recordConversionFromUmkmpro: vi.fn(async () => {
        throw new Error('relation "prompter_conversions" violates constraint uq_internal_detail');
      }),
    }));

    const { POST } = await import("@/app/api/v1/integrations/umkmpro/conversions/route");
    const res = await POST(new Request("https://app.example/api/v1/integrations/umkmpro/conversions", { method: "POST", body: "{}" }) as never);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("uq_internal_detail");
    expect(text).not.toContain("prompter_conversions");
    expect(text).toContain("Gagal menyimpan data konversi.");
    expect(errSpy.mock.calls.flat().join(" ")).not.toContain("uq_internal_detail");
    errSpy.mockRestore();
  });
});
