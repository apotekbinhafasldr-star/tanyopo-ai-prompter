import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRIVACY_NOTICE_VERSION, TERMS_VERSION } from "@/features/legal/legal-versions";

/**
 * Penjaga versi dokumen hukum. Bila isi halaman /terms atau /privacy berubah, hash di bawah tidak cocok dan tes ini GAGAL:
 * naikkan TERMS_VERSION / PRIVACY_NOTICE_VERSION di features/legal/legal-versions.ts (bila perubahannya substansial) lalu
 * perbarui pasangan versi+hash di sini DALAM PR YANG SAMA. Tes ini tidak mengubah teks halaman.
 */
const root = path.resolve(__dirname, "../../..");
const sha = (f: string) => createHash("sha256").update(readFileSync(path.join(root, f))).digest("hex");

const PINNED = {
  terms: { file: "app/(legal)/terms/page.tsx", version: 2, sha256: "b8aa35705b4231efa35c34cd7c482d7e6095d794fd8e6f33c13c01538915179c" },
  privacy: { file: "app/(legal)/privacy/page.tsx", version: 1, sha256: "d66e3a2cd8d8117beb7f4f89a46e194d95e1e835bb2e70520e23b481d6d1e175" },
} as const;

describe("versi dokumen hukum terikat pada isi halaman", () => {
  it("TERMS_VERSION cocok dengan hash halaman /terms yang dipin", () => {
    expect(TERMS_VERSION).toBe(PINNED.terms.version);
    expect(sha(PINNED.terms.file)).toBe(PINNED.terms.sha256);
  });
  it("PRIVACY_NOTICE_VERSION cocok dengan hash halaman /privacy yang dipin", () => {
    expect(PRIVACY_NOTICE_VERSION).toBe(PINNED.privacy.version);
    expect(sha(PINNED.privacy.file)).toBe(PINNED.privacy.sha256);
  });
});
