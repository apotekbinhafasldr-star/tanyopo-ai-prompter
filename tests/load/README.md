# Uji beban ringan (k6)

Skrip `smoke.js` memberi beban KECIL ke jalur ringan (`/api/health`, `/`, `/login`, `/privacy`, `/terms`) pada situs Netlify **sandbox**. Tujuannya mendeteksi regresi respons/latensi sebelum peluncuran, bukan menguji batas kapasitas.

**Status: belum pernah dijalankan.** Berkas ini hanya disiapkan. Menjalankannya butuh persetujuan Founder (lihat "Prasyarat"). Semua langkah bisa lewat HP (GitHub di Chrome Android + GitHub Actions); tidak perlu laptop atau instal apa pun.

## Jaminan keselamatan (dibangun ke dalam skrip)

| Pagar | Perilaku |
|---|---|
| Allowlist host | `BASE_URL` wajib cocok dengan pola di [`allowlist.txt`](allowlist.txt). Tidak cocok / kosong / tidak valid = skrip melempar galat, k6 keluar dengan kode non-nol, **sebelum request pertama** (validasi di tingkat modul, bukan di dalam iterasi). |
| Default tolak | `allowlist.txt` bawaan **kosong** (hanya komentar): semua target ditolak sampai Founder mengisinya. |
| Hanya Netlify sandbox | Pola harus berakhir `.netlify.app` dan memuat kata `sandbox`, `staging`, atau `loadtest`. Localhost, alamat IP, domain produksi/kustom, dan host tak dikenal ditolak. Pola larangan `!host` menang atas allow. |
| Parser ketat | Hanya `https://<host>` polos. Ditolak: `http`, userinfo (`a@b`), port, path, query, fragment, host tipuan (`sandbox.netlify.app.evil.com`). |
| Jalur tetap | Hanya `GET` ke daftar `SAFE_PATHS` di [`lib/allowlist.js`](lib/allowlist.js). Tanpa kredensial, cookie, token; tanpa tulis data; tanpa `POST/PUT/DELETE`. |
| Redirect tidak diikuti | `redirects: 0`: sandbox tidak bisa mengalihkan beban ke host lain. |
| Batas keras | Default 2 VU x 30 detik. Maksimum 10 VU dan 120 detik; nilai di atas itu **ditolak**, bukan dipotong. Ada jeda 1 detik per iterasi. |

Logika di atas diuji oleh Vitest di `tests/unit/load/allowlist.test.ts` (ikut `npm test` di CI). Tes itu tidak menjalankan k6 dan tidak membuat request jaringan.

## Prasyarat (Founder)

1. Situs Netlify **sandbox terpisah** sudah ada, mis. `linoe-sandbox.netlify.app`, dan **tidak** memakai database produksi `umkmpro-ai` (proyek Supabase itu dipakai bersama LINOE/PUBLOE; jangan diberi beban). Periksa di Netlify -> Site configuration -> Environment variables bahwa URL Supabase situs itu menunjuk project sandbox. Jangan menyalin nilai kunci ke mana pun.
2. Founder mengisi `tests/load/allowlist.txt` (edit file lewat GitHub di HP, buat PR). Contoh isi:
   ```
   linoe-sandbox.netlify.app
   deploy-preview-*--linoe-sandbox.netlify.app
   !nama-situs-produksi.netlify.app
   ```
   Baris `!` (larangan) opsional tetapi dianjurkan: tulis host produksi sebagai pagar tambahan.
3. Founder menyetujui eksplisit (frasa persetujuan) sebelum workflow dipasang dan dijalankan.

## Menjalankan lewat GitHub Actions (NANTI)

Rancangan workflow ada di [`WORKFLOW_CONTOH.md`](WORKFLOW_CONTOH.md) sebagai teks contoh. **Belum dipasang**: sengaja tidak ada berkas baru di `.github/workflows/`. Setelah Founder menyetujui, workflow disalin ke `.github/workflows/loadtest.yml` lewat PR tersendiri. Menjalankannya dari HP:

1. GitHub (Chrome Android) -> repo -> tab **Actions** -> pilih workflow **Load test (sandbox)**.
2. **Run workflow** -> isi `base_url` (mis. `https://linoe-sandbox.netlify.app`), biarkan `vus` dan `duration_seconds` default -> **Run workflow**.
3. Buka run-nya: langkah **Validasi** gagal cepat bila host tidak ada di allowlist. Bila lolos, ringkasan k6 muncul di log langkah **Jalankan k6**.

## Membaca hasil

Ambang bawaan (skrip gagal bila dilanggar): `http_req_failed < 1%`, `p(95) http_req_duration < 2000 ms`, `checks > 99%`. Ambang ini titik awal, bukan SLO; Founder menetapkan target sebenarnya (RPO/RTO dan target latensi) sebelum peluncuran. Hasil dari beban kecil tidak membuktikan kapasitas. Jangan menaikkan batas VU/durasi tanpa persetujuan Founder dan tanpa memastikan situs sandbox sendiri tidak memicu biaya/limit (mis. kuota bandwidth atau function Netlify).

## Yang sengaja TIDAK ada

- Login, register, checkout, API tulis, `/api/*` selain `/api/health`.
- Target produksi, localhost, atau alamat IP.
- Variabel rahasia (tidak ada secret di skrip maupun workflow contoh).
- Berkas di `.github/workflows/`.

## Berkas

- `smoke.js`: skrip k6 (modul ES; k6 mengimpor `lib/allowlist.js` secara lokal).
- `lib/allowlist.js`: fungsi murni (validasi host, parser allowlist, batas) yang dites Vitest.
- `allowlist.txt`: daftar host yang diizinkan (bawaan kosong).
- `WORKFLOW_CONTOH.md`: rancangan workflow `workflow_dispatch` (teks contoh, belum aktif).
