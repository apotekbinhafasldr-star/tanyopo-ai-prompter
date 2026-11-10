# Runner otomatis T6–T14 (sandbox DOKU saja)

Menjalankan T6–T14 tanpa copy-paste SQL dari HP. Runner = `tools/run_sandbox.sh`, dijalankan oleh GitHub Actions
(`.github/workflows/doku-sandbox-runner.yml`). **Hanya untuk project `linoe-doku-sandbox` (ref `eskqngzhtndkfqjoxxou`).**

## Yang dijamin (diuji lokal: `bash tools/test_runner_local.sh`)
- `target_ref` hanya bisa dipilih satu nilai (ref sandbox). `tools/validate_target.py` memeriksa ulang ref + host + user Environment
  pada langkah **tanpa secret**; kata sandi baru dipasang pada langkah terakhir. Runner memeriksa sekali lagi sebelum koneksi.
  Ref `umkmpro-ai` dan `linoe-otp-test` ditolak di tiga tempat.
- Hanya secret `DOKU_DB_PASSWORD`. Workflow tidak memakai secret production mana pun.
- Berkas SQL: SHA256 (`SHA256SUMS`) + hash pohon `supabase/sandbox/doku` harus sama dengan nilai yang diaudit.
- Keadaan database harus persis sama dengan acuan (`tools/golden_state.txt`) sebelum mulai dan setelah tiap tahap; selisih = STOP.
- Satu tahap = satu transaksi; gagal = tahap itu tidak terpasang dan tahap berikutnya tidak jalan. Rollback tidak otomatis.
- Repo ini PUBLIK, jadi log Actions publik: hanya nama tahap, PASS/FAIL, dan angka yang dicetak.

## Dukungan proteksi Environment (bukti, bukan asumsi)
- Dokumentasi GitHub: pada paket Free/Pro/Team, *required reviewers* dan *deployment branches* tersedia untuk repo **publik**; repo privat
  butuh paket berbayar yang sesuai (dan Free tidak mendukung environment secrets di repo privat). Repo ini publik, jadi didukung.
- Dukungan ≠ sudah dikonfigurasi. Pengaturan Environment tidak bisa dibaca dari sesi Claude. Karena itu workflow **membuktikan sendiri**
  persetujuan (`check_approval.py` membaca daftar persetujuan run) sebelum secret dipakai: jika Environment tidak punya reviewer,
  daftar kosong dan workflow berhenti. Satu hal yang tidak bisa dibuktikan dari dalam run: pembatasan *deployment branches*
  (harus diset ke `main`, agar branch lain tidak bisa memakai secret). Itu bagian dari langkah Founder di bawah.
- Jangan aktifkan "Prevent self-review" (pemilik repo adalah satu-satunya penyetuju).
- Jika repo diubah menjadi privat di paket Free, reviewer dan secret environment tidak tersedia: runner berhenti dan tidak boleh dipakai.

## Langkah minimum Founder (Android Chrome, aktifkan "Situs desktop" bila menu tidak terlihat)
1. **Supabase** → `linoe-doku-sandbox` (cek ref di URL) → **Connect** → **Session pooler**: catat *host* (`aws-…pooler.supabase.com`)
   dan *user* (`postgres.eskqngzhtndkfqjoxxou`). Port harus 5432.
2. **Supabase** → Project Settings → Database → **Reset database password** (sandbox saja). Simpan di pengelola kata sandi; jangan kirim ke chat.
3. **GitHub** → repo → Settings → Environments → New environment **`doku-sandbox`**:
   - *Required reviewers* = akun pemilik repo. *Deployment branches* = Selected branches → `main`.
   - *Environment variables*: `DOKU_DB_HOST` (host), `DOKU_DB_USER` (user).
   - *Environment secrets*: `DOKU_DB_PASSWORD`.
4. Setelah workflow ada di `main`: Actions → **DOKU Sandbox Runner** → Run workflow → `mode=preflight`, isi `sha` (40 karakter ujung `main`)
   dan `tree` (dari laporan audit) → setujui di "Review deployments". Harapan: `PREFLIGHT OK`.
5. Ulangi dengan `mode=execute` dan `confirm` = `EKSEKUSI-SANDBOX-DOKU`. Harapan: `SELESAI: tahap T6..T14 lulus`.
6. Setelah selesai, reset lagi kata sandi sandbox.

GitHub hanya menjalankan `workflow_dispatch` dari berkas yang sudah ada di `main`; workflow baru bisa dipakai setelah PR ini digabung.
