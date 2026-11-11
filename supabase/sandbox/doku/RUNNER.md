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

## Paket P0-3 (alert webhook DOKU) — T15..T17, BELUM dijalankan di cloud
Menerapkan migrasi `20261111130000_prompter_p0_3_doku_alert_coverage.sql` (sudah di `main`, PR #112) ke **sandbox saja**. Default runner tetap `T6..T14`;
paket ini hanya jalan bila `from_stage`/`to_stage` diisi `T15`/`T17` secara eksplisit (dan tetap lewat persetujuan Environment `doku-sandbox`).
- **T15** `40_p03_doku_alert_coverage.sql`: satu transaksi. *Preflight drift* di dalam SQL: marker sandbox, tidak ada tabel UMKMpro, tepat 49 migrasi dengan versi terakhir
  `20261103170000`, objek B4.1 lengkap, **md5 badan** `fn_sync_payment_alerts` dan `fn_note_payment_alert_sync_failure` = badan B4.1 yang diaudit, `SECURITY DEFINER` + `search_path`, ACL
  hanya service_role. Selisih sekecil apa pun = ABORT, tidak ada yang berubah dan tidak ada yang ditimpa. Lalu migrasi disalin apa adanya, diperiksa ulang (md5 badan baru, ACL), dan dicatat (50).
- **T16** `41_verify_p03_readonly.sql` (baca-saja, 15 baris + `ALL_PASS`). Menggantikan `30_` setelah T15 (`30_` mengharapkan 49 migrasi, jangan dijalankan ulang).
- **T17** `42_smoke_doku_alert_rollback.sql`: transaksi dummy DOKU/Midtrans lewat fungsi resmi, event `ALARM_*`, sync dua kali; **selalu rollback** (`SMOKE_OVERALL=PASS`).
- **Rollback manual** `98_rollback_p03_sandbox.sql` (bukan bagian runner): hanya dari keadaan P0-3 persis (50 migrasi, md5 badan P0-3); mengembalikan badan B4.1 dan menghapus satu baris pelacak. Tidak menghapus data alert.
- Berkas `40/41/42/98` dibangun otomatis: `python3 tools/build_p03_package.py` (`--check` memastikan repo = hasil bangun; hash dihitung dari berkas migrasi, bukan diketik).
- Uji lokal: `bash tools/test_runner_local.sh` (68 cek, termasuk drift sync/fn_note/ACL, tabel UMKMpro, verify menolak drift, rollback bolak-balik, smoke mendeteksi B4.1).
- Karena `supabase/sandbox/doku` berubah, **hash pohon (`tree`) untuk workflow berubah** setelah PR ini di-merge; ambil nilai baru dari laporan audit.
