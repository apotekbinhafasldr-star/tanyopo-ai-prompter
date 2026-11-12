import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { QA_EMAIL, assertLocalOnly, assertQaEmail, findViolations } from "../../../scripts/qa/local-stack-guard.mjs";

const LOCAL_OK = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  MAILPIT_URL: "http://127.0.0.1:54324",
  PGHOST: "127.0.0.1",
};

const root = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

describe("QA-1 guard fail-closed", () => {
  it("menerima lingkungan lokal murni", () => {
    expect(findViolations(LOCAL_OK)).toEqual([]);
    expect(() => assertLocalOnly(LOCAL_OK, { requireUrls: ["NEXT_PUBLIC_SUPABASE_URL"] })).not.toThrow();
  });

  it("menolak URL Supabase non-lokal dan penanda proyek nyata", () => {
    expect(() => assertLocalOnly({ ...LOCAL_OK, NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghij.supabase.co" })).toThrow(/REFUSED/);
    expect(() => assertLocalOnly({ ...LOCAL_OK, NEXT_PUBLIC_SUPABASE_URL: "https://wjjyqovhmwenbcvbnkgx.supabase.co" })).toThrow(/REFUSED/);
    expect(() => assertLocalOnly({ ...LOCAL_OK, SOME_VAR: "db.bmwpykwoylmzrbmbdeqw.example" })).toThrow(/REFUSED/);
  });

  it("menolak host DB/email non-lokal", () => {
    expect(() => assertLocalOnly({ ...LOCAL_OK, PGHOST: "db.example.com" })).toThrow(/PGHOST/);
    expect(() => assertLocalOnly({ ...LOCAL_OK, MAILPIT_URL: "https://api.resend.com" })).toThrow(/REFUSED/);
  });

  it.each(["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL", "RESEND_ALERT_API_KEY", "NETLIFY_AUTH_TOKEN", "DEMO_SESSION_SECRET"])(
    "menolak kredensial terlarang %s",
    (name) => {
      expect(() => assertLocalOnly({ ...LOCAL_OK, [name]: "x" })).toThrow(new RegExp(name));
    },
  );

  it("wajib memiliki target lokal yang diminta (fail-closed saat kosong)", () => {
    expect(() => assertLocalOnly({}, { requireUrls: ["NEXT_PUBLIC_SUPABASE_URL"] })).toThrow(/wajib diisi/);
  });

  it("identitas QA hanya qa-linoe@example.test", () => {
    expect(QA_EMAIL).toBe("qa-linoe@example.test");
    expect(() => assertQaEmail(QA_EMAIL)).not.toThrow();
    expect(() => assertQaEmail("founder@tanyopo.com")).toThrow(/REFUSED/);
  });
});

describe("QA-1 workflow dan config statis", () => {
  const wf = read(".github/workflows/qa-signup-e2e.yml");

  it("workflow tidak memakai secret, Netlify, atau deploy", () => {
    expect(wf).not.toMatch(/\$\{\{\s*secrets\./);
    expect(wf).not.toMatch(/netlify\s+deploy|NETLIFY_|netlify-cli|production-migration/i);
    expect(wf).toMatch(/permissions:\s*\n\s*contents:\s*read/);
  });

  it("workflow menjalankan guard dan memakai identitas tetap lewat skrip E2E", () => {
    expect(wf).toContain("scripts/qa/local-stack-guard.mjs");
    expect(wf).toContain("scripts/qa/signup-e2e.mjs");
    expect(wf).toContain("scripts/qa/apply-local-db.sh");
  });

  it("config Supabase lokal: site_url localhost, konfirmasi email wajib, Mailpit aktif", () => {
    const cfg = read("qa/supabase-local/supabase/config.toml");
    expect(cfg).toContain('site_url = "http://localhost:3000"');
    expect(cfg).toMatch(/enable_confirmations\s*=\s*true/);
    expect(cfg).toMatch(/\[inbucket\]\s*\nenabled\s*=\s*true/);
    expect(cfg).not.toMatch(/supabase\.co|smtp|resend/i);
  });

  it("skrip E2E tidak membuat alamat email lain dan tidak menyentuh endpoint produksi", () => {
    const e2e = read("scripts/qa/signup-e2e.mjs");
    expect(e2e).not.toMatch(/@(gmail|tanyopo)\./i);
    expect(e2e).not.toMatch(/supabase\.co|api\.resend\.com/);
  });
});
