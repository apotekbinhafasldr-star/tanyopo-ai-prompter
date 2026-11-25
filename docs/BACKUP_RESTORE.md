# Backup, restore, dan rollback (prosedur peluncuran)

Semua langkah bisa dikerjakan dari HP: Chrome Android + dashboard web Supabase, Netlify, dan GitHub. Tidak perlu laptop, Termux, atau CLI lokal.

**Status dokumen: DRAFT, belum pernah diuji.** Prosedur ini disusun dari dokumentasi resmi (lihat bagian 8) dan belum dicoba pada project nyata. Uji restore pertama dicatat di bagian 9. Nama menu dashboard bisa berubah; bila beda, ikuti label yang tampil dan perbarui dokumen ini.

Dokumen terkait: [RUNBOOK.md](RUNBOOK.md) (operasional harian; **bagian 4 adalah satu-satunya sumber kontak eskalasi**), kebijakan retensi internal (retensi dan penghapusan data), dan SOP insiden internal (insiden data pribadi, lewat RUNBOOK bagian 4).

**Catatan retensi (baca sebelum restore):** data yang sudah dihapus (termasuk atas permintaan subjek data) bisa masih ada di cadangan sampai cadangan tersebut berganti/kedaluwarsa. Karena itu restore tidak boleh dianggap memulihkan data yang sah; lihat prosedur pasca-restore di bagian 3.

## 0. Larangan mutlak: proyek `umkmpro-ai`

Proyek Supabase **`umkmpro-ai` adalah database produksi yang dipakai bersama LINOE, PUBLOE, MITAPENG, dan UMKMpro**. Satu kesalahan di sana berdampak ke semua produk.

Tanpa persetujuan eksplisit Founder (tertulis, dengan tanggal dan frasa persetujuan), **dilarang**:

- Menekan **Restore** pada backup/PITR di proyek `umkmpro-ai`. Restore PITR **menimpa** database yang sedang berjalan dan menghapus perubahan setelah titik pulih; proyek tidak bisa diakses selama proses.
- Mengaktifkan, mengubah, atau mematikan **PITR/add-on** (menyangkut biaya/billing; mengaktifkan PITR juga menghentikan daily backup menurut dokumentasi Supabase).
- Menghapus, mem-pause, atau memulihkan (restore/unpause) proyek `umkmpro-ai`.
- Menjalankan SQL apa pun di sana (termasuk "hanya SELECT"), mengubah RLS, fungsi, cron, auth, atau secret.
- Mengunduh backup produksi ke HP atau menaruhnya di tempat lain (isinya data pelanggan).
- Mengarahkan situs sandbox/uji ke proyek `umkmpro-ai` (env Netlify sandbox tidak boleh berisi URL/kunci produksi).

Yang boleh tanpa persetujuan tambahan: membaca dokumen ini, dan bekerja di project **baru/sandbox** milik Founder.

> Membuka halaman status backup `umkmpro-ai` (bagian 1) hanya membaca, tetapi tetap menyentuh proyek bersama. Lakukan hanya setelah Founder menulis persetujuan eksplisit (mis. "LIHAT STATUS BACKUP umkmpro-ai") dan jangan menekan tombol apa pun selain membuka halaman.

## 1. Memeriksa status backup dan PITR (hanya lihat)

Fitur backup **bergantung pada paket (plan)** dan add-on proyek. Jangan berasumsi: jumlah hari retensi, ketersediaan PITR, dan biayanya **verifikasi di dashboard** pada organisasi Supabase yang bersangkutan. Dokumen ini sengaja tidak menyebut angka paket atau harga.

Langkah (Chrome Android; bila layar sempit, aktifkan "Situs desktop" di menu Chrome):

1. Buka supabase.com/dashboard dan masuk dengan akun yang punya akses ke organisasi.
2. Pilih organisasi, lalu **project** yang dimaksud. Cek nama project di bagian atas halaman sebelum melanjutkan.
3. Menu kiri **Database** -> **Backups**. Tab di halaman ini bisa bernama mirip **Scheduled backups**, **Point in Time**, dan **Restore to a New Project** (label menurut dokumentasi; cocokkan dengan yang tampil).
4. Catat apa yang terlihat di tabel ini, tanpa mengubah apa pun:

