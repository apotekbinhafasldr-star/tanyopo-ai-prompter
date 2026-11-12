// QA-1 (jalur A, MOCK/INTEGRATION): signup -> konfirmasi email -> onboarding -> trial 14 hari, dengan identitas QA tetap.
// Berjalan HANYA terhadap Supabase LOKAL sementara di runner CI (Auth nyata + Mailpit penangkap email).
// KELAS BUKTI: INTEGRATION/MOCK. Email ditangkap Mailpit lokal; TIDAK ada email nyata terkirim, TIDAK menguji Resend.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";
import { QA_EMAIL, assertLocalOnly, assertQaEmail } from "./local-stack-guard.mjs";

const APP = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

assertLocalOnly(process.env, { requireUrls: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_APP_URL", "MAILPIT_URL"] });
assertQaEmail(QA_EMAIL);

// Kata sandi acak per run, hanya hidup di runner lokal ini.
const PASSWORD = `Qa-${randomBytes(9).toString("hex")}!`;
const results = [];
const step = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` -- ${detail}` : ""}`);
  if (!ok) throw new Error(`step gagal: ${name}`);
};

function psql(sql) {
  return execFileSync("psql", ["-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    env: { ...process.env, PGSERVICE: "", PGSERVICEFILE: "", PGHOSTADDR: "", PGPASSFILE: "", PGOPTIONS: "", PGHOST: "127.0.0.1", PGPORT: "54322", PGUSER: "postgres", PGPASSWORD: "postgres", PGDATABASE: "postgres" },
    encoding: "utf8",
  }).trim();
}

async function mailpit(path, init) {
  const res = await fetch(`${MAILPIT}${path}`, init);
  if (!res.ok) throw new Error(`Mailpit ${path} -> ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text; // DELETE /api/v1/messages membalas teks biasa ("ok")
  }
}

