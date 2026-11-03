# Migrasi production via GitHub Actions (persetujuan Founder)

Status: **dibuat, belum dipakai.** Tidak ada secret, role, atau Environment yang dibuat oleh PR ini. Tidak ada SQL production yang dijalankan.
Project yang dituju: `umkmpro-ai` (`wjjyqovhmwenbcvbnkgx`), **BERSAMA PUBLOE/UMKMpro**.

## Prinsip
- Hanya `workflow_dispatch` (dijalankan manual). Tidak ada auto-apply saat push, merge, atau PR.
- Production berubah hanya setelah **persetujuan Founder di GitHub Environment `production-migration`**.
- Workflow hanya menjalankan **paket yang tercantum di `supabase/prod-packages/manifest.json`**. Tidak pernah memindai folder migrasi, tidak memakai Supabase CLI, tidak pernah `db push` / `migration up`.
- Berhenti (STOP) pada pemeriksaan pertama yang gagal. Tidak ada rollback otomatis.
- Paket P0-2 dipasang **tanpa backfill**: dua transaksi Xendit lama tetap tanpa invoice dan tidak disentuh.

## Audit keamanan repository PUBLIC
| Risiko | Pengendali |
|---|---|
| Orang lain memicu workflow | Hanya pemegang akses tulis yang bisa menjalankan `workflow_dispatch`; job dilewati jika bukan `main`; Environment membatasi branch ke `main`. |
| Workflow diubah di branch lalu dijalankan dengan secret | Secret hanya ada di Environment (bukan repo). Environment dibatasi ke `main`; job punya `if: github.ref == 'refs/heads/main'`. |
| PR dari fork mencuri secret | Workflow production tidak punya pemicu PR. `ci.yml` tidak memakai secret sama sekali (diuji). |
| Log publik membocorkan data | Runner hanya mencetak nama pemeriksaan, PASS/FAIL, jumlah, dan hash. Password tidak pernah dicetak dan disamarkan; pesan error dibersihkan dari password (diuji). |
| Script injection lewat input | Semua `${{ }}` hanya sebagai nilai `env:`; SHA divalidasi regex 40 hex (diuji). |
| Action pihak ketiga disusupi | Workflow production **tidak memakai action sama sekali**; checkout lewat `git fetch` dari commit yang tepat. |
| SQL diganti | Lapisan: (1) checksum SHA-256 di manifest, (2) lint SQL (token terlarang, file read-only tidak boleh menulis, B tidak boleh menulis ledger, D hanya satu INSERT), (3) daftar objek yang boleh diubah (`ddl_targets`, `allowed_public_refs`) — checksum yang dibuat ulang tetap gagal jika objek baru disentuh, (4) B memeriksa sidik jari data dan objek lain sebelum/sesudah dan membatalkan seluruhnya bila ada beda, (5) CI gladi bersih membuktikan perubahan katalog = `expected_effects` persis, (6) review PR oleh Founder. Checksum saja tidak dianggap cukup. |
| SHA basi / salah | SHA input harus = commit workflow = ujung `main` saat itu; selain itu STOP. |

## Persetujuan: dibuktikan, bukan diasumsikan
GitHub membuat Environment yang belum ada secara otomatis **tanpa** reviewer. Karena itu workflow memeriksa sendiri
`GET /actions/runs/{id}/approvals`: harus ada review `approved` oleh pemilik repository untuk `production-migration`.
Jika Required reviewers belum diatur, daftar kosong dan job **STOP sebelum secret dipakai**. Kesiapan mekanisme persetujuan
baru terbukti pada run pertama (`owner-audit` atau `verify-only`) yang benar-benar meminta persetujuan Anda.

## Konfigurasi sekali (dari browser HP) — dikerjakan Founder
1. Repo → **Settings → Environments → New environment** → nama persis `production-migration`.
2. Centang **Required reviewers** → tambahkan akun Founder. Biarkan **Prevent self-review** TIDAK dicentang (satu-satunya reviewer adalah pemilik). Matikan **Allow administrators to bypass** bila tersedia.
3. **Deployment branches and tags → Selected branches and tags → main.**
4. (Disarankan) **Settings → Branches/Rulesets → main**: wajib pull request, wajib status check CI, larang force-push.
5. **Jangan** isi variable/secret sebelum langkah berikut disetujui.