| Hal yang dicek | Hasil (isi saat memeriksa) |
|---|---|
| Nama project dan region | (isi) |
| Paket organisasi (Billing) | UNKNOWN / diisi Founder dari dashboard |
| Backup harian tersedia? Tanggal backup terbaru | (isi) |
| Berapa hari backup tersimpan (retensi) | UNKNOWN / diisi Founder dari dashboard |
| PITR aktif? Rentang waktu pemulihan (awal-akhir) | UNKNOWN / diisi Founder dari dashboard |
| Physical backups aktif? (syarat "Restore to a New Project") | UNKNOWN / diisi Founder dari dashboard |
| Tanggal dan jam pemeriksaan, nama pemeriksa | (isi) |
| Status verifikasi | UNKNOWN. Belum ada bukti terverifikasi. Isi kelas bukti di bawah |

Kelas bukti untuk baris "Status verifikasi" (pilih satu per nilai yang diisi): **A** = terlihat langsung di dashboard dan dicatat dengan tanggal/pemeriksa; **B** = hanya dari dokumentasi vendor (bukan konfigurasi project ini); **C** = pernyataan lisan/tertulis tanpa bukti dashboard; **UNKNOWN** = belum diperiksa. Nilai berkelas B, C, atau UNKNOWN tidak boleh dipakai sebagai dasar janji kepada pelanggan.

5. Bila daftar backup kosong atau fitur tidak tersedia di paket yang dipakai: hentikan, catat, dan bawa ke Founder (bagian 2). Jangan mengubah paket atau mengaktifkan add-on atas inisiatif sendiri.

Catatan dari dokumentasi Supabase yang penting untuk perencanaan:
- Backup database **tidak mencakup file di Storage** (objek bucket seperti `product-media`). Rencana backup file harus ditetapkan terpisah.
- Password role kustom tidak ikut backup harian; perlu di-reset setelah restore.
- Proyek paket gratis: dokumentasi menyarankan ekspor data berkala dan penyimpanan di luar Supabase (butuh CLI atau alat lain; rancang terpisah, jangan dikerjakan sebelum disetujui).

## 2. RPO dan RTO (diputuskan Founder)

- **RPO** (Recovery Point Objective): berapa lama data terakhir yang boleh hilang. Contoh: "paling lama 24 jam".
- **RTO** (Recovery Time Objective): berapa lama layanan boleh mati sebelum pulih.

Kolom di bawah **sengaja kosong**. Dokumen ini tidak menentukan angkanya. Setelah mengisi, cocokkan dengan hasil bagian 1: RPO yang dipilih tidak boleh lebih ketat daripada yang sebenarnya bisa diberikan backup yang aktif. (Menurut dokumentasi Supabase, bila PITR aktif RPO terburuk sekitar dua menit; tanpa PITR, titik pulih sebatas backup harian. Verifikasi untuk paket yang dipakai.)

| Komponen | RPO (maks. data hilang) | RTO (maks. waktu pulih) | Dicakup oleh | Diputuskan oleh / tanggal |
|---|---|---|---|---|
| Database (auth, billing, data tenant) | UNKNOWN / diisi Founder | UNKNOWN / diisi Founder | Backup/PITR Supabase | (isi) |
| File Storage (media produk, dll.) | UNKNOWN / diisi Founder | UNKNOWN / diisi Founder | BUKAN backup database; rencana terpisah | (isi) |
| Kode aplikasi | n/a (ada di Git) | UNKNOWN / diisi Founder | Rollback deploy Netlify (bagian 5) | (isi) |
| Env/kunci (Netlify, Supabase) | n/a | UNKNOWN / diisi Founder | Catatan terpisah milik Founder (jangan ditaruh di repo) | (isi) |
| Status verifikasi | UNKNOWN (kelas bukti: lihat bagian 1) | UNKNOWN (kelas bukti: lihat bagian 1) | RTO nyata baru ada setelah uji restore di bagian 9; belum pernah dilakukan | (isi) |

## 3. Restore ke project BARU (bukan menimpa produksi)

Prinsip: backup dipulihkan ke **project baru**, diuji di sana, lalu project uji dihapus. Produksi tidak pernah ditimpa dalam latihan ini. Pemulihan darurat ke produksi (menimpa) adalah keputusan terpisah Founder saat insiden dan di luar prosedur latihan ini.

Syarat menurut dokumentasi Supabase (verifikasi di dashboard): hanya paket berbayar, physical backups aktif pada project sumber, dan titik waktu bebas hanya bila PITR aktif. Project hasil restore belum bisa dipakai sebagai sumber restore berikutnya.