async function waitForMail(timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const found = await mailpit(`/api/v1/search?query=${encodeURIComponent(`to:${QA_EMAIL}`)}`);
    if (found.messages?.length) return mailpit(`/api/v1/message/${found.messages[0].ID}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("email konfirmasi tidak tiba di Mailpit dalam 30 dtk");
}

function confirmLink(message) {
  const blob = `${message.HTML ?? ""}\n${message.Text ?? ""}`.replaceAll("&amp;", "&");
  const m = blob.match(/https?:\/\/[^\s"'<>]+\/auth\/confirm\?[^\s"'<>]+/);
  return m ? m[0] : null;
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
page.setDefaultTimeout(25000);

try {
  // Reset sandbox: tiap run memakai stack baru; di sini cukup mengosongkan kotak surat lokal.
  await mailpit("/api/v1/messages", { method: "DELETE" });
  step("Kotak surat lokal kosong (identitas tetap, tanpa alamat baru)", true, QA_EMAIL);

  // 1) Signup lewat form nyata.
  await page.goto(`${APP}/register`);
  await page.fill("#nama", "QA Linoe");
  await page.fill("#namaUsaha", "QA Linoe Sandbox");
  await page.fill("#email", QA_EMAIL);
  await page.fill("#password", PASSWORD);
  await page.check("#acceptLegal");
  await page.getByRole("button", { name: "Daftar Gratis" }).click();
  await page.getByText("Akun berhasil dibuat").waitFor();
  step("Signup lewat /register: pesan 'cek email' tampil, tanpa sesi", true);

  // 2) Konfirmasi email wajib: login sebelum konfirmasi ditolak oleh Auth nyata.
  const early = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email: QA_EMAIL, password: PASSWORD }),
  });
  const earlyBody = await early.json();
  step("Login sebelum konfirmasi ditolak", early.status === 400 && earlyBody.error_code === "email_not_confirmed", `status=${early.status} code=${earlyBody.error_code}`);

  // 3) Email tiba di Mailpit (SIMULASI pengiriman) dan tautan sesuai kontrak /auth/confirm.
  const message = await waitForMail();
  const link = confirmLink(message);
  step("Email konfirmasi tertangkap Mailpit lokal (BUKAN pengiriman nyata)", Boolean(link), message.Subject);
  const url = new URL(link);
  step(
    "Tautan memenuhi kontrak /auth/confirm (host lokal, type=signup, next=/onboarding, ada token_hash)",
    url.origin === new URL(APP).origin && url.searchParams.get("type") === "signup" && url.searchParams.get("next") === "/onboarding" && Boolean(url.searchParams.get("token_hash")),
  );

  // 4) Klik tautan: sesi terbentuk dan masuk /onboarding.
  await page.goto(link);
  await page.waitForURL("**/onboarding");
  step("Konfirmasi: diarahkan ke /onboarding dengan sesi", true);

  // 5) Onboarding 8 langkah (kategori dan tujuan dipilih dari opsi pertama).
  await page.locator("#brandNameInput").fill("QA Linoe Brand");
  const next = page.getByRole("button", { name: "Lanjut" });
  await next.click(); // 1 -> 2
  await next.click(); // 2 -> 3
  await page.locator("button[aria-pressed]").first().click();
  await next.click(); // 3 -> 4
  await page.locator("textarea").fill("Kopi kemasan siap seduh dari petani lokal.");
  await next.click(); // 4 -> 5
  await page.locator("button[aria-pressed]").first().click();
  await next.click(); // 5 -> 6
  await next.click(); // 6 -> 7
  const toDashboard = page.waitForURL("**/dashboard", { timeout: 60000 });
  await next.click(); // 7 -> 8
  // OBSERVASI: tombol "Lanjut" (type=button) dan "Selesai" (type=submit) berbagi posisi JSX, sehingga React dapat memakai ulang
  // elemen yang sama dan klik pada langkah 7 langsung mengirim form. Skrip menerima kedua perilaku dan mencatatnya.
  const submit = page.getByRole("button", { name: "Selesai, ke Dashboard" });
  const alreadyBusy = await submit.getAttribute("aria-busy", { timeout: 3000 }).catch(() => null);
  if (alreadyBusy === "true") {
    console.log("OBSERVASI: klik Lanjut di langkah 7 langsung mengirim form onboarding (langkah 8 terlewati); kode aplikasi tidak diubah di QA-1.");
  } else {
    await submit.click().catch(() => {});
  }
  await toDashboard;
  step("Onboarding selesai: masuk /dashboard", true);

  // 6) Trial 14 hari dibuat saat akses pertama /billing; periode dikunci server oleh trigger S1.
  const billing = await page.goto(`${APP}/billing`);
  step("Halaman /billing terbuka untuk pengguna baru", billing?.status() === 200, `status=${billing?.status()}`);
  const tenantSql = `(select tenant_id from public.user_profiles where id = (select id from auth.users where email = '${QA_EMAIL}'))`;
  const row = psql(
    `select status || '|' || plan || '|' || round(extract(epoch from (current_period_end - current_period_start))/86400)::int from public.prompter_subscriptions where tenant_id = ${tenantSql}`,
  );
  step("Trial: status TRIALING, plan FREE, periode tepat 14 hari", row === "TRIALING|FREE|14", row);
  const brand = psql(`select count(*) from public.prompter_brand_profiles where tenant_id = ${tenantSql}`);
  step("Profil brand dari onboarding tersimpan untuk tenant ini", brand === "1", `rows=${brand}`);
  const trigger = psql(`select tgenabled from pg_trigger where tgname = 'trg_prompter_subscriptions_enforce_trial_insert'`);
  step("Trigger trial S1 aktif di basis data lokal", trigger === "O");

  // 7) Pendaftaran ulang dengan alamat sama (tanpa reset) ditolak: inilah alasan reset per run diperlukan.
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await ctx2.newPage();
  p2.setDefaultTimeout(25000);
  await p2.goto(`${APP}/register`);
  await p2.fill("#nama", "QA Linoe");
  await p2.fill("#namaUsaha", "QA Linoe Sandbox");
  await p2.fill("#email", QA_EMAIL);
  await p2.fill("#password", PASSWORD);
  await p2.check("#acceptLegal");
  await p2.getByRole("button", { name: "Daftar Gratis" }).click();
  await p2.getByText("Email ini sudah terdaftar").waitFor();
  step("Daftar ulang tanpa reset: 'Email ini sudah terdaftar' (kebijakan akun ganda utuh)", true);
  await ctx2.close();
} catch (err) {
  console.error(String(err instanceof Error ? err.stack : err));
  await page.screenshot({ path: "qa-output/signup-e2e-failure.png", fullPage: true }).catch(() => {});
  console.log(`SIGNUP_E2E_SUMMARY steps=${results.length} failing=1`);
  await browser.close();
  process.exit(1);
}

await browser.close();
console.log(`SIGNUP_E2E_SUMMARY steps=${results.length} failing=0`);
console.log("EVIDENCE_CLASS: INTEGRATION/MOCK (Auth nyata lokal + Mailpit). REAL_EMAIL_DELIVERY (Resend): TIDAK DIUJI.");