## Role database — TIDAK dibuat oleh sistem ini
Tidak ada role yang dibuat dan tidak ada role berkekuatan `postgres` yang dipakai tanpa audit pemilik dan persetujuan terpisah.
1. Founder menjalankan **satu SELECT read-only** `supabase/prod-packages/tools/owner_audit_readonly.sql` di SQL Editor dan mengirim hasilnya (tanpa data pelanggan).
2. Hasil audit menentukan role: pemilik objek (`prompter_invoices`, `fn_apply_verified_payment`) menentukan apakah role migrasi bisa sempit, atau harus anggota role pemilik (= berkekuatan tinggi).
3. Role `linoe_migrator` dibuat hanya setelah persetujuan terpisah. Runner menolak login selain `linoe_migrator.<project_ref>`, menolak superuser, dan menolak anggota `postgres`/`supabase_admin` kecuali `approved_privileged_role` diubah lewat PR yang disetujui.
4. Barulah Environment diberi variable `MIGRATION_DB_HOST` (pooler `aws-N-ap-southeast-1.pooler.supabase.com`), `MIGRATION_DB_USER` (`linoe_migrator.<ref>`) dan secret `MIGRATION_DB_PASSWORD`. Port wajib 5432 (pooler mode session), TLS wajib.

## Cara menjalankan (HP)
1. GitHub → **Actions → Production Migration → Run workflow**, pilih branch **main**, paket `p0-2`, mode, dan **SHA 40 karakter ujung main** (salin dari halaman Commits).
2. Buka notifikasi **Review deployments** (aplikasi GitHub Mobile atau halaman run) → setujui.
3. Urutan yang disarankan: `owner-audit` → `verify-only` → `apply` → `verify-only`.

| Mode | Efek |
|---|---|
| `owner-audit` | Laporan pemilik/hak (read-only) |
| `verify-only` | Sesuai keadaan DB: sebelum apply → preflight A; ter-apply belum dicatat → C; selesai → F. Read-only |
| `apply` | Hanya jika keadaan = sebelum apply: A → B → C (dibandingkan dengan A) → D → F |
| `record-ledger` | Hanya jika ter-apply tapi belum dicatat: C → D → F |
| `rollback` | E (menolak sendiri bila sudah ada invoice terhubung). Catatan ledger tidak dihapus otomatis |

Hasil ada di **Summary** run. Baris terakhir `RESULT: PASS` atau `RESULT: STOP - <alasan>`.

## Prosedur STOP
- Pemeriksaan A/C/F tidak sesuai, keadaan `UNKNOWN`, atau error apa pun → job berhenti; langkah berikutnya tidak jalan. B adalah satu transaksi: kegagalan membatalkan seluruhnya.
- Jangan jalankan ulang tanpa memahami penyebab. Kirim teks Summary ke Claude.
- C gagal setelah B sukses: D tidak dijalankan. Keputusan `rollback` ada pada Founder (persetujuan terpisah).
- Hanya satu run pada satu waktu (`concurrency`).

## Mencegah migrasi lama terulang
Runner menolak jika: paket tidak ada di manifest; checksum/lint/daftar objek tidak cocok; keadaan DB bukan yang diharapkan (hash fungsi, kolom, ledger); versi sudah ada di ledger. Tidak ada jalur yang memutar ulang direktori migrasi.

## Menambah paket baru
PR yang menambah folder di `supabase/prod-packages/<id>/`, entri manifest (checksum, `ddl_targets`, `allowed_public_refs`, `expected_effects`), opsi di workflow, dan tes gladi bersih. Wajib CI hijau dan persetujuan Founder.

## Risiko tersisa
- Run pertama baru bisa diuji setelah merge (workflow_dispatch hanya muncul di branch default). Mulai dengan `owner-audit`/`verify-only`.
- Pembatasan IP Supabase tidak praktis (IP runner GitHub berubah); perlindungan = TLS + password kuat + role terbatas + persetujuan.
- Role yang harus menjadi anggota pemilik objek berkekuatan tinggi pada project bersama; dikendalikan oleh persetujuan, checksum, lint, dan sidik jari objek lain.
- `actions/checkout` tidak dipakai; runner GitHub tetap pihak ketiga yang tepercaya.
- Berkas D memakai variabel psql `:'created_by'`; untuk SQL Editor manual ganti dengan teks literal.
