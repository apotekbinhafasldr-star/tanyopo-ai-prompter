# Checklist Founder (dari HP) dan audit kesiapan soft launch 10 tenant

Status: **DOKUMEN (Draft)**. Tidak ada perubahan database, env, Netlify, billing, auth, proxy, atau migrasi oleh dokumen ini. Tidak ada query ke database mana pun.
Audit atas kode `origin/main` commit `732b818` (2026-11-11); `/api/ready` dan `docs/MONITORING_HP.md` ada di Draft PR #127 (belum merge).
Semua langkah Founder memakai browser/aplikasi Android saja. Pelengkap [SOFT_LAUNCH_10_TENANTS.md](SOFT_LAUNCH_10_TENANTS.md), [RUNBOOK.md](RUNBOOK.md), [BACKUP_RESTORE.md](BACKUP_RESTORE.md).
Label status: CODE READY, belum CUSTOMER READY (tidak ada REAL E2E; pembayaran riil OFF).

---

## Bagian A. Audit gate G1-G16 berdasarkan bukti

Legenda: **TERBUKTI** = ada di kode/skema/CI repo. **BELUM TERBUKTI** = hanya klaim dokumen atau belum dikerjakan. **BUTUH FOUNDER** = hanya bisa dipastikan lewat dashboard/akun/keputusan (tidak bisa diperiksa dari sini).