Peringatan sebelum mulai:
- Data hasil restore adalah **salinan data pelanggan nyata** (akun auth beserta hash password, data semua produk yang berbagi database). Perlakukan setara produksi: jangan bagikan akses, jangan hubungkan ke aplikasi produksi, hapus setelah selesai.
- Dokumentasi menyatakan ekstensi seperti `pg_cron`, `pg_net`, dan `wrappers` ikut tersalin dan **jobnya mulai berjalan setelah restore selesai**. Karena itu langkah 3.4 (matikan cron) harus dilakukan segera.
- Membuat project baru dapat menimbulkan biaya sampai dihapus (verifikasi di dashboard organisasi). Founder yang memutuskan.

Langkah:

1. **Persetujuan dan catatan awal.** Founder menulis persetujuan eksplisit untuk restore uji dari `umkmpro-ai` (memulai restore dilakukan dari halaman Backups project sumber, jadi menyentuh proyek bersama). Catat jam mulai, alasan, backup/titik waktu yang dipilih, pelaksana.
2. **Mulai restore.** Di project sumber: **Database** -> **Backups** -> tab **Restore to a New Project** -> pilih backup (atau, bila PITR aktif, pilih tanggal dan jam pada pemilih waktu) -> **Restore**. Beri nama project baru yang jelas, mis. `restore-uji-AAAAMMDD`, bukan nama yang mirip produksi.
3. **Tunggu** sampai status project baru Active. Waktu bergantung ukuran database; catat durasinya (ini bahan RTO nyata).
4. **Segera di project BARU** (pastikan nama project di bagian atas halaman adalah project uji): buka **Integrations** -> **Cron** -> **Jobs** (label menurut dokumentasi; cocokkan dengan yang tampil) dan matikan semua job (saklar **Active/Inactive** ke Inactive). Catat job yang ada, terutama yang memanggil layanan luar.
5. **Konfigurasi yang tidak ikut tersalin** (menurut dokumentasi): objek dan konfigurasi bucket Storage, Edge Functions, pengaturan Auth dan API keys, pengaturan Realtime, pengaturan ekstensi, read replica. Catat mana yang relevan; jangan menyalin kunci dari produksi.
6. **Verifikasi** dengan checklist bagian 4.
7. **Pembersihan.** Setelah hasil dicatat, hapus project uji: **Project Settings** -> **General** -> **Delete project** (jalur menu ini belum dicocokkan dengan dokumentasi; ikuti label yang tampil; pada project BARU saja, ketik ulang namanya persis). Periksa dua kali nama sebelum konfirmasi; penghapusan permanen dan tidak bisa dibatalkan. Jangan pernah menghapus `umkmpro-ai`.
8. Isi log di bagian 9.

### Prosedur pasca-restore: permintaan hapus data subjek

Cadangan menyimpan data sebagaimana adanya pada titik waktunya, sehingga data yang sudah dihapus atas permintaan subjek data bisa muncul kembali setelah restore. Restore tidak boleh memulihkan data tersebut tanpa penghapusan ulang. Setelah restore (uji maupun darurat) dan sebelum project hasil restore dipakai oleh siapa pun atau dihubungkan ke aplikasi:

1. Minta Founder membuka **register permintaan hapus** (register dan urutan penghapusan: SOP hak subjek internal bagian 3 dan 5; bila belum ada, catat sebagai temuan dan bawa ke Founder).
2. Bandingkan permintaan hapus yang tercatat dengan tanggal titik pulih: semua permintaan yang selesai **setelah** titik pulih berarti datanya kembali ada di hasil restore.
3. Jalankan ulang penghapusan untuk setiap permintaan itu mengikuti prosedur penghapusan di kebijakan retensi, lalu catat bahwa penghapusan ulang selesai. Perubahan data di project hasil restore (apalagi produksi) hanya atas persetujuan Founder.
4. Catat hasilnya di log bagian 9.

Opsional dan butuh persetujuan terpisah: menghubungkan situs Netlify **sandbox** ke project hasil restore untuk uji fungsional. Itu mengubah env Netlify sandbox; jangan lakukan tanpa persetujuan Founder, dan jangan memakai kunci produksi.

## 4. Checklist verifikasi pascarestore

