import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInboxAdapter } from "../../../scripts/qa/inbox-adapter.mjs";
import {
  REQUIRED_VARS,
  SECRET_VARS,
  assertRealQaEnv as realAssertRealQaEnv,
  redact,
} from "../../../scripts/qa/real-e2e-guard.mjs";
import { ALLOWED_QA_PROJECT_REFS } from "../../../scripts/qa/qa-project-allowlist.mjs";

// Semua nilai di bawah PALSU (tidak ada proyek/domain/akun nyata).
const FAKE_REF = "abcdefghij0123456789";
const SECRET_PUB = "FAKE-PUBLISHABLE-VALUE-111";
const SECRET_SRV = "FAKE-SECRET-VALUE-222";

// Tes memakai allowlist suntikan berisi ref PALSU; allowlist nyata di repo sengaja kosong (lihat blok khusus di bawah).
const assertRealQaEnv = (env: Record<string, string | undefined>, options: { allowedRefs?: readonly string[] } = { allowedRefs: [FAKE_REF] }) =>
  realAssertRealQaEnv(env, options);

const OK: Record<string, string | undefined> = {
  QA2_CONFIRM: "RUN-QA-2-REAL-EMAIL",
  QA_SUPABASE_URL: `https://${FAKE_REF}.supabase.co`,
  NEXT_PUBLIC_SUPABASE_URL: `https://${FAKE_REF}.supabase.co`,
  QA_PROJECT_REF_EXPECTED: FAKE_REF,
  QA_SUPABASE_PUBLISHABLE_KEY: SECRET_PUB,
  QA_SUPABASE_SECRET_KEY: SECRET_SRV,
  QA_INBOX_ADDRESS: "qa-inbox@fake-inbox.invalid",
  QA_SENDER_EMAIL: "noreply@qa.tanyopo.com",
};

const root = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
const without = (name: string) => {
  const e = { ...OK };
  delete e[name];
  return e;
};

