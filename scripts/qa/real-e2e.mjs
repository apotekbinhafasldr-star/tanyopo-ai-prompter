import { fileURLToPath } from "node:url";
import { assertRealQaEnv, redact } from "./real-e2e-guard.mjs";
import { createInboxAdapter } from "./inbox-adapter.mjs";

// QA-2 / jalur B (REAL email E2E). DESAIN SAJA: tidak aktif, tidak mengirim email, tidak membaca secret produksi.
//  * Selalu menjalankan assertRealQaEnv lebih dulu (fail-closed).
//  * Tanpa QA2_ACTIVATED=true: mencetak rencana langkah lalu keluar dengan kode 3.
//  * Tidak boleh berjalan di produksi (Netlify/Vercel/NODE_ENV=production ditolak).

export const PLAN = [
  "1. Reset pengguna proyek QA lewat Admin API (HANYA proyek QA)",
  "2. Kosongkan kotak masuk tetap",
  "3. Signup lewat /register pada aplikasi lokal yang menunjuk proyek QA",
  "4. Tunggu email nyata (Resend SMTP) masuk ke kotak masuk tetap",
  "5. Verifikasi header Authentication-Results / SPF / DKIM",
  "6. Ikuti tautan konfirmasi",
  "7. Onboarding 8 langkah",
  "8. Dashboard",
  "9. Trial 14 hari",
  "10. Pendaftaran duplikat ditolak",
  "11. Bersihkan (cleanup) data proyek QA",
];

/**
 * @param {Record<string, string | undefined>} env
 */
function assertNotProduction(env) {
  if (env.NODE_ENV === "production" || env.NETLIFY || env.VERCEL) {
    throw new Error("QA-2 GUARD REFUSED: tidak boleh berjalan di lingkungan produksi/hosting");
  }
}

/**
 * @param {string[]} argv
 */
async function main(argv) {
  const env = process.env;
  try {
    assertNotProduction(env);
    assertRealQaEnv(env);
  } catch (err) {
    console.error(redact(String(err instanceof Error ? err.message : err), env));
    process.exit(2);
  }
  if (argv.includes("--guard-only")) {
    console.log("QA-2 guard: OK (hanya proyek QA, tanpa kredensial produksi)");
    return;
  }
  console.log("QA-2 rencana langkah:");
  for (const line of PLAN) console.log(`  ${line}`);
  if (env.QA2_ACTIVATED !== "true") {
    console.error("QA-2 NOT ACTIVATED: inbox adapter / infrastructure not provisioned");
    process.exit(3);
  }
  // Walau diaktifkan, adapter belum ada: melempar NOT_IMPLEMENTED.
  try {
    createInboxAdapter("unset");
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(3);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  });
}