Semua kueri di bawah hanya `SELECT`, dijalankan **hanya di project BARU**: menu kiri **SQL Editor** -> New query. Sebelum menekan Run, baca ulang nama project di bagian atas halaman. **Jangan menjalankannya di `umkmpro-ai`.**

Angka pembanding (baseline) dari produksi baru boleh diambil setelah Founder menyetujui akses baca ke produksi. Tanpa itu, bandingkan dengan isi migrasi di repo (`supabase/migrations/`) dan dengan [DATABASE.md](DATABASE.md), dan catat bahwa baseline belum ada.

| # | Pemeriksaan | Kueri/cara | Hasil yang diharapkan | Hasil (isi) |
|---|---|---|---|---|
| 1 | Jumlah tabel skema `public` | `select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE';` | Sama dengan baseline | |
| 2 | Perkiraan jumlah baris per tabel | `select relname, n_live_tup from pg_stat_user_tables where schemaname = 'public' order by relname;` | Wajar dibanding baseline (angka perkiraan, bukan hitungan pasti) | |
| 3 | Tabel `public` TANPA RLS | `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity order by 1;` | Kosong, atau hanya tabel yang memang sengaja tanpa RLS dan terdokumentasi | |
| 4 | Jumlah policy per tabel | `select tablename, count(*) from pg_policies where schemaname = 'public' group by 1 order by 1;` | Sama dengan baseline; tabel `prompter_oauth_credentials` memang RLS aktif dengan nol policy ([SECURITY.md](SECURITY.md)) | |
| 5 | Fungsi di `public` | `select p.proname, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1;` | Jumlah sama dengan baseline; fungsi dari migrasi repo ada, mis. `fn_apply_scheduled_cancellations`, `fn_apply_expired_subscriptions`, `fn_expire_stale_payment_transactions` | |
| 6 | Cron | `select jobid, jobname, schedule, active from cron.job order by jobname;` (kolom `active` harus `false` sesuai langkah 3.4) | Job dari migrasi repo ada: `prompter-apply-scheduled-cancellations`, `prompter-apply-expired-subscriptions`, `prompter-expire-stale-payment-transactions`, plus job produk lain | |
| 7 | Ekstensi | `select extname from pg_extension order by 1;` | Sama dengan baseline | |
| 8 | Jumlah akun auth (hanya agregat) | `select count(*) from auth.users;` | Wajar dibanding baseline. Jangan menampilkan email/ID di tangkapan layar | |
| 9 | Bucket Storage | `select id, public from storage.buckets order by 1;` | Catat apa adanya; objek dan konfigurasi bucket tidak ikut tersalin menurut dokumentasi | |
| 10 | Riwayat migrasi | `select count(*) from supabase_migrations.schema_migrations;` | Catat; bandingkan dengan daftar di `supabase/migrations/` | |

Kriteria lulus: nomor 1, 3, 4, 5, 6, dan 7 sama dengan baseline (atau selisih dijelaskan dan disetujui Founder) dan semua cron berstatus tidak aktif di project uji. Satu angka tidak cocok: catat, jangan "diperbaiki" dengan SQL, bawa ke Founder.

## 5. Rollback kode via Netlify

Rollback hanya mengembalikan **kode**. Perubahan database (migrasi) TIDAK ikut kembali; jangan jalankan SQL perbaikan tanpa persetujuan Founder. Ringkasannya sama dengan [RUNBOOK.md](RUNBOOK.md) bagian 2, dengan label menu menurut dokumentasi Netlify:

1. Netlify -> pilih site -> tab **Deploys**.
2. Buka deploy terakhir yang sehat (status Published, sebelum masalah mulai).
3. Tekan **Publish deploy**. Menurut dokumentasi ini tidak memicu build baru, hanya menerbitkan ulang deploy atomik sebelumnya.
4. Netlify menghentikan auto-publish setelah rollback (kunci publishing). Aktifkan kembali hanya setelah perbaikan siap, lewat pilihan **Unlock to start auto publishing** di daftar **Deploys** (di RUNBOOK tertulis "Start auto publishing"; cocokkan dengan label yang tampil).
5. Verifikasi: buka `/api/health` (harus `{"status":"ok"}`), lalu jalankan bagian login di [SMOKE_TEST_CHECKLIST.md](SMOKE_TEST_CHECKLIST.md).
6. Catat: jam, deploy mana yang dipublish, penyebab dugaan, siapa yang menyetujui.

