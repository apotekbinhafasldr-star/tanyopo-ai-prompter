# Runner otomatis T6–T14 (sandbox DOKU saja)

Tujuan: menjalankan T6–T14 tanpa copy-paste SQL dari HP. Runner = `tools/run_sandbox.sh`, dijalankan oleh GitHub Actions
(`.github/workflows/doku-sandbox-runner.yml`). **Hanya untuk project `linoe-doku-sandbox` (ref `eskqngzhtndkfqjoxxou`).**

## Yang dijamin (dan diuji: `tools/test_runner_local.sh`, 39 pemeriksaan)
- Target ditolak SEBELUM koneksi jika host/user bukan pooler/direct milik ref sandbox; ref `umkmpro-ai` dan `linoe-otp-test` ditolak.
- Berkas SQL dicek SHA256 (`SHA256SUMS`) dan hash pohon `supabase/sandbox/doku` dicocokkan dengan nilai dari laporan audit.
- Sebelum mulai: penanda sandbox harus ada, tak ada tabel UMKMpro, dan **keadaan database harus persis sama** dengan keadaan acuan
  tahap sebelumnya (`tools/golden_state.txt`). Setelah tiap tahap: keadaan dibandingkan lagi. Selisih apa pun = STOP.
- Satu tahap = satu transaksi di berkasnya sendiri; gagal berarti tahap itu tidak terpasang dan tahap berikutnya tidak jalan.
- Kata sandi hanya lewat variabel lingkungan Environment; tidak pernah dicetak, tidak ada di argumen proses, tidak ada di repo.
- Repo ini PUBLIK, jadi log Actions publik: runner hanya mencetak nama tahap, PASS/FAIL, dan angka.
- Rollback (`99_rollback_sandbox.sql`) TIDAK otomatis; tetap keputusan terpisah.

## Penyiapan sekali (dari Chrome Android; aktifkan "Situs desktop" jika menu tidak terlihat)
1. **Supabase** → project `linoe-doku-sandbox` (cek ref di URL) → tombol **Connect** → **Session pooler**. Catat dua nilai:
   host `aws-…-ap-south-1.pooler.supabase.com` dan user `postgres.eskqngzhtndkfqjoxxou`. Port harus `5432`.
2. **Supabase** → Project Settings → Database → **Reset database password** (project sandbox saja). Pakai kata sandi baru yang
   acak dan simpan di pengelola kata sandi. Jangan kirim ke chat. Setelah semua tahap selesai, reset lagi.
3. **GitHub** repo → Settings → Environments → **New environment** `doku-sandbox`:
   - *Required reviewers*: tambahkan akun pemilik repo. (Tanpa ini workflow berhenti sendiri.)
   - *Deployment branches*: Selected branches → `main`.
   - *Environment variables*: `DOKU_DB_HOST` = host dari langkah 1, `DOKU_DB_USER` = `postgres.eskqngzhtndkfqjoxxou`.
   - *Environment secrets*: `DOKU_DB_PASSWORD` = kata sandi dari langkah 2.

## Menjalankan (setelah workflow ada di `main`)
1. Actions → **DOKU Sandbox Runner** → Run workflow. Isi: `mode=preflight`, tahap T6–T14, `sha` (40 karakter ujung `main`),
   `tree` (nilai dari laporan audit). Setujui di "Review deployments".
2. Preflight hanya membaca. Hasil yang diharapkan: `PREFLIGHT OK`. Jika `STOP`, kirim teks STOP-nya (tanpa kata sandi).
3. Jalankan lagi dengan `mode=execute` dan `confirm` = `EKSEKUSI-SANDBOX-DOKU`. Setujui lagi.
4. Hasil yang diharapkan: `SELESAI: tahap T6..T14 lulus`. Bila STOP, jangan jalankan ulang; kirim tahap dan teksnya.

Catatan: GitHub hanya menjalankan `workflow_dispatch` dari berkas yang sudah ada di `main`; jadi workflow ini baru bisa dipakai
setelah PR yang memuatnya digabung (persetujuan terpisah).
