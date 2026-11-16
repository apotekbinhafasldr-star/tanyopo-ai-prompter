import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Tes statis: dokumen konfigurasi Auth/SMTP QA-2 harus konsisten dengan kode dan tidak memuat ref terlarang atau secret.
const root = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

const QA_REF = "gasdqsadnjoknisloaec";
const SHARED_PROD_REF = "wjjyqovhmwenbcvbnkgx"; // proyek bersama; tidak boleh muncul di dokumen ini
const doc = read("docs/QA2_AUTH_SMTP_CONFIG.md");

describe("QA-2 dokumen konfigurasi Auth/SMTP", () => {
  it("menyebut ref QA, /auth/confirm, token_hash, dan domain pengirim", () => {
    expect(doc).toContain(QA_REF);
    expect(doc).toContain(`https://${QA_REF}.supabase.co`);
    expect(doc).toContain("/auth/confirm");
    expect(doc).toContain("token_hash");
    expect(doc).toContain("qa.tanyopo.com");
    expect(doc).toContain("smtp.resend.com");
  });

  it("memuat template konfirmasi yang identik dengan qa/supabase-local", () => {
    const template = read("qa/supabase-local/supabase/templates/confirm.html").trim();
    expect(template).toContain("/auth/confirm?token_hash={{ .TokenHash }}&type=signup");
    expect(doc).toContain(template);
  });

  it("ref QA cocok dengan allowlist QA di repo", () => {
    expect(read("scripts/qa/qa-project-allowlist.mjs")).toContain(QA_REF);
  });

  it("tidak memuat ref proyek bersama/produksi", () => {
    expect(doc).not.toContain(SHARED_PROD_REF);
  });

  it("tidak memuat kunci atau secret", () => {
    expect(doc).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/); // JWT
    expect(doc).not.toMatch(/sb_(secret|publishable)_[A-Za-z0-9_-]{8,}/);
    expect(doc).not.toMatch(/\bre_[A-Za-z0-9_]{16,}/); // API key Resend
    expect(doc).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
    expect(doc).not.toMatch(/service_role/i);
  });

  it("menandai status UNKNOWN dan tidak mengklaim terbukti", () => {
    expect(doc).toContain("UNKNOWN");
    expect(doc).toContain("WAJIB");
    expect(doc).toContain("OPSIONAL");
  });
});