Hal yang perlu diwaspadai (verifikasi di dashboard, jangan diasumsikan):
- Perubahan variabel lingkungan tidak otomatis ikut kembali; bila masalah disebabkan env, perbaikan env adalah perubahan yang butuh persetujuan Founder.
- Scheduled functions (`payment-pending-sweep`, `payment-alert-notify`) hanya berjalan pada deploy produksi yang terbit; setelah rollback, versi yang berjalan adalah versi dari deploy yang dipublish.
- Kode lama mungkin tidak cocok dengan skema database yang sudah dimigrasi. Bila migrasi baru dilakukan bersamaan dengan deploy, rencanakan rollback sebagai paket sebelum rilis, bukan saat insiden.

## 6. Kontak eskalasi (merujuk ke RUNBOOK)

Daftar kontak dan urutan eskalasi **hanya disimpan di [RUNBOOK.md](RUNBOOK.md) bagian 4** (sumber tunggal). Dokumen ini sengaja tidak menyimpan kontak sendiri agar tidak bertentangan. Perubahan kontak dilakukan di RUNBOOK bagian 4, bukan di sini. Jangan menyimpan sandi, kunci, atau token di dokumen mana pun di repo.

Catatan yang diakui di RUNBOOK bagian 4: kontak tunggal adalah single point of failure, dan kontak cadangan masih [DIISI FOUNDER]. Insiden yang menyangkut data pribadi: ikuti rujukan di RUNBOOK bagian 4 ke SOP insiden internal.

Pembagian wewenang selama insiden:
- Rollback kode (bagian 5): operator atas persetujuan Founder.
- Restore ke project baru (bagian 3): hanya atas persetujuan Founder.
- Apa pun yang menyentuh `umkmpro-ai` (bagian 0): hanya Founder yang memutuskan.

## 7. Yang tetap harus diputuskan Founder (daftar singkat)

1. Angka RPO dan RTO per komponen (bagian 2).
2. Apakah paket Supabase yang dipakai sudah cukup untuk RPO tersebut (bagian 1).
3. Rencana backup file Storage (di luar backup database).
4. Izin akses baca untuk baseline produksi (bagian 4) dan izin memulai restore uji dari `umkmpro-ai` (bagian 3, langkah 1).
5. Kontak eskalasi dan kontak cadangan (di [RUNBOOK.md](RUNBOOK.md) bagian 4; bagian 6 hanya merujuk) dan jadwal uji restore pertama (bagian 9).
6. Lokasi register permintaan hapus (SOP hak subjek internal) dan kebijakan retensi cadangan (kebijakan retensi internal), dipakai pada prosedur pasca-restore (bagian 3).

## 8. Sumber dokumentasi resmi (diakses 2026-11-11)

Dipakai hanya untuk mencocokkan nama menu/fitur, bukan untuk mengutip harga atau kuota. Verifikasi ulang bila lama tak diperbarui.

- Supabase, Database Backups: https://supabase.com/docs/guides/platform/backups (juga tersedia sebagai https://supabase.com/docs/guides/platform/backups.md). Menu **Database** -> **Backups**, pengaturan "Point in Time", ketergantungan paket/add-on, backup tidak mencakup objek Storage.
- Supabase, Restore to a new project: https://supabase.com/docs/guides/platform/clone-project. Tab **Restore to a New Project**, syarat paket berbayar dan physical backups, daftar yang disalin/tidak disalin, jobs `pg_cron` ikut berjalan.
- Supabase, Cron (quickstart): https://supabase.com/docs/guides/cron/quickstart.md. Bagian **Jobs**, saklar **Active/Inactive**, **Delete cron job**. Halaman ini tidak menyebut jalur menu pastinya (kemungkinan **Integrations** -> **Cron**); cocokkan di dashboard.
- Netlify, Manage deploys: https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview. Tab **Deploys**, **Publish Deploy**, **Lock to stop auto publishing** / **Unlock to start auto publishing**.

## 9. Log uji restore (isi setiap kali latihan)

| Tanggal | Pelaksana | Backup/titik waktu | Project uji | Durasi restore | Hasil checklist (lulus/gagal + catatan) | Project uji dihapus? |
|---|---|---|---|---|---|---|
| (isi) | (isi) | (isi) | (isi) | (isi) | (isi) | (isi) |
