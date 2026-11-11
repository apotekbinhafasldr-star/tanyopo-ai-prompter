# Rancangan workflow uji beban (CONTOH, belum aktif)

Ini teks contoh. **Jangan** menyalinnya ke `.github/workflows/` tanpa persetujuan eksplisit Founder dan tanpa mengisi `tests/load/allowlist.txt`. Saat dipasang nanti, lakukan lewat PR tersendiri.

Prinsip rancangan:
- Hanya `workflow_dispatch` (dijalankan manual dari tab Actions di HP). Tidak ada `push`, `pull_request`, atau `schedule`.
- Izin minimal (`contents: read`), tanpa secret, tanpa variabel produksi.
- Input pengguna dilewatkan lewat `env:` (bukan disisipkan ke perintah shell) agar tidak ada injeksi perintah.
- Validasi allowlist dijalankan di langkah tersendiri SEBELUM k6, dengan modul yang sama yang dipakai skrip. Gagal = job berhenti, tidak ada request.
- Satu run pada satu waktu (`concurrency`) dan `timeout-minutes` pendek.
- Versi action di bawah adalah penanda: sebelum dipasang, verifikasi versi terbaru di halaman Marketplace masing-masing dan pin ke commit SHA.

```yaml
name: Load test (sandbox)

on:
  workflow_dispatch:
    inputs:
      base_url:
        description: "Mis. https://linoe-sandbox.netlify.app (harus ada di tests/load/allowlist.txt)"
        required: true
        type: string
      vus:
        description: "Jumlah VU (1-10)"
        required: false
        default: "2"
        type: string
      duration_seconds:
        description: "Durasi detik (1-120)"
        required: false
        default: "30"
        type: string

permissions:
  contents: read

concurrency:
  group: loadtest
  cancel-in-progress: false

jobs:
  loadtest:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    # Opsional: environment dengan "required reviewers" agar tiap run perlu persetujuan Founder.
    # environment: loadtest
    env:
      BASE_URL: ${{ inputs.base_url }}
      VUS: ${{ inputs.vus }}
      DURATION_SECONDS: ${{ inputs.duration_seconds }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "22"

      # Langkah 1: tolak lebih dulu. Memakai lib/allowlist.js yang sama dengan skrip k6. Tanpa jaringan.
      - name: Validasi target dan batas (tanpa request)
        run: |
          node --input-type=module -e '
            import { readFileSync } from "node:fs";
            import { validateBaseUrl, parseLimits } from "./tests/load/lib/allowlist.js";
            const v = validateBaseUrl(process.env.BASE_URL, readFileSync("tests/load/allowlist.txt", "utf8"));
            if (!v.ok) { console.error("DITOLAK: " + v.reason); process.exit(1); }
            const l = parseLimits({ VUS: process.env.VUS, DURATION_SECONDS: process.env.DURATION_SECONDS });
            console.log("OK target=" + v.origin + " vus=" + l.vus + " durasi=" + l.durationSeconds + "s");
          '

      - uses: grafana/setup-k6-action@v1

      # Langkah 2: skrip k6 memvalidasi ulang di init (pagar ganda) sebelum request pertama.
      - name: Jalankan k6
        run: k6 run tests/load/smoke.js
```

Catatan pemasangan (untuk Founder/pelaksana, nanti):
1. Isi `tests/load/allowlist.txt` dan tambahkan baris `!host-produksi`.
2. Pastikan situs sandbox tidak memakai database produksi `umkmpro-ai`.
3. Buat PR berisi `.github/workflows/loadtest.yml` dari blok di atas. Perubahan di `.github/workflows/` perlu persetujuan eksplisit.
4. Setelah merge (oleh Founder), jalankan dari tab Actions. Mulai dari nilai bawaan (2 VU, 30 detik).