describe("QA-2 guard fail-closed", () => {
  it("jalur bahagia: env QA palsu lengkap diterima", () => {
    expect(() => assertRealQaEnv(OK)).not.toThrow();
  });

  it("menolak frasa konfirmasi salah atau kosong", () => {
    expect(() => assertRealQaEnv({ ...OK, QA2_CONFIRM: "yes" })).toThrow(/QA2_CONFIRM/);
    expect(() => assertRealQaEnv(without("QA2_CONFIRM"))).toThrow(/QA2_CONFIRM/);
  });

  it.each(REQUIRED_VARS)("menolak bila %s hilang", (name) => {
    expect(() => assertRealQaEnv(without(name))).toThrow(new RegExp(name));
  });

  it("menolak env kosong", () => {
    expect(() => assertRealQaEnv({})).toThrow(/REFUSED/);
  });

  it("menolak URL Supabase berformat salah", () => {
    for (const url of [
      `http://${FAKE_REF}.supabase.co`,
      `https://${FAKE_REF}.supabase.com`,
      `https://${FAKE_REF}.supabase.co/`,
      `https://${FAKE_REF}.supabase.co.evil.example`,
      `https://user@${FAKE_REF}.supabase.co`,
      "https://short.supabase.co",
      "http://127.0.0.1:54321",
    ]) {
      expect(() => assertRealQaEnv({ ...OK, QA_SUPABASE_URL: url })).toThrow(/QA_SUPABASE_URL/);
    }
  });

  it("menolak ref yang tidak sama dengan ref yang diharapkan", () => {
    expect(() => assertRealQaEnv({ ...OK, QA_PROJECT_REF_EXPECTED: "zzzzzzzzzz0123456789" })).toThrow(/QA_PROJECT_REF_EXPECTED/);
    expect(() => assertRealQaEnv({ ...OK, QA_PROJECT_REF_EXPECTED: "pendek" })).toThrow(/QA_PROJECT_REF_EXPECTED/);
  });

  it.each(["wjjyqovhmwenbcvbnkgx", "bmwpykwoylmzrbmbdeqw", "kczslidqkhssdwefkais", "eskqngzhtndkfqjoxxou"])(
    "menolak ref produksi/bersama yang masuk daftar blokir (%s)",
    (ref) => {
      const url = `https://${ref}.supabase.co`;
      expect(() => assertRealQaEnv({ ...OK, QA_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_URL: url, QA_PROJECT_REF_EXPECTED: ref })).toThrow(/produksi\/bersama/);
      // walau ref produksi dimasukkan ke allowlist suntikan, guard tetap menolak
      expect(() => assertRealQaEnv({ ...OK, QA_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_URL: url, QA_PROJECT_REF_EXPECTED: ref }, { allowedRefs: [ref] })).toThrow(/produksi\/bersama/);
    },
  );

  it("menolak inbox tidak valid atau di example.test", () => {
    expect(() => assertRealQaEnv({ ...OK, QA_INBOX_ADDRESS: "bukan-email" })).toThrow(/QA_INBOX_ADDRESS/);
    expect(() => assertRealQaEnv({ ...OK, QA_INBOX_ADDRESS: "qa-linoe@example.test" })).toThrow(/example\.test/);
    expect(() => assertRealQaEnv({ ...OK, QA_INBOX_ADDRESS: "a@sub.example.test" })).toThrow(/example\.test/);
  });

  it("menolak pengirim produksi tanyopo.com tetapi menerima sub-domain QA atau domain lain", () => {
    expect(() => assertRealQaEnv({ ...OK, QA_SENDER_EMAIL: "noreply@tanyopo.com" })).toThrow(/QA_SENDER_EMAIL/);
    expect(() => assertRealQaEnv({ ...OK, QA_SENDER_EMAIL: "tanyopo.com" })).toThrow(/QA_SENDER_EMAIL/);
    expect(() => assertRealQaEnv({ ...OK, QA_SENDER_EMAIL: "x@TANYOPO.COM" })).toThrow(/QA_SENDER_EMAIL/);
    expect(() => assertRealQaEnv({ ...OK, QA_SENDER_EMAIL: "x@qa.tanyopo.com" })).not.toThrow();
    expect(() => assertRealQaEnv({ ...OK, QA_SENDER_EMAIL: "x@other-qa-domain.invalid" })).not.toThrow();
  });

  it.each([
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SECRET_KEY",
    "DATABASE_URL",
    "RESEND_API_KEY",
    "DOKU_CLIENT_ID",
    "MIDTRANS_SERVER_KEY",
    "META_APP_SECRET",
    "TIKTOK_CLIENT_SECRET",
    "X_CLIENT_SECRET",
    "PGHOST",
    "PGSERVICEFILE",
    "NETLIFY_AUTH_TOKEN",
  ])("menolak variabel produksi %s", (name) => {
    expect(() => assertRealQaEnv({ ...OK, [name]: "x" })).toThrow(new RegExp(name));
  });

  it("H4: NEXT_PUBLIC_SUPABASE_URL wajib terisi (hilang, kosong, atau spasi ditolak) dan identik dengan QA_SUPABASE_URL", () => {
    expect(() => assertRealQaEnv(without("NEXT_PUBLIC_SUPABASE_URL"))).toThrow(/NEXT_PUBLIC_SUPABASE_URL wajib diisi/);
    expect(() => assertRealQaEnv({ ...OK, NEXT_PUBLIC_SUPABASE_URL: "" })).toThrow(/NEXT_PUBLIC_SUPABASE_URL wajib diisi/);
    expect(() => assertRealQaEnv({ ...OK, NEXT_PUBLIC_SUPABASE_URL: "   " })).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    // proyek QA lain (walau sama-sama berformat benar) tidak identik
    expect(() => assertRealQaEnv({ ...OK, NEXT_PUBLIC_SUPABASE_URL: "https://zzzzzzzzzz0123456789.supabase.co" })).toThrow(/NEXT_PUBLIC_SUPABASE_URL bukan proyek QA/);
    expect(() => assertRealQaEnv({ ...OK, NEXT_PUBLIC_SUPABASE_URL: `${OK.QA_SUPABASE_URL}/` })).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(() => assertRealQaEnv({ ...OK, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" })).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("H4: SUPABASE_URL, bila ada, harus identik dengan QA_SUPABASE_URL", () => {
    expect(() => assertRealQaEnv({ ...OK, SUPABASE_URL: "https://zzzzzzzzzz0123456789.supabase.co" })).toThrow(/SUPABASE_URL bukan proyek QA/);
    expect(() => assertRealQaEnv({ ...OK, SUPABASE_URL: OK.QA_SUPABASE_URL })).not.toThrow();
  });

  it("NEXT_PUBLIC_SUPABASE_URL hanya boleh proyek QA yang sama", () => {
    expect(() => assertRealQaEnv({ ...OK, NEXT_PUBLIC_SUPABASE_URL: "https://zzzzzzzzzz0123456789.supabase.co" })).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(() => assertRealQaEnv({ ...OK, NEXT_PUBLIC_SUPABASE_URL: OK.QA_SUPABASE_URL })).not.toThrow();
  });

  it("menolak penanda layanan produksi pada nilai env mana pun", () => {
    expect(() => assertRealQaEnv({ ...OK, SOME_VAR: "https://wjjyqovhmwenbcvbnkgx.supabase.co" })).toThrow(/SOME_VAR/);
    expect(() => assertRealQaEnv({ ...OK, SOME_VAR: "https://x.netlify.app" })).toThrow(/SOME_VAR/);
  });

  it("pesan error tidak pernah memuat nilai rahasia", () => {
    const bad = { ...OK, QA2_CONFIRM: "salah", QA_SENDER_EMAIL: "noreply@tanyopo.com", DATABASE_URL: "FAKE-DB-VALUE-333", QA_PROJECT_REF_EXPECTED: "zzzzzzzzzz0123456789" };
    let message = "";
    try {
      assertRealQaEnv(bad);
    } catch (err) {
      message = String((err as Error).message);
    }
    expect(message).toMatch(/REFUSED/);
    for (const v of [SECRET_PUB, SECRET_SRV, "FAKE-DB-VALUE-333", FAKE_REF, "noreply@tanyopo.com", "qa-inbox@fake-inbox.invalid"]) {
      expect(message).not.toContain(v);
    }
  });

  it("redact menyamarkan nilai rahasia dan mengekspor daftar nama", () => {
    const out = redact(`k=${SECRET_PUB} s=${SECRET_SRV}`, OK);
    expect(out).not.toContain(SECRET_PUB);
    expect(out).not.toContain(SECRET_SRV);
    expect(out).toContain("[REDACTED:QA_SUPABASE_SECRET_KEY]");
    expect(SECRET_VARS).toContain("QA_RESEND_SMTP_PASSWORD");
    expect(REQUIRED_VARS).toContain("QA_PROJECT_REF_EXPECTED");
  });
});

describe("QA-2 adapter, entry, dan workflow statis", () => {
  it("adapter inbox belum dipilih: melempar NOT_IMPLEMENTED", () => {
    expect(() => createInboxAdapter("imap")).toThrow("NOT_IMPLEMENTED: provider not chosen");
  });

  it("entry menjalankan guard lebih dulu dan keluar 3 bila belum aktif", () => {
    const src = read("scripts/qa/real-e2e.mjs");
    expect(src.indexOf("assertRealQaEnv(env)")).toBeLessThan(src.indexOf("env.QA2_ACTIVATED"));
    expect(src).toContain("QA-2 NOT ACTIVATED: inbox adapter / infrastructure not provisioned");
    expect(src).toContain("process.exit(3)");
    expect(src).toContain("--guard-only");
  });

  it("workflow hanya manual, tanpa secret repo-wide, tanpa Netlify/deploy", () => {
    const wf = read(".github/workflows/qa-real-e2e.yml");
    expect(wf).toMatch(/^on:\s*\n\s+workflow_dispatch:/m);
    expect(wf).not.toMatch(/^\s+(push|pull_request|schedule):/m);
    expect(wf).toMatch(/permissions:\s*\n\s*contents:\s*read/);
    expect(wf).toContain("environment: qa-real-email");
    expect(wf).toContain("cancel-in-progress: false");
    expect(wf).toContain("vars.QA2_ENABLED == 'true'");
    expect(wf).toContain("RUN-QA-2-REAL-EMAIL");
    expect(wf).not.toMatch(/netlify|deploy\s|SERVICE_ROLE|DATABASE_URL|RESEND_API_KEY/i);
    for (const m of wf.matchAll(/secrets\.([A-Z0-9_]+)/g)) expect(m[1]).toMatch(/^QA_/);
  });
});

describe("QA-2 H5: allowlist proyek QA terkunci, independen dari URL runner", () => {
  it("allowlist di repo KOSONG (belum ada proyek QA, ref tidak dikarang) sehingga guard bawaan selalu menolak", () => {
    expect(ALLOWED_QA_PROJECT_REFS).toEqual([]);
    expect(() => realAssertRealQaEnv(OK)).toThrow(/allowlist proyek QA kosong/);
    expect(() => realAssertRealQaEnv(OK, { allowedRefs: [] })).toThrow(/allowlist/);
  });

  it("ref yang tidak ada di allowlist ditolak walau URL, ref harapan, dan NEXT_PUBLIC cocok satu sama lain", () => {
    const other = "zzzzzzzzzz0123456789";
    const env = {
      ...OK,
      QA_SUPABASE_URL: `https://${other}.supabase.co`,
      NEXT_PUBLIC_SUPABASE_URL: `https://${other}.supabase.co`,
      QA_PROJECT_REF_EXPECTED: other,
    };
    expect(() => assertRealQaEnv(env)).toThrow(/tidak ada di allowlist/);
    expect(() => assertRealQaEnv(env, { allowedRefs: [other] })).not.toThrow();
  });

  it("entri allowlist tidak valid ditolak", () => {
    expect(() => assertRealQaEnv(OK, { allowedRefs: [FAKE_REF, "pendek"] })).toThrow(/allowlist proyek QA memuat ref tidak valid/);
  });

  it("pesan penolakan tidak memuat nilai ref", () => {
    let message = "";
    try {
      realAssertRealQaEnv(OK);
    } catch (err) {
      message = String((err as Error).message);
    }
    expect(message).not.toContain(FAKE_REF);
  });
});

describe("QA-2 H2/H3: cakupan secret per langkah dan pin SHA (statis)", () => {
  const wf = read(".github/workflows/qa-real-e2e.yml");
  const stepsStart = wf.indexOf("\n    steps:\n");
  const head = wf.slice(0, stepsStart);
  const steps = wf
    .slice(stepsStart)
    .split(/\n      - /)
    .slice(1);

  it("tidak ada secret pada env tingkat job maupun tingkat workflow", () => {
    expect(stepsStart).toBeGreaterThan(0);
    expect(head).not.toMatch(/secrets\./);
    expect(head).not.toMatch(/\n\s+env:/);
  });

  it("checkout, setup-node, dan npm ci tidak menerima secret; hanya dua langkah (guard dan E2E) yang menerimanya", () => {
    expect(steps.length).toBeGreaterThanOrEqual(5);
    const withSecrets = steps.filter((s) => /secrets\./.test(s));
    expect(withSecrets).toHaveLength(2);
    for (const s of steps) {
      if (/^uses:|^run: npm ci/.test(s)) expect(s).not.toMatch(/secrets\.|\benv:/);
    }
    expect(withSecrets[0]).toContain("name: Guard");
    expect(withSecrets[1]).toContain("name: QA-2 real email E2E");
    for (const s of withSecrets) {
      for (const name of ["QA_SUPABASE_URL", "QA_SUPABASE_SECRET_KEY", "QA_INBOX_ADDRESS", "QA_PROJECT_REF_EXPECTED"]) expect(s).toContain(name);
    }
  });

  it("NEXT_PUBLIC_SUPABASE_URL diisi dari QA_SUPABASE_URL yang sama pada kedua langkah", () => {
    for (const s of steps.filter((x) => /secrets\./.test(x))) {
      expect(s).toMatch(/NEXT_PUBLIC_SUPABASE_URL: \$\{\{ secrets\.QA_SUPABASE_URL \}\}/);
    }
  });

  it("semua action dipin ke SHA commit penuh 40 hex dengan komentar versi", () => {
    const uses = [...wf.matchAll(/^\s*- uses: (\S+)(.*)$/gm)];
    expect(uses.length).toBeGreaterThanOrEqual(2);
    for (const m of uses) {
      expect(m[1]).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
      expect(m[2]).toMatch(/# v\d+\.\d+\.\d+/);
    }
    expect(wf).toContain("actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2");
    expect(wf).toContain("actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0");
  });

  it("checkout tidak menyimpan kredensial repo; workflow tetap inert (QA2_ENABLED tidak dipaksa true)", () => {
    expect(wf).toContain("persist-credentials: false");
    expect(wf).toContain("vars.QA2_ENABLED == 'true'");
    expect(wf).not.toMatch(/QA2_ENABLED:\s*['"]?true/);
    expect(wf).not.toMatch(/QA2_ACTIVATED:\s*['"]?true/);
  });
});

describe("QA-2 hardening lanjutan (review silang)", () => {
  it("workflow hanya jalan dari main (lapis kedua di samping Environment)", () => {
    const wf = read(".github/workflows/qa-real-e2e.yml");
    expect(wf).toContain("github.ref == 'refs/heads/main'");
  });

  it("menolak host .supabase.com pada variabel mana pun", () => {
    expect(() => assertRealQaEnv({ ...OK, QA_INBOX_ADDRESS: "qa@pooler.supabase.com" })).toThrow();
    expect(() => assertRealQaEnv({ ...OK, QA_SENDER_EMAIL: "noreply@x.supabase.com" })).toThrow();
  });

  it.each([
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_DB_PASSWORD",
    "SUPABASE_SERVICE_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "RESEND_API_KEY",
    "NETLIFY_AUTH_TOKEN",
    "VERCEL_TOKEN",
  ])("menolak variabel produksi %s", (name) => {
    expect(() => assertRealQaEnv({ ...OK, [name]: "x" })).toThrow(/variabel produksi terisi/);
  });
});
