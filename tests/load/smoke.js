/* global __ENV, open */
// Uji beban RINGAN untuk LINOE (k6). Baca tests/load/README.md sebelum menjalankan.
//
// Jaminan keselamatan (diuji di tests/unit/load/allowlist.test.ts):
// - BASE_URL divalidasi terhadap tests/load/allowlist.txt di tingkat modul (init), SEBELUM VU atau request apa pun.
//   Gagal = Error dilempar = k6 berhenti dengan kode keluar non-nol. Tidak ada request yang terkirim.
// - Hanya GET ke jalur tetap SAFE_PATHS (/api/health + halaman publik). Tanpa kredensial, tanpa cookie, tanpa tulis data.
// - Redirect tidak diikuti (redirects: 0), jadi sandbox tidak bisa melempar beban ke host lain.
// - VU dan durasi dibatasi keras (lihat LIMITS); default 2 VU selama 30 detik.
import http from "k6/http";
import { check, sleep } from "k6";
import { validateBaseUrl, parseLimits, SAFE_PATHS } from "./lib/allowlist.js";

const verdict = validateBaseUrl(__ENV.BASE_URL, open("./allowlist.txt"));
if (!verdict.ok) {
  throw new Error("DITOLAK sebelum request pertama: " + verdict.reason);
}
const limits = parseLimits({ VUS: __ENV.VUS, DURATION_SECONDS: __ENV.DURATION_SECONDS });
const ORIGIN = verdict.origin;

export const options = {
  vus: limits.vus,
  duration: limits.durationSeconds + "s",
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<2000"],
    checks: ["rate>0.99"],
  },
  userAgent: "linoe-loadtest-k6/1 (sandbox-only)",
};

http.setResponseCallback(http.expectedStatuses(200));

export default function main() {
  for (const path of SAFE_PATHS) {
    const res = http.get(ORIGIN + path, { redirects: 0, tags: { path } });
    check(res, {
      "status 200": (r) => r.status === 200,
    });
  }
  // Jeda minimal 1 detik per iterasi: maksimum sekitar 5 request/detik per VU.
  sleep(1);
}