| Gate | Hasil | Bukti nyata / alasan |
|---|---|---|
| G1 Gate S1 anggaran | **TERBUKTI** | `lib/campaigns/external-budget-guard.ts`: `BUDGET_WRITE_ENABLED_PLATFORMS` = `Object.freeze([])`, tanpa baca env/DB/klien. Tes `external-budget-guard`, `budget-write-callsites`, `soft-launch-docs` ada. CI `build` pada commit `732b818`: success. Ini "kode", bukan bukti E2E ke platform. |
| G2 Pembayaran riil OFF | **TERBUKTI di kode; env BUTUH FOUNDER** | Midtrans: tanpa `PAYMENT_LIVE_ENABLED` hanya mode sandbox; live butuh DUA saklar (`PAYMENT_LIVE_ENABLED=="true"` dan `PAYMENT_PROVIDER_ENV=="production"`), nilai lain = adapter tidak terkonfigurasi (tutup). DOKU memakai saklar serupa. Tidak bisa menyala tanpa env. Nilai env produksi: lihat langkah C6. |
| G3 Migrasi S1 aktif (trigger trial 14 hari, kuota AI) | **BELUM TERBUKTI** | Skema ada dan diuji CI (`s1-trial-quota-sql`, `s1-wrapper-pg17`: success): trigger `fn_enforce_trial_subscription_insert` memaksa TRIALING/FREE/`now()`/`now()+14 hari`; RPC kuota menolak `TRIAL_EXPIRED` dan `AI_USAGE_LIMIT_REACHED`. Tetapi "sudah diterapkan" hanya klaim: `docs/AI_JOBS_QUOTA_GUARD.md` menyebut "S1 sudah di production" (pembacaan katalog 2026-11-07, sudah 4 hari) dan RUNBOOK quota-guard menyebut "tercatat di ledger", sedangkan header `docs/S1_TRIAL_AI_QUOTA.md` masih berbunyi "NOT applied to any database". Dokumen saling bertentangan; tidak ada catatan applied yang bertanggal di repo. Periksa lewat langkah C4. |
| G4 Email konfirmasi ke alamat non-tim | **BUTUH FOUNDER (risiko blocker)** | Repo tidak mencatat SMTP kustom. Dokumentasi resmi Supabase: SMTP bawaan hanya mengirim ke alamat anggota tim proyek, batas 2 pesan/jam, "tidak untuk produksi" (lihat bagian D1). Bila SMTP bawaan masih dipakai, calon tenant biasa tidak menerima email konfirmasi dan pendaftaran mereka macet. Uji: langkah C5. |
| G5 Batas biaya AI di penyedia | **BUTUH FOUNDER** | Kode hanya membatasi per tenant (30 AI/trial) dan per sesi demo (5) serta batas memori per instance. Biaya total tidak punya batas di kode (`estimated_cost` belum diisi, `docs/AI_SYSTEM.md`). Pagar terakhir hanya di dashboard penyedia: langkah C1. |
| G6 Kontak eskalasi RUNBOOK bagian 4 | **BELUM TERBUKTI (kosong)** | `docs/RUNBOOK.md` bagian 4: kolom Level 1 dan 2 masih `(isi)`. Perhatian: repo PUBLIK, jangan tulis nomor pribadi di sana (langkah C3). |
| G7 Pemantau uptime | **BELUM TERBUKTI** | Belum ada monitor (tindakan Founder). `/api/health` ada di main (hanya liveness, tidak cek DB). `/api/ready` TIDAK ada di main (hanya di Draft PR #127, menyentuh `proxy.ts`, butuh persetujuan merge terpisah). Langkah C2. |
| G8 Backup/restore | **BUTUH FOUNDER** | `docs/BACKUP_RESTORE.md` ada di main tetapi berstatus DRAFT "belum pernah diuji"; tabel RPO/RTO sengaja kosong; paket Supabase dan ketersediaan backup belum dicatat siapa pun. Membuka halaman Backups `umkmpro-ai` butuh persetujuan eksplisit (dokumen itu bagian 0-1). |
| G9 PSE Lingkup Privat (TDPSE) | **BUTUH FOUNDER** | Keputusan hukum Founder/konsultan; bukan hal yang bisa dibuktikan dari kode. |
| G10 Halaman hukum | **TERBUKTI sebagian** | `/privacy`, `/terms`, `/refund`, `/data-deletion` ada di `PUBLIC_PATHS` `proxy.ts`. Tanggal berlaku `LEGAL.effectiveDate` masih `undefined` (`features/legal/legal-meta.ts`): BELUM. Form daftar mewajibkan kotak `acceptLegal`. |
| G11 `ADMIN_CENTER_ENABLED` kosong | **TERBUKTI di kode; env BUTUH FOUNDER** | `lib/admin/flag.ts`: hanya aktif bila persis `"true"`; selain itu `/admin` 404. Nilai env produksi: langkah C6. |
| G12 Smoke test produksi | **BELUM TERBUKTI** | `docs/SMOKE_TEST_CHECKLIST.md` ada; tidak ada catatan hasil. Tidak ada REAL E2E. |
| G13 Tidak minta tenant sambungkan Meta/TikTok/X | **Aturan operasional** | Tidak ada yang bisa dibuktikan dari kode kecuali gate S1 (G1) menolak tulis anggaran. Status review aplikasi di platform: EXTERNAL BLOCKED/belum terverifikasi. |
| G14 Jangan sentuh PUBLOE/MITAPENG/UMKMpro | **Aturan operasional** | Proyek `umkmpro-ai` dibagi. Dokumen ini hanya menulis langkah BACA-SAJA. |
| G15 Guard kuota AI #48 (peran, validasi input) | **BELUM TERBUKTI** | File migrasi `20261021120000`/`20261021120100` ada di repo, tetapi file di repo bukan bukti diterapkan; dokumen menyebut belum diterapkan. Risiko rendah: tenant trial 1 pengguna dan tidak ada fitur undang pengguna di kode. |
| G16 Error tracker | **TIDAK ADA** | Hanya `console.error` di `app/error.tsx`/`app/global-error.tsx`; kegagalan senyap tidak terlihat. |

Ringkasan: TERBUKTI (kode) G1, G2*, G10*, G11*; BELUM TERBUKTI G3, G6, G7, G12, G15, G16; BUTUH FOUNDER G2*, G4, G5, G8, G9, G11*, G13, G14. (*= sebagian)

### A2. Pemeriksaan khusus

| Hal | Temuan |
|---|---|
| Trial 14 hari | Dua lapis. Aplikasi: `services/billing.ts` `TRIAL_DURATION_DAYS = 14`, membuat baris trial saat akses pertama (lazy). Database: trigger S1 memaksa periode oleh jam server bila migrasi aktif (G3). **Tanpa S1 aktif**, tenant teknis bisa memalsukan periode lewat API; dengan 10 tenant undangan risiko kecil tetapi tidak nol. Setelah masa trial: `TRIAL_EXPIRED` (migrasi `20260924173424`) menolak AI, aktivasi produk, dan slot kampanye. Tidak ada kode perpanjangan. |
| Pembatasan fitur berbayar | Yang ditegakkan DB: kuota FREE (30 AI, 3 produk aktif, 2 kampanye aktif; seed `prompter_plan_entitlements`, tes drift ke `lib/billing/plans.ts`), `TRIAL_EXPIRED`, `PAST_DUE`/`CANCELED`. **`maxUsers: 1` hanya tercatat di tabel entitlement; tidak ditemukan penegakan di kode** (tetapi juga tidak ditemukan fitur undang pengguna). Header `lib/billing/plans.ts` menyatakan tidak ada kategori fitur yang dibatasi per paket, hanya angka. Publish/tulis anggaran ke platform ditutup gate S1 (G1), bukan oleh paket. Pembayaran: sandbox saja tanpa env (G2). |
| Pendaftaran/onboarding | `/register` terbuka untuk siapa pun (tidak ada penutup/undangan; temuan T3): batas 10 tenant hanya aturan operasional. Pembatas daftar 5/jam/IP di memori per instance. Alur: daftar, email konfirmasi, `/onboarding`. Tanpa email konfirmasi tiba, alur berhenti (G4). Demo publik dibatasi per IP (`app/api/demo/start/route.ts`, `getTrustedClientIp`). Login tanpa pembatas aplikasi (T1, butuh persetujuan auth). |
| Email konfirmasi (SMTP bawaan) | Dampak untuk 10 tenant bila SMTP bawaan: calon tenant non-tim ditolak ("Email address not authorized") atau, untuk anggota tim, hanya 2 email/jam. Pendaftaran gagal total untuk hampir semua undangan, termasuk lupa sandi. Penyelesaian = SMTP kustom di dashboard Supabase (perubahan konfigurasi proyek bersama: butuh persetujuan Founder; pengaruhnya juga ke PUBLOE/UMKMpro, jadi bicarakan dulu). Jika proyek sudah memakai SMTP kustom (mungkin, karena produk lain punya pengguna), G4 hijau; **repo tidak membuktikannya**. |
| Dukungan pelanggan | Satu saluran: email perusahaan `LEGAL.contactEmail` (Gmail umum; mudah ditiru, SOFT_LAUNCH bagian 5). Tidak ada helpdesk/tiket, tidak ada SLA (jangan dijanjikan), tidak ada alat operator untuk melihat tenant (Admin Center = data demo). Cukup untuk 10 tenant bila Founder membaca kotak masuk dua kali sehari. |

### A3. Keputusan

**HOLD untuk mengundang tenant eksternal saat ini. Kode siap (CODE READY); operasi belum.**
Bila semua syarat di bawah selesai dengan bukti tertulis: **GO WITH RESTRICTIONS** (10 tenant, undangan pribadi, gratis, tanpa iklan nyata, tanpa pembayaran, bertahap sesuai bagian C8).

Syarat tersisa (urutan kerja):

| # | Syarat | Jenis | Langkah |
|---|---|---|---|
| 1 | G4: email konfirmasi tiba di alamat non-tim (jika gagal, SMTP kustom dulu) | WAJIB, blocker | C5 |
| 2 | G3: migrasi S1 tercatat di ledger (tiga versi) | WAJIB | C4 |
| 3 | G5: batas biaya AI terpasang | WAJIB | C1 |
| 4 | G6: kontak eskalasi diisi (tanpa data pribadi di repo publik) | WAJIB | C3 |
| 5 | G7: UptimeRobot aktif dan alert uji sampai ke HP | WAJIB | C2 |
| 6 | G2/G11: env `PAYMENT_LIVE_ENABLED`, `ADMIN_CENTER_ENABLED` kosong (lihat saja) | WAJIB | C6 |
| 7 | G12: smoke test di produksi | WAJIB | `SMOKE_TEST_CHECKLIST.md` |
| 8 | G8: status backup tercatat, RPO/RTO diisi, rencana unduh/ekspor | WAJIB (persetujuan eksplisit untuk membuka halaman `umkmpro-ai`) | `BACKUP_RESTORE.md` bagian 1-2 |
| 9 | G9: keputusan jalur PSE tertulis (tunda undangan atau risiko sadar) | WAJIB sebelum pengguna eksternal | `LEGAL_PSE_CHECKLIST.md` |
| 10 | G10: tanggal berlaku halaman hukum | Disarankan | keputusan Founder |
| 11 | Disarankan: PR #127 (`/api/ready`) setelah ditinjau; pembatas login; penutup pendaftaran; error tracker | Opsional | butuh persetujuan (menyentuh `proxy.ts`/auth/env) |

Tidak ada langkah di bagian C yang mengubah apa pun. Setiap langkah berlaku aturan: **jika hasil berbeda dari yang diharapkan: STOP dan kabari** (tulis apa yang terlihat; jangan memperbaiki sendiri).

---

## Bagian B. Aturan sebelum mulai

1. Hanya LIHAT. Jangan tekan tombol berlabel Edit, Save, Delete, Restore, Pause, Reveal, Rotate, Add, Deploy, Publish, Upgrade.
2. Proyek Supabase **`umkmpro-ai` dipakai bersama PUBLOE, MITAPENG, UMKMpro**. Sebelum membaca apa pun, cek nama proyek di bagian atas halaman; bila bukan `umkmpro-ai`/bukan yang dimaksud, tutup halaman.
3. Jangan membuka SQL Editor, Table Editor (data pelanggan), Authentication > Users, atau Settings Supabase kecuali langkah ini menyebutnya. Jangan tangkap layar yang memuat email pelanggan, kunci, atau token.
4. Jangan menempel kunci/sandi/nomor pribadi ke chat, GitHub, atau dokumen repo (repo publik).
5. Nama menu dashboard bisa berbeda dari tulisan di sini. Menu yang tidak terverifikasi ditandai **[BELUM TERVERIFIKASI]**: ikuti label yang tampil, jangan menebak tombol.
6. Catat hasil tiap langkah di catatan pribadi Founder: tanggal, jam WIB, hasil, "sesuai/berbeda".

---

## Bagian C. Langkah Founder dari HP

### C1. Batas biaya AI (G5)

Penyedia yang dipakai kode: OpenAI dan/atau Anthropic (`lib/ai/openai-provider.ts`, `lib/ai/anthropic-provider.ts`; `lib/env.ts`: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `AI_DEFAULT_PROVIDER`). Penyedia mana yang aktif di produksi tidak diketahui dari repo.

**C1.0 Tentukan penyedia aktif (hanya lihat).**
- Buka: Netlify > situs LINOE > pengaturan situs > Environment variables **[nama menu BELUM TERVERIFIKASI; dokumentasi Netlify tidak terjangkau 2026-11-11]**.
- Cari: apakah ada nama `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `AI_DEFAULT_PROVIDER` (nama saja; jangan tampilkan nilai).
- Diharapkan: minimal satu kunci ada. Tidak ada kunci = AI tampil "belum dikonfigurasi" dan G5 tidak relevan (tetapi smoke test AI akan gagal).
- Jika berbeda (misalnya kunci dipakai bersama produk lain di akun penyedia yang sama): STOP dan kabari, karena batas tingkat organisasi bisa ikut menghentikan produk lain.

**C1.1 OpenAI** (sumber: https://developers.openai.com/api/docs/guides/spend-limits, diakses 2026-11-11; **terverifikasi dari dokumentasi, belum dicoba di akun**)
1. Buka https://platform.openai.com/settings/organization/limits (organisasi) atau Project settings > **Limits** (proyek).
2. Di bagian **Spend**, pilih **Edit spend limit**, isi **Monthly spend limit**.
3. Aktifkan **Enforce a hard limit** (tanpa ini hanya alert; alert tidak menghentikan lalu lintas). Simpan.
4. Diharapkan: setelah batas tercapai, permintaan gagal dengan 429 `organization_spend_limit_exceeded`/`project_spend_limit_exceeded`; penegakan tidak seketika, jadi pengeluaran dapat sedikit melebihi angka.
5. Utamakan batas **proyek** khusus LINOE bila kunci LINOE ada di proyek sendiri; batas organisasi menghentikan SEMUA proyek di organisasi itu. Menu alert (ambang notifikasi) tidak dijelaskan dokumen: **[BELUM TERVERIFIKASI]**, cari di Limits.
6. Jika berbeda (tidak ada menu Limits, tidak ada hard limit, tidak punya izin): STOP dan kabari.

**C1.2 Anthropic** (sumber: https://platform.claude.com/docs/en/manage-claude/workspaces.md, diakses 2026-11-11; **terverifikasi dari dokumentasi, belum dicoba di akun**)
1. Buka https://platform.claude.com/settings/workspaces, pilih workspace yang memiliki kunci LINOE.
2. Pada panel yang terbuka, klik **Spend limits**: batasi pengeluaran bulanan dan atur alert ambang.
3. Catatan dokumen: batas workspace tidak boleh melebihi batas organisasi; **spend limit tidak bisa dipasang pada Default Workspace**. Bila kunci LINOE ada di Default Workspace, memindahkannya butuh kunci baru di Netlify (perubahan env: butuh persetujuan Founder). Langkah ini jangan dilakukan sendiri: STOP dan kabari.
4. Menu batas tingkat organisasi di Console: **[BELUM TERVERIFIKASI]**.
5. Hard stop atau hanya alert pada batas Anthropic: dokumen yang saya baca menyebut "cap monthly spending"; perilaku tepat saat tercapai **[BELUM TERVERIFIKASI]**. Uji dengan batas kecil di lingkungan uji bila perlu.

**C1.3 Besaran batas.** Tidak ada data biaya per panggilan di database (`estimated_cost` belum diisi). Jangan mengarang angka: pilih batas awal kecil yang rela Anda bayar, lalu naikkan berdasarkan pemakaian nyata minggu pertama. Catat angka dan tanggal. Pantau harian di dashboard penyedia selama 2 minggu.

### C2. UptimeRobot (G7)

Sumber paket: https://uptimerobot.com/pricing/?no_head=1 (diakses 2026-11-11): Free 50 monitor, interval 5 menit, untuk proyek pribadi dan komersial, tanpa kartu kredit; SMS/telepon berbayar terpisah. Keterangan email/push pada paket Free tidak tegas di halaman itu: **[BELUM TERVERIFIKASI]**.

1. Buka https://uptimerobot.com di browser HP, daftar dengan email perusahaan (paket Free). Pasang aplikasi UptimeRobot Android bila tersedia untuk notifikasi push **[BELUM TERVERIFIKASI untuk paket Free]**.
2. Add New Monitor, tiga entri (ganti `<domain-produksi>` dengan domain produksi LINOE; jangan pantau URL preview):

| Nama | Tipe | URL | Kata kunci | Interval | Alert |
|---|---|---|---|---|---|
| LINOE hidup | HTTP(s) | `https://<domain-produksi>/api/health` | n/a | 5 menit | email + push |
| LINOE login | Keyword | `https://<domain-produksi>/login` | `Masuk` (alert bila TIDAK ada) | 5 menit | email + push |
| LINOE siap | HTTP(s) | `https://<domain-produksi>/api/ready` | n/a | 5 menit | email + push |

   - Kata kunci `Masuk` terbukti ada di halaman: judul `Masuk — LINOE` dan kartu `Masuk ke akun Anda` (`app/(auth)/login/page.tsx`, `features/auth/login-form.tsx`).
   - **Monitor ketiga HANYA setelah PR #127 di-merge dan terdeploy.** Di `main` saat ini `/api/ready` belum ada (akan 404/redirect ke login). Jangan pasang sekarang.
3. Uji: buka monitor > jeda lalu aktifkan lagi, atau gunakan uji notifikasi bila ada. Alert harus sampai ke HP dalam 10 menit.
4. Diharapkan: dua monitor hijau (Up). `/api/health` menampilkan `{"status":"ok"}` di browser.
5. Aturan baca alert: satu kegagalan lalu pulih = catat saja; dua pemeriksaan berturut-turut Down (sekitar 10 menit) = ikuti RUNBOOK bagian 1-2.
6. Jika berbeda (monitor merah terus padahal situs terbuka di browser, alert tidak tiba): STOP dan kabari.

### C3. Kontak eskalasi RUNBOOK bagian 4 (G6)

**Peringatan: repo ini publik. Jangan tulis nomor HP pribadi, WhatsApp, atau kata sandi di `docs/RUNBOOK.md`.** (SOFT_LAUNCH G6 menyebut "nomor/email"; untuk repo publik, gunakan rujukan.)

Yang ditulis pada kolom Kontak (satu baris per level), format:

| Level | Isi kolom Kontak (contoh format) |
|---|---|
| 1 Operator/pemantau | `Peran: Founder (merangkap operator). Saluran: email perusahaan (alamat sama dengan halaman Syarat) + notifikasi UptimeRobot. Jam siaga: 08.00-21.00 WIB. Rincian pribadi: di catatan pribadi "LINOE-ESKALASI".` |
| 2 Founder | `Saluran utama: telepon/WhatsApp (nomor di catatan pribadi "LINOE-ESKALASI", bukan di repo). Cadangan: email perusahaan. Batas tunggu: 15 menit sebelum mencoba saluran cadangan.` |

Isi catatan pribadi (di HP, bukan repo): nama dan saluran Level 1, Level 2, satu orang cadangan tepercaya bila ada, nomor tiket/akun dukungan Netlify dan Supabase (ID akun, bukan kata sandi), jam siaga.
Cara mengisi dari HP: GitHub (browser) > repo > `docs/RUNBOOK.md` > ikon pensil (Edit) > ganti `(isi)` > ajukan sebagai Pull Request. Merge/komit ke `main` hanya atas persetujuan Founder sendiri; jangan mengomit langsung bila Anda ingin ditinjau.
Diharapkan: tidak ada kolom `(isi)` tersisa di bagian 4, dan tidak ada angka telepon pribadi di berkas.
Jika berbeda (Founder satu-satunya orang): tulis jujur "Level 1 = Level 2 = Founder"; jangan mengarang operator.

### C4. Periksa status migrasi S1 dari HP (G3), hanya baca

Tujuan: memastikan tiga versi S1 tercatat di riwayat migrasi proyek produksi. Berkas ada di repo bukan bukti diterapkan.

Nama yang dicari (versi dan nama persis dari `docs/S1_MIGRATION_WRAPPER.md`):

| Versi | Nama |
|---|---|
| `20261019100000` | `prompter_p0_ai_jobs_lockdown` |
| `20261019100100` | `prompter_p0_subscription_trial_insert_guard` |
| `20261019100200` | `prompter_p0_plan_entitlements_lockdown` |

Langkah (Chrome Android; bila layar sempit aktifkan "Situs desktop" di menu Chrome):
1. Buka https://supabase.com/dashboard dan masuk.
2. Pilih organisasi, lalu proyek **`umkmpro-ai`**. **Periksa nama proyek di bagian atas sebelum lanjut.** Ini proyek BERSAMA dengan PUBLOE/MITAPENG/UMKMpro: hanya membaca.
3. Menu kiri **Database** > **Migrations** **[BELUM TERVERIFIKASI: dokumentasi Supabase tidak terjangkau 2026-11-11; label bisa berbeda]**. Di halaman itu hanya ada daftar versi dan nama; gulir dan baca.
4. Cari tiga versi di atas. Diharapkan: ketiganya ada, versi dan nama sama persis.
5. Jangan menekan tombol apa pun selain menggulir. Jangan buka SQL Editor, Backups, Restore, atau Settings.
6. Catat: tiga baris "ada/tidak ada", tanggal dan jam pemeriksaan.
7. **Batas bukti:** daftar ini menunjukkan versi tercatat di ledger, bukan bahwa hak akses dan trigger benar-benar efektif. Bukti efektif (hak akses, trigger) hanya didapat lewat pemeriksaan katalog baca-saja oleh Claude di sesi cloud; itu butuh persetujuan Founder tertulis (contoh frasa: `APPROVE READ-S1-<tanggal>`). Minta bila tiga versi ada.
8. Jika berbeda (salah satu hilang, atau nama berbeda, atau Anda tidak menemukan menu): STOP. Jangan menerapkan migrasi apa pun dari dashboard; kabari (S1 hanya boleh lewat wrapper dengan persetujuan per berkas, `S1_MIGRATION_WRAPPER.md`). Selama G3 belum terbukti, jangan undang tenant.

### C5. Email konfirmasi sampai ke alamat non-tim (G4)

Sumber (https://supabase.com/docs/guides/auth/auth-smtp, diakses 2026-11-11): SMTP bawaan menolak mengirim ke alamat yang bukan anggota tim proyek (error "Email address not authorized"), batas 2 pesan per jam, tanpa jaminan pengiriman, "tidak untuk produksi".

1. Siapkan alamat email **biasa yang bukan anggota tim Supabase** dan bisa dibuka di HP (misalnya Gmail pribadi lain). Gunakan mode penyamaran.
2. Buka `https://<domain-produksi>/register`, daftar dengan alamat itu, centang Syarat/Privasi.
3. Diharapkan: muncul pesan "Akun berhasil dibuat. Silakan cek email Anda..."; email dari LINOE tiba dalam 2 menit (cek spam); tautan membuka `/onboarding`, bukan error.
4. Catat: jam daftar, jam email tiba, masuk inbox atau spam, ada tidaknya pesan error.
5. Catatan: ini membuat akun nyata di proyek bersama (akan dihitung sebagai salah satu dari 10 tenant, atau sebagai akun uji Anda). Menghapusnya butuh persetujuan (SOFT_LAUNCH bagian 7); jangan mendaftar berulang-ulang (batas 2/jam bila SMTP bawaan).
6. Jika berbeda (pesan error di layar, email tidak tiba dalam 10 menit, masuk spam): STOP dan kabari. Jangan daftar ulang berkali-kali. Perbaikannya (SMTP kustom) adalah perubahan konfigurasi proyek bersama yang butuh persetujuan; batas tenant tetap NO-GO sampai lulus.

### C6. Cek env Netlify (G2, G11), hanya melihat

1. Buka Netlify (browser atau aplikasi) > situs LINOE > Environment variables **[nama menu BELUM TERVERIFIKASI]**.
2. Cari nama berikut dan catat statusnya tanpa mengungkap nilai rahasia:

| Variabel | Diharapkan |
|---|---|
| `PAYMENT_LIVE_ENABLED` | Tidak ada atau kosong. (Hanya persis `true` yang mengaktifkan live, dan itu pun butuh `PAYMENT_PROVIDER_ENV=production`.) |
| `PAYMENT_PROVIDER_ENV` | Tidak ada atau `sandbox`. Bukan `production`. |
| `ADMIN_CENTER_ENABLED` | Tidak ada atau kosong. Bukan `true`. |
| `DEMO_SESSION_SECRET` | Catat saja ada/tidak. Ada = demo publik aktif (menggunakan AI nyata bila kunci AI ada). Mengosongkannya = keputusan Founder terpisah. |

3. Jangan tekan Reveal/Edit/Delete/Add pada variabel mana pun.
4. Jika berbeda (`PAYMENT_LIVE_ENABLED` = `true`, `ADMIN_CENTER_ENABLED` = `true`, atau `PAYMENT_PROVIDER_ENV` = `production`): STOP dan kabari segera. Jangan mengubahnya sendiri; ini insiden Sev 1 bila pembayaran riil menyala tanpa izin (SOFT_LAUNCH bagian 6).

### C7. Smoke test produksi (G12)

Jalankan `docs/SMOKE_TEST_CHECKLIST.md` dari HP setelah C4-C6 hijau. Hasil dicatat (tanggal, deploy ID). Satu baris gagal = berhenti dan lihat RUNBOOK. Langkah register di C5 dapat dipakai sebagai bagian 1-2 smoke test.

### C8. Rencana undangan 10 tenant bertahap

Prasyarat gelombang 1: syarat 1-9 di A3 selesai dan tertulis. Aturan semua gelombang: undangan pribadi dari email perusahaan; jangan sebar URL `/register` di kanal publik (pendaftaran terbuka, T3); jangan minta tenant menghubungkan Meta/TikTok/X; ingatkan "iklan tidak tayang otomatis, pembayaran belum aktif"; satu akun per orang/usaha.

| Gelombang | Jumlah (kumulatif) | Waktu | Syarat lanjut ke gelombang berikutnya |
|---|---|---|---|
| 1 | 3 tenant dekat/tepercaya | Hari 0 | Setelah 3 hari: semua email konfirmasi tiba; masing-masing sukses 1 pemakaian AI; tidak ada error yang berulang; UptimeRobot tidak ada Down > 10 menit; biaya AI di bawah batas yang Anda pasang; tidak ada akun tak diundang |
| 2 | +4 = 7 | Hari 4-5 | Setelah 4 hari tambahan: kriteria sama; keluhan dukungan terjawab dalam 1 hari kerja; tidak ada Sev 1/2 |
| 3 | +3 = 10 | Hari 9-10 | Berhenti di 10. Tenant ke-11 hanya setelah P1 di SOFT_LAUNCH bagian 10 ditinjau |

Rutinitas harian 10 menit (SOFT_LAUNCH bagian 8): (1) UptimeRobot hijau; (2) deploy Netlify terakhir hijau; (3) jumlah tenant tidak melebihi undangan; (4) pemakaian AI/biaya wajar; (5) kotak dukungan.
Menghitung tenant: cara paling aman bagi proyek bersama adalah meminta Claude membuat ringkasan baca-saja jumlah tenant dengan persetujuan tertulis (contoh frasa: `APPROVE READ-TENANT-<tanggal>`), bukan menjelajah dashboard Supabase sendiri.

**Hentikan undangan (STOP dan kabari)** bila: email konfirmasi tidak tiba pada tenant mana pun; ada akun yang tidak Anda undang; biaya AI mendekati batas; muncul dugaan data tenant terlihat tenant lain (Sev 1, ikuti SOFT_LAUNCH bagian 6); pembayaran atau iklan berjalan tanpa izin.

---

## Bagian D. Sumber dan batas verifikasi (diakses 2026-11-11)

| # | Klaim | Sumber | Status |
|---|---|---|---|
| D1 | SMTP bawaan Supabase: hanya anggota tim, 2 pesan/jam, tidak untuk produksi | https://supabase.com/docs/guides/auth/auth-smtp | Terverifikasi (dibaca langsung) |
| D2 | OpenAI spend limit org/proyek, hard limit, 429, alert tidak menghentikan | https://developers.openai.com/api/docs/guides/spend-limits | Terverifikasi dari dokumentasi; belum dicoba di akun |
| D3 | Anthropic spend limit per workspace, tidak untuk Default Workspace | https://platform.claude.com/docs/en/manage-claude/workspaces.md | Terverifikasi dari dokumentasi; perilaku tepat saat tercapai belum terverifikasi |
| D4 | UptimeRobot Free: 50 monitor, 5 menit, komersial boleh, SMS berbayar | https://uptimerobot.com/pricing/?no_head=1 | Terverifikasi; email/push khusus Free belum tegas |
| D5 | Menu Supabase Database > Migrations; menu Netlify Environment variables | dokumentasi Supabase/Netlify tidak terjangkau dari lingkungan ini | **BELUM TERVERIFIKASI** |
| D6 | Status "S1 sudah di production" | `docs/AI_JOBS_QUOTA_GUARD.md` (pembacaan katalog 2026-11-07) | Klaim dokumen; tidak diperiksa ulang (tanpa query database) |

Dokumen ini tidak menyatakan E2E. Tidak ada panggilan ke database, MCP, platform iklan, atau penyedia pembayaran.
