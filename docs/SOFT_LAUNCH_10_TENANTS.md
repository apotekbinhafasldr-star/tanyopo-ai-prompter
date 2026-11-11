# Soft launch maksimal 10 tenant pertama (keamanan, operasi, peluncuran)

Status: **DOKUMEN (Draft)**. Tidak ada perubahan database, env, Netlify, billing, auth, proxy, atau pengajuan ke otoritas.
Tanggal audit kode: 2026-11-11 (commit `origin/main` 7880ea3). Tidak ada tes beban ke produksi.
Semua langkah untuk Founder bisa dilakukan dari HP (browser, aplikasi email, dashboard web).
Dokumen terkait (tidak diulang di sini): [BACKUP_RESTORE.md dan tests/load di Draft PR #116](https://github.com/apotekbinhafasldr-star/tanyopo-ai-prompter/pull/116),
[RUNBOOK.md](RUNBOOK.md), [S1_TRIAL_AI_QUOTA.md](S1_TRIAL_AI_QUOTA.md), [GO_LIVE_PAYMENTS.md](GO_LIVE_PAYMENTS.md),
[SMOKE_TEST_CHECKLIST.md](SMOKE_TEST_CHECKLIST.md), [REFUND_RUNBOOK.md](REFUND_RUNBOOK.md), dan sisi hukum di
[LEGAL_PSE_CHECKLIST.md](LEGAL_PSE_CHECKLIST.md). Ini bukan nasihat hukum.

Label status mengikuti aturan tim: CODE READY / UNIT TEST PASS / MOCK E2E PASS / SANDBOX E2E PASS / REAL E2E PASS / CUSTOMER READY.
Posisi saat ini: **CODE READY untuk soft launch gratis dengan syarat di bagian 2; belum CUSTOMER READY** (belum ada REAL E2E, pembayaran riil OFF).

---

## 1. Keputusan ringkas

**GO bersyarat** untuk 10 tenant undangan, **gratis (trial 14 hari)**, **tanpa pembayaran riil**, **tanpa publish iklan**,
bila semua item bertanda **WAJIB** di bagian 2 hijau. Bila satu WAJIB merah: **NO-GO** untuk mengundang tenant.

Alasan batas 10 tenant: tidak ada alat pelacak error, tidak ada batas pendaftaran di kode, pembatas laju hanya di memori,
penghapusan data masih manual, dan lembaga/proses hukum (PSE, PDP) belum selesai. Skala kecil membuat risiko itu bisa ditangani manual.

## 2. Checklist go/no-go

Legenda bukti: **K** = terbukti dari kode/tes di repo (2026-11-11). **D** = klaim dokumen repo, belum diperiksa ulang ke sistem hidup.
**F** = hanya Founder yang bisa memastikan (dashboard/akun).

| # | Item | WAJIB | Status | Bukti / catatan |
|---|---|---|---|---|
| G1 | Gate S1: `BUDGET_WRITE_ENABLED_PLATFORMS` kosong, tulis anggaran ke platform ditolak (default deny) | WAJIB | **PASS (K)** | `lib/campaigns/external-budget-guard.ts` (konstanta beku, kosong); `tests/unit/lib/external-budget-guard.test.ts`, `budget-write-callsites.test.ts`; tes drift di `tests/unit/docs/soft-launch-docs.test.ts` |
| G2 | Pembayaran riil OFF: `PAYMENT_LIVE_ENABLED` kosong | WAJIB | **PASS di kode (K); nilai env produksi (F)** | `lib/billing/providers/midtrans-payment-provider.ts`, `doku-payment-provider.ts` (tanpa flag = sandbox saja / tanpa mode live). Founder cek Netlify env: variabel kosong |
| G3 | Migrasi S1 (trial dikunci server, kuota AI tidak bisa direset) sudah aktif di database | WAJIB | **PERLU KONFIRMASI (D)** | `docs/AI_JOBS_QUOTA_GUARD.md` menyatakan "S1 sudah di production" berdasarkan pembacaan katalog 2026-11-07. Konfirmasi ulang read-only sebelum undangan pertama (minta Claude, perlu persetujuan Founder untuk sesi baca) |
| G4 | Email konfirmasi pendaftaran sampai ke alamat tenant (bukan hanya tim) | WAJIB | **PERLU KONFIRMASI (F)** | Repo tidak mencatat SMTP kustom. SMTP bawaan Supabase hanya mengirim ke anggota tim proyek dan dibatasi 2 email/jam ([Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [Rate limits](https://supabase.com/docs/guides/auth/rate-limits), diakses 2026-11-11). Uji: daftar dengan Gmail non-tim, email harus tiba < 2 menit (SMOKE_TEST bagian 1) |
| G5 | Batas biaya AI di dashboard OpenAI/Anthropic (hard limit bulanan kecil) | WAJIB | **PERLU KONFIRMASI (F)** | Kode membatasi per tenant (30 AI/trial) dan per sesi demo (5), tetapi sesi demo tak terbatas dan pendaftaran terbuka (lihat temuan T2, T3). Batas di penyedia adalah pagar terakhir. Nama menu berbeda per penyedia; tidak diverifikasi di sini |
| G6 | Kontak eskalasi `docs/RUNBOOK.md` bagian 4 diisi (kolom "(isi)" masih kosong) | WAJIB | **BELUM** | Founder isi nomor/email Level 1 dan 2 lewat edit file di GitHub dari HP. Jangan tulis sandi |
| G7 | Pemantau uptime aktif (UptimeRobot, RUNBOOK bagian 5) dengan alert ke HP | WAJIB | **BELUM (F)** | Lihat bagian 8 |
| G8 | Backup/restore: rujuk Draft PR #116 (`docs/BACKUP_RESTORE.md`). Rencana unduh cadangan sebelum undangan | WAJIB | **Mengikuti PR #116** | Paket Supabase menentukan ada tidaknya backup harian ([Supabase backups](https://supabase.com/docs/guides/platform/backups), diakses 2026-11-11: harian hanya Pro/Team/Enterprise; Free diminta ekspor sendiri). Proyek `umkmpro-ai` dibagi dengan aplikasi lain |
| G9 | Syarat PSE Lingkup Privat (TDPSE) | WAJIB sebelum pengguna eksternal | **BELUM / PERLU KONFIRMASI** | PP 71/2019 Pasal 6 ayat (2): daftar sebelum sistem dipakai pengguna. Lihat [LEGAL_PSE_CHECKLIST.md](LEGAL_PSE_CHECKLIST.md). Keputusan Founder: tunda undangan sampai TDPSE terbit, atau ambil risiko sadar dengan konsultan |
| G10 | Halaman `/privacy`, `/terms`, `/data-deletion`, `/refund` terbuka tanpa login dan tanggal berlaku diisi | WAJIB | **Sebagian** | Halaman terbuka (K, `proxy.ts` PUBLIC_PATHS). `LEGAL.effectiveDate` masih kosong (`features/legal/legal-meta.ts`); diisi hanya saat Founder menyetujui publikasi |
| G11 | `ADMIN_CENTER_ENABLED` kosong | WAJIB | **PASS di kode (K); env (F)** | Admin Center hanya data DEMO fiktif (`docs/ADMIN_CENTER.md`). Jangan dinyalakan untuk operasi nyata |
| G12 | Smoke test penuh hijau di produksi (login, onboarding, AI, trial) | WAJIB | **BELUM** | `docs/SMOKE_TEST_CHECKLIST.md`, dikerjakan Founder di HP |
| G13 | Tidak ada tenant diminta menghubungkan akun Meta/TikTok/X | WAJIB (aturan operasional) | **Aturan** | Status review aplikasi di platform tidak terverifikasi (EXTERNAL BLOCKED bila belum disetujui). Gate S1 sudah menolak tulis anggaran; tetap jangan ambil token pihak ketiga selama soft launch |
| G14 | PUBLOE, MITAPENG, UMKMpro tidak disentuh; proyek Supabase `umkmpro-ai` bersama | WAJIB | **Aturan** | Tidak ada perubahan database dalam PR ini |
| G15 | Penerapan #48 (guard kuota AI: peran + validasi input) | Disarankan | **BELUM diterapkan (D)** | Tenant trial hanya 1 pengguna (`maxUsers: 1`), sehingga risiko peran rendah. Lihat P1-5 |
| G16 | Error tracker | Disarankan | **TIDAK ADA** | Hanya `console.error` di `app/error.tsx` dan `app/global-error.tsx`. Lihat P1-4 dan bagian 8 |

## 3. Batas soft launch

**Tenant:** maksimal 10, dipilih Founder satu per satu (undangan pribadi). Tidak ada penghitung atau penutup pendaftaran di kode
(temuan T3): `/register` tetap terbuka bagi siapa pun yang tahu URL. Jangan promosikan URL, jangan pasang iklan, jangan
posting tautan daftar di kanal publik. Hitung tenant baru setiap hari (bagian 8). Bila lebih dari 10 akun muncul tanpa undangan,
perlakukan sebagai insiden (bagian 6, Sev 3).

**Kuota trial per tenant** (sumber: `lib/billing/plans.ts`, tier FREE; dijaga tes drift terhadap dokumen ini):
**14 hari**, **30 penggunaan AI**, **3 produk aktif**, **2 kampanye aktif**, **1 pengguna**.
Setelah 14 hari AI dan jalur berbayar ditolak (`TRIAL_EXPIRED`, migrasi `20260924173424`). Tidak ada perpanjangan di kode;
perpanjangan manual hanya dengan persetujuan Founder dan SQL yang ditinjau (bukan dari dashboard Supabase bebas).

**Fitur yang tidak dipakai / dimatikan selama soft launch:**
- Publish iklan dan tulis anggaran ke Meta/TikTok/X: **terkunci** oleh gate S1 (default deny). Jangan ubah.
- Autopilot: default `manual`; jangan diaktifkan untuk tenant. Emergency Stop tetap tersedia.
- Koneksi akun iklan: tidak diminta (G13).
- Pembayaran/checkout: tidak ada tagihan riil. Halaman Billing masih sandbox; beri tahu tenant jangan membayar apa pun di sana.
- Admin Center: OFF (data demo).
- Demo publik: boleh, dengan pembatas per IP pada pembuatan sesi (P0-1, diimplementasikan di PR ini). Bila ingin nol risiko biaya
  AI dari demo, Founder dapat mengosongkan `DEMO_SESSION_SECRET` di Netlify (demo menjawab "tidak tersedia"); itu perubahan env, perlu persetujuan.
- UMKMpro bundle / paket berbayar: tidak ditawarkan.

**Pembayaran:** semua tenant gratis. Jangan menerima transfer manual untuk LINOE selama soft launch tanpa konsultan pajak/hukum
(PERLU KONFIRMASI: pencatatan pendapatan, faktur, PPN; model bayar iklan tetap langsung ke platform oleh pelanggan, sesuai keputusan Founder).
Bila nanti berbayar: ikuti GO_LIVE_PAYMENTS.md dan persetujuan eksplisit; status PJP di LEGAL_PSE_CHECKLIST.md.

## 4. Onboarding tenant (per tenant, dari HP)

1. Pilih calon tenant, catat di spreadsheet Founder (nama usaha, kontak, tanggal undang, status). Simpan data seminimal mungkin.
2. Kirim email undangan resmi (email perusahaan) berisi: tautan `/register`, tautan `/terms` dan `/privacy`, batas trial (bagian 3),
   penegasan "iklan tidak ditayangkan otomatis, pembayaran belum aktif", dan alamat dukungan.
3. Tenant daftar, memverifikasi email, mengisi `/onboarding`. Pastikan kotak setuju Syarat/Privasi dicentang (wajib di form).
4. Dalam 24 jam Founder cek: tenant muncul (bagian 8), trial 14 hari tercatat, satu penggunaan AI berhasil.
5. Hari ke-7 dan hari ke-12: email singkat menanyakan kendala, mengingatkan trial berakhir.
6. Hari ke-14: trial berakhir. Tanyakan keputusan; data tidak dihapus otomatis (lihat bagian 7 bila diminta).
7. Satu akun per orang/usaha. Tolak permintaan akun tambahan untuk memperpanjang trial (Syarat bagian 3 melarangnya).

## 5. Dukungan pelanggan (email)

- Saluran tunggal: email perusahaan di `features/legal/legal-meta.ts` (`LEGAL.contactEmail`). Halaman hukum tidak menjanjikan SLA; jangan menjanjikannya secara lisan.
  Target internal (tidak dipublikasikan): balas dalam 1 hari kerja, selesaikan atau beri rencana dalam 3 hari kerja.
- Label di aplikasi email: `Bug`, `Akun/Login`, `AI`, `Data-Privasi`, `Hukum`, `Lainnya`. `Data-Privasi` dan `Hukum` dibaca Founder sendiri, jangan diteruskan ke pihak lain.
- Verifikasi pengirim sebelum membahas data akun: balasan harus datang dari email akun terdaftar. Jangan pernah meminta kata sandi, token, atau kunci.
- Jangan minta tangkapan layar yang memuat data pelanggan tenant atau kunci API. Minta jam kejadian dan alamat halaman saja.
- Catat setiap kasus: tanggal, tenant, kategori, ringkasan, tindakan. Kasus yang menyangkut data bocor atau akses tak sah langsung ke SOP bagian 6.
- Alamat dukungan saat ini adalah alamat email umum perusahaan, sehingga mudah ditiru. Cantumkan di balasan bahwa Anda tidak pernah meminta sandi.

## 6. SOP insiden

### 6.1 Tingkat keparahan

| Sev | Contoh | Respons |
|---|---|---|
| 1 | Dugaan data tenant terlihat tenant lain; token/kunci bocor; akun admin disusupi; pembayaran riil/iklan berjalan tanpa izin | Mulai segera, jam berjalan (6.3) |
| 2 | Aplikasi mati > 15 menit; login massal gagal; email terkirim ke orang salah | Jalankan RUNBOOK bagian 1-2 dan 6; eskalasi Founder |
| 3 | Lonjakan pendaftaran/AI tak wajar; bug satu tenant; permintaan data pribadi | Catat dan tangani hari kerja |

### 6.2 Langkah (semua Sev)
1. **Catat jam temuan** (zona waktu WIB) dan siapa yang menemukan. Ini titik awal semua tenggat.
2. **Batasi**: rollback deploy di Netlify (RUNBOOK bagian 2) bila bermula dari deploy; matikan fitur lewat flag/env hanya dengan persetujuan Founder.
   Cabut kunci yang diduga bocor di dashboard penyedia (kunci lama dicabut dulu, kunci baru diberikan ke Netlify oleh Founder).
3. **Amankan bukti**: tangkapan layar log Netlify (Logs > Functions), halaman status penyedia, jam, tenant terdampak. Jangan menghapus log atau data.
4. **Ukur dampak**: data apa (kategori), tenant mana, berapa subjek, kapan mulai, bagaimana terjadi, apakah masih berlangsung.
5. **Eskalasi**: Founder (RUNBOOK bagian 4). Sev 1: libatkan konsultan hukum/PDP di hari yang sama (G9, LEGAL_PSE_CHECKLIST).
6. **Pulihkan** sesuai RUNBOOK; jangan menjalankan SQL produksi tanpa persetujuan Founder (proyek bersama dengan aplikasi lain).
7. **Tinjau**: dalam 5 hari kerja tulis ringkasan (apa, sebab, perbaikan, siapa diberi tahu). Simpan.

### 6.3 Notifikasi kegagalan pelindungan data pribadi (3 x 24 jam)

Dasar: UU 27/2022 Pasal 46 ayat (1): dalam hal terjadi kegagalan pelindungan data pribadi, pengendali wajib menyampaikan
pemberitahuan tertulis **paling lambat 3 x 24 jam** kepada (a) subjek data pribadi dan (b) lembaga. Ayat (2): minimal memuat data pribadi
yang terungkap; kapan dan bagaimana terungkap; upaya penanganan dan pemulihan. Ayat (3): dalam hal tertentu, juga memberi tahu masyarakat.
Status verifikasi: teks dikutip dari [pasal.id](https://pasal.id/peraturan/uu/uu-no-27-tahun-2022/pasal-46), diakses 2026-11-11 (sumber sekunder; halaman
resmi peraturan.bpk.go.id tidak terjangkau saat akses). **Cocokkan dengan teks resmi sebelum dipakai.**

**PERLU KONFIRMASI konsultan/otoritas** (jangan diasumsikan):
- Kapan jam mulai: sejak temuan pertama atau sejak kegagalan "pasti, patut, dan wajar" terbukti (ada pemberitaan sekunder tentang PP 33/2026 yang menyebut ini; belum diverifikasi di teks resmi). **Sikap hati-hati: hitung dari jam temuan.**
- Siapa "lembaga" penerima dan saluran penyampaiannya: pemberitaan sekunder 2026 menyebut lembaga PDP belum terbentuk penuh. Tanyakan ke konsultan/Komdigi sebelum insiden nyata.
- Kriteria "kegagalan" (kehilangan, terungkap, akses tanpa izin) dan "hal tertentu" untuk pengumuman publik.
- PP 33/2026 (pelaksana UU PDP): disebut berlaku 16 Januari 2027 oleh sumber sekunder; teks resmi belum terverifikasi.

**Pra-siapkan sekarang (sebelum ada insiden):** draf email pemberitahuan ke tenant (templat di bawah), daftar kontak tenant, dan nama konsultan.

Templat email ke subjek data (isi sesuai ayat 2; kirim dari email perusahaan; jangan sertakan data pribadi lain):

```
Subjek: Pemberitahuan insiden keamanan data LINOE
1. Apa yang terjadi dan data apa yang terungkap: ...
2. Kapan dan bagaimana terungkap: ... (jam WIB)
3. Yang sudah kami lakukan untuk menangani dan memulihkan: ...
4. Yang kami sarankan Anda lakukan (mis. ganti kata sandi): ...
5. Kontak: <email perusahaan>
```

Hitungan tenggat (contoh): temuan Senin 10:00 WIB, batas pemberitahuan Kamis 10:00 WIB (72 jam kalender, bukan hari kerja; konfirmasi cara hitung ke konsultan).
Simpan bukti pengiriman (salinan email, jam) di arsip insiden.

## 7. Prosedur penghapusan data manual

Kondisi nyata: `/data-deletion` adalah halaman proses, **bukan** alat. Tidak ada tombol hapus akun dan tidak ada skrip. Halaman itu sudah menyatakan
penghapusan manual, bertahap, tanpa janji waktu, dan akun login bersama tidak otomatis terhapus. SOP internal di bawah mengisi celahnya.
**Menjalankan SQL/penghapusan di database produksi butuh persetujuan Founder tertulis per permintaan** (contoh frasa: `APPROVE DELETE-<tenant>-<tanggal>`).

1. **Terima** di email dukungan (label `Data-Privasi`). Catat tanggal terima (jam awal; UU PDP juga mengenal tenggat tanggapan hak subjek, PERLU KONFIRMASI nilainya ke konsultan).
2. **Verifikasi**: minta balasan dari email akun terdaftar. Non-Owner hanya boleh meminta data pribadinya sendiri; data bisnis workspace hanya atas permintaan Owner.
3. **Tentukan lingkup** (tabel kategori halaman `/data-deletion`):
   - *Dapat dihapus*: data LINOE satu tenant pada tabel `prompter_*` (produk, media, kampanye, konten, SEO, analitik, pengaturan, koneksi dan token), serta berkas di bucket Storage `product-media` (jalur `{tenantId}/...`).
   - *Dapat dipertahankan*: transaksi, invoice, catatan keamanan/audit bila ada kewajiban hukum atau keuangan (selama soft launch tidak ada transaksi riil; tetap catat alasan).
   - *Dibahas terpisah*: akun login bersama (`auth.users`, `user_profiles`, `tenants`) dipakai produk lain; **jangan disentuh** dari proses ini.
4. **Minta Owner memutus koneksi** Meta/TikTok/X sendiri lebih dulu (menghapus token dan mencoba mencabut di platform) dan mencabut izin di pengaturan platform.
5. **Siapkan rencana penghapusan** oleh Claude di sesi cloud: daftar tabel dengan hitungan baris per tenant (hanya baca), urutan penghapusan menghormati kunci asing, filter `tenant_id` pada setiap perintah, dalam satu transaksi, dengan hitungan sebelum/sesudah. Tidak ada `TRUNCATE`, tidak ada perintah tanpa filter tenant. Tinjau; Founder menyetujui.
6. **Eksekusi** setelah persetujuan; simpan keluaran hitungan sebagai bukti (tanpa isi data).
7. **Kolom teks bebas** (konteks log aktivitas `prompter_audit_logs.context`, `prompter_ai_jobs.input_reference`) dapat memuat data pribadi; tabel audit sengaja append-only. Putuskan per kasus: pertahankan dengan alasan tertulis atau anonimkan manual lewat prosedur yang disetujui. Tidak ada alat anonimisasi otomatis (jujur kepada pemohon).
8. **Cadangan** dapat masih memuat data sampai diganti (sesuai halaman publik); catat tanggal cadangan terlama yang memuat data tersebut (lihat BACKUP_RESTORE.md di PR #116).
9. **Beri tahu hasil** tertulis: apa dihapus, dianonimkan, dipertahankan beserta alasan, dan batasan (pihak ketiga: penyedia AI, hosting, email).
10. **Catat** di arsip: tanggal terima, verifikasi, persetujuan, hitungan, tanggal balasan. Jangan simpan data yang dihapus di arsip.

Celah yang perlu keputusan (bukan diperbaiki di PR ini): tidak ada fungsi database penghapusan per tenant (butuh migrasi, P1-7), dan penghapusan akun login bersama butuh keputusan lintas produk.

## 8. Pemantauan minimum dari HP

Kenyataan: `/api/health` hanya liveness `{"status":"ok"}` (tidak mengecek database), tidak ada error tracker, log hanya `console.error` di Netlify.

| Apa | Cara (HP) | Kapan |
|---|---|---|
| App hidup | UptimeRobot monitor HTTP `/api/health` interval 5 menit, alert push + email (RUNBOOK bagian 5) | Terus-menerus |
| Halaman nyata hidup (bukan sekadar proses) | Monitor ke-2 tipe Keyword di `/login`, kata kunci "Masuk" (publik, tanpa login). Ini menangkap layar putih yang tidak tertangkap health | Terus-menerus |
| Deploy gagal/berhasil | Notifikasi deploy Netlify ke email (nama menu bisa berbeda; tidak diverifikasi) | Tiap deploy |
| Error runtime | Netlify > Logs > Functions, cari "error". Retensi log tidak diverifikasi (PERLU KONFIRMASI); tangkap layar saat insiden | Harian 5 menit |
| Supabase sehat | status.supabase.com + dashboard proyek (hanya lihat, jangan ubah; proyek bersama) | Harian |
| Jumlah tenant dan pemakaian | Supabase Table Editor, tabel `prompter_subscriptions` dan `prompter_ai_jobs`, mode **lihat saja**; atau minta Claude membuat ringkasan read-only (perlu persetujuan sesi) | Harian selama 2 minggu pertama |
| Biaya AI | Dashboard OpenAI/Anthropic: pemakaian harian dan batas bulanan (G5) | Harian |
| Pembayaran | `/ops/payments` (hanya relevan bila pembayaran diaktifkan; OFF saat soft launch) | n/a |
| Kotak dukungan | Aplikasi email, filter label | Dua kali sehari |

Rutinitas harian 10 menit: (1) UptimeRobot hijau; (2) Netlify deploy terakhir hijau; (3) tenant baru <= 10 dan sesuai undangan;
(4) pemakaian AI wajar; (5) kotak dukungan. Temuan tidak wajar = bagian 6.

Batas pemantauan ini: tidak ada pelacak error per pengguna, tidak ada alert otomatis untuk lonjakan pendaftaran atau AI. Jangan klaim "terpantau penuh".

## 9. Temuan audit ringkas (kode terbaru, fokus celah)

Tidak diulang: audit RLS/isolasi tenant yang sudah PASS (docs/SECURITY.md, tes SQL S1) dan backup/load test (PR #116).

| ID | Temuan | Dampak soft launch | Bukti |
|---|---|---|---|
| T1 | **Login tanpa pembatas aplikasi**. `loginAction` langsung `signInWithPassword`; pendaftaran dan OTP punya pembatas, login tidak. Hanya batas bawaan Supabase (150 token/5 menit/IP, [sumber](https://supabase.com/docs/guides/auth/rate-limits), 2026-11-11) | Sedang: tebak sandi per akun tidak dibatasi aplikasi | `features/auth/actions.ts` baris 63-89 |
| T2 | **Sesi demo bisa dibuat tanpa batas**; tiap sesi punya batas 5 panggilan AI nyata, tetapi tak ada batas per pengunjung, jadi biaya AI total tak berbatas bila demo dan kunci AI aktif | Tinggi untuk biaya. **Diperbaiki sebagian di PR ini (P0-1)**; batas penyedia (G5) tetap wajib | `app/api/demo/start/route.ts`, `lib/demo/ai-usage.ts` |
| T3 | **Tidak ada penutup/undangan pendaftaran dan tidak ada anti trial-farming** (S3 tidak ada di `main`; S1 sendiri menyatakan tidak menghentikan "email baru, tenant baru, trial baru"). Pembatas daftar 5/jam/IP di memori | Sedang: batas 10 tenant hanya aturan operasional | `docs/S1_TRIAL_AI_QUOTA.md` bagian "Not in S1" |
| T4 | **Trial dibuat malas (lazy) oleh aplikasi** pada akses pertama (`getOrCreateSubscription`), periode dipaksa server oleh trigger S1 bila migrasi aktif (G3) | Rendah bila G3 hijau; tanpa G3 periode bisa dipalsukan | `services/billing.ts` baris 37-80 |
| T5 | **Pembatas laju hanya di memori**, per instance serverless, reset tiap deploy (diakui di kodenya) | Rendah pada 10 tenant; bukan kontrol keamanan | `lib/rate-limit.ts` |
| T6 | **Tidak ada pelacak error**; `/api/health` hanya liveness | Sedang: kegagalan senyap tak terlihat | `app/error.tsx`, `app/global-error.tsx`, `app/api/health/route.ts` |
| T7 | **CSP masih Report-Only dan tanpa `report-uri`**; pelanggaran hanya di konsol browser. Header lain enforced | Rendah. `report-uri` butuh rute publik baru dan eksempsi di `proxy.ts` (dilarang di tugas ini) | `next.config.ts`, `tests/unit/config/security-headers.test.ts` |
| T8 | Lima tempat membaca `prompter_oauth_credentials` lewat klien service-role memfilter hanya `connected_account_id`, bukan `tenant_id` (kolom ada). Aman selama akun koneksi berasal dari kueri bertenant (benar saat ini), tetapi lemah sebagai lapisan kedua | Rendah (tak ada token pihak ketiga saat soft launch, G13) | `features/campaigns/sync-insights-actions.ts`, `features/approvals/actions.ts`, `features/connections/actions.ts` (2x), `features/campaigns/launch-actions.ts` |
| T9 | **Penghapusan data**: halaman proses sudah jujur, tetapi tidak ada fungsi/alat; anonimisasi log tidak ada | Sedang untuk kepatuhan; volume kecil | bagian 7 |
| T10 | **Admin Center** hanya data demo, tanpa akses nyata (OFF). Tidak ada alat operator untuk melihat tenant | Rendah; operasi lewat dashboard Supabase (lihat saja) | `docs/ADMIN_CENTER.md` |
| T11 | **Konsistensi Privasi/Syarat**: sesuai fitur nyata untuk AI (OpenAI/Anthropic), OAuth (Meta/TikTok/X, token terenkripsi), "iklan otomatis belum tersedia", "pembayaran sandbox", retensi belum ditetapkan. Celah: penyedia pembayaran belum dinamai (bahkan sebagai kandidat), tanggal berlaku kosong, tidak menyebut prosedur pemberitahuan insiden, pelacak error masa depan harus ditambahkan sebelum dipakai | Rendah; perbaiki sebelum pembayaran riil | `app/(legal)/privacy/page.tsx`, `terms/page.tsx`, `features/legal/legal-meta.ts` |
| T12 | RUNBOOK: kontak eskalasi kosong | Wajib diisi (G6) | `docs/RUNBOOK.md` bagian 4 |

## 9b. Audit sesi demo, batas per IP dan jaringan bersama (syarat persetujuan Founder untuk PR ini)

Lingkup: `app/api/demo/start/route.ts` dan pustaka terkait. Tidak mengubah login produksi, `proxy.ts`, env, migrasi. Nomor baris merujuk ke `main` sebelum perbaikan.

| ID | Temuan | Risiko | Status |
|---|---|---|---|
| D1 | `getClientIp` (`lib/rate-limit.ts:67-77`) jatuh ke hop pertama `x-forwarded-for` bila `x-nf-client-connection-ip` tidak ada. Header itu dapat diisi klien bila tidak ditimpa proksi: (a) penyerang memutar nilai palsu per permintaan dan melewati batas; (b) penyerang mencantumkan IP korban dan menghabiskan jatah korban (blokir tak adil). Dokumentasi Netlify yang dapat dibaca tidak menyatakan XFF ditimpa (BELUM TERVERIFIKASI) | Sedang | **Diperbaiki untuk demo**: `lib/security/client-ip.ts` hanya memakai `x-nf-client-connection-ip` (divalidasi sebagai alamat IP), tidak pernah XFF; tanpa IP tepercaya dipakai satu ember bersama yang lebih ketat. `getClientIp` yang dipakai login/OTP (`features/auth/actions.ts:129`, `otp-actions.ts:53,88`) **tidak diubah**: lihat rekomendasi R1 |
| D2 | IP bersama operator seluler (CGNAT) dan IPv6: banyak pelanggan satu IPv4 berbagi 10 sesi/jam; satu perangkat IPv6 memegang satu /64 penuh | Sedang (blokir tak adil; atau bypass IPv6) | **Dimitigasi**: pemegang cookie demo valid diarahkan masuk tanpa membuat sesi baru dan tanpa memakai jatah; kunci ember IPv6 = prefiks /64; pesan `busy` yang jelas (D6). Sisa risiko: pengguna baru di belakang NAT padat tetap dapat terblokir hingga 1 jam |
| D3 | Penembak otomatis ke `/api/demo/start`: `<Link href="/api/demo/start">` di `features/marketing/sections/ide-ke-hasil.tsx:190` dan `final-cta.tsx:39` di-prefetch Next.js saat masuk viewport (dua permintaan per kunjungan ke ember IP); `app/demo/page.tsx:13` mengalihkan ke rute itu sehingga crawler yang membuka `/demo` ikut membuat sesi (`app/robots.ts` hanya memblokir `/api/`, itu petunjuk, bukan kontrol); halaman pihak ketiga dapat menanam `<img src=.../api/demo/start>` untuk menguras jatah pengunjung. Perilaku prefetch Next.js 16 BELUM TERVERIFIKASI di sini (`node_modules` tidak ada), jadi perbaikannya defensif | Sedang | **Diperbaiki**: dua tautan jadi `<a>` biasa; rute menjawab 204 tanpa efek samping untuk prefetch, sub-resource, iframe, HEAD, dan UA crawler/pratinjau tautan, tanpa memakai jatah |
| D4 | Isolasi: token demo bertanda tangan HMAC, tanpa `tenant_id`, kedaluwarsa 30 menit (`lib/demo/session.ts:23`); halaman `/demo/*` hanya data statis (`lib/demo/dataset.ts`); aksi server menerima hanya `productId` yang dicari di daftar statis (prompt tidak dikendalikan klien) dan tidak membuat panggilan basis data tenant; `launchDemoCampaignAction` tanpa jaringan/kredensial; satu-satunya tulis ke basis data: `prompter_demo_ai_usage` lewat RPC `SECURITY DEFINER` (RLS tanpa kebijakan, `revoke` dari anon/authenticated). Tidak ditemukan akses data tenant lain atau penulisan ke data tenant | Rendah | Tidak ada perubahan. Catatan: baris `prompter_demo_ai_usage` tidak pernah dibersihkan (tumbuh sebanding sesi yang memakai AI; tanpa cron, butuh persetujuan terpisah) |
| D5 | Biaya AI: per sesi dibatasi 5 panggilan (DB, lintas instance) dan 2/menit; tetapi total = jumlah sesi x 5 dan tidak ada batas global | Tinggi bila kunci AI aktif | **Dikurangi**: batas global sesi baru per instance (300/jam) dan batas global panggilan AI demo per instance (100/jam; lewat itu demo memakai konten bawaan). Pagar sebenarnya tetap **batas biaya di penyedia AI (G5, tindakan Founder)** |
| D6 | Landing tidak menampilkan apa pun untuk `/?demo=busy` dan `/?demo=unavailable` (pengguna melihat halaman biasa tanpa penjelasan) | Rendah (UX) | **Diperbaiki**: `features/marketing/demo-notice.tsx` (komponen klien kecil + Suspense, halaman tetap statis) |

Batas yang jujur (kontrol bersama): semua pembatas di atas ada di memori, per instance serverless, reset tiap deploy, dan Netlify dapat menjalankan banyak instance; batas efektif dapat berkali lipat angka di kode, dan penyerang dengan banyak IP tetap bisa membuat banyak sesi (dibatasi total oleh batas global per instance, dengan konsekuensi demo bisa dibuat "penuh" oleh penyerang: ini pilihan sadar, karena menutup demo lebih murah daripada biaya AI tak terbatas). Kontrol lintas instance yang ada: batas per sesi di DB dan batas biaya penyedia. Kontrol lintas instance yang BELUM ada: penghitung global di DB atau batas di tepi jaringan.

Rekomendasi yang butuh persetujuan Founder (tidak dikerjakan di PR ini):
- R1: pakai `getTrustedClientIp` juga untuk `features/auth/actions.ts` dan `otp-actions.ts` (auth) dan sambungkan `login-throttle` (P1-1); satu baris per pemanggil.
- R2: penghitung global sesi demo/AI di DB (migrasi baru, proyek Supabase dibagi dengan PUBLOE/UMKMpro, jadi hanya setelah persetujuan eksplisit), atau aturan rate limiting di tepi jaringan Netlify bila tersedia di paket (BELUM TERVERIFIKASI).
- R3: bila ingin nol risiko biaya dari demo, kosongkan `DEMO_SESSION_SECRET` (perubahan env).

Sumber: Netlify (balasan staf di answers.netlify.com, "Upcoming change: stripping exposed Netlify headers from function and proxy requests"): "the `x-nf-client-connection-ip` header is the right one for inspecting" the connecting IP; header itu dipertahankan. Dokumen resmi docs.netlify.com/build/functions/api hanya mendokumentasikan `context.ip`. Diakses 2026-11-11.

## 10. Rekomendasi implementasi minimum (P0/P1)

Prinsip: hanya yang aman dan tidak menyentuh `proxy.ts`, auth, migrasi SQL, billing, RLS, env. Sisanya = **butuh persetujuan Founder** (dengan rancangan).

### P0 (sebelum undangan pertama)

| ID | Rekomendasi | File | Acceptance criteria | Status |
|---|---|---|---|---|
| P0-1 | Batas per IP pada pembuatan sesi demo (10/jam/IP), jawaban `/?demo=busy` tanpa cookie | `app/api/demo/start/route.ts`, `tests/unit/app/demo-start-route.test.ts` | IP ke-11 dalam satu jam tidak menerima cookie; IP lain tidak terpengaruh; secret kosong tetap "unavailable" dan tidak menghabiskan jatah | **Diimplementasikan di PR ini (UNIT TEST PASS bila CI hijau)** |
| P0-2 | Batas pengeluaran bulanan di dashboard penyedia AI | (dashboard, bukan kode) | Batas terpasang dan angka dicatat di arsip Founder | Tindakan Founder (G5) |
| P0-3 | Isi kontak eskalasi, pasang UptimeRobot (2 monitor), uji alert ke HP | `docs/RUNBOOK.md` bagian 4-5 | Alert uji diterima di HP dalam 10 menit | Tindakan Founder (G6, G7) |
| P0-4 | Konfirmasi S1 aktif dan SMTP kustom | (baca-saja; dashboard Supabase) | G3 dan G4 hijau dengan bukti tertulis | Tindakan Founder + sesi baca Claude |
| P0-5 | Putuskan jalur PSE (daftar dulu atau risiko sadar) | `docs/LEGAL_PSE_CHECKLIST.md` | Keputusan tertulis Founder | Tindakan Founder (G9) |

### P1 (dalam 2 minggu pertama soft launch atau sebelum tenant ke-11)

| ID | Rekomendasi | File | Acceptance criteria | Status |
|---|---|---|---|---|
| P1-1 | Pasang pembatas login (per IP 20/15 mnt, per email 8/15 mnt), pesan generik | `features/auth/actions.ts` (auth: **butuh persetujuan**), util siap `lib/security/login-throttle.ts` + `tests/unit/lib/login-throttle.test.ts` | Percobaan ke-9 untuk email sama dalam 15 menit ditolak sebelum `signInWithPassword`; pesan sama untuk email terdaftar/tidak; tes `auth-actions` diperbarui | Util + tes di PR ini; **penyambungan butuh persetujuan Founder** |
| P1-2 | Penutup pendaftaran / daftar undangan (jumlah tenant maksimal) | `features/auth/actions.ts` (+ opsi env), butuh rancangan | Pendaftaran ke-11 ditolak dengan pesan jelas; akun undangan lolos; tanpa perubahan migrasi bila memakai daftar email di env | **Butuh persetujuan (auth/env)** |
| P1-3 | Anti trial-farming (S3: ledger HMAC, default OFF) | migrasi + auth; PR #31 | Email berbeda dengan identitas sama tidak mendapat trial kedua; keputusan privasi tertulis (data apa yang di-hash) | **Butuh persetujuan (migrasi, privasi)** |
| P1-4 | Pelacak error | `app/error.tsx`, `app/global-error.tsx`, `next.config.ts` (CSP `connect-src`), halaman Privasi | Error runtime terlihat di dashboard dengan alert email; tanpa email/token di muatan; Privasi menyebut penyedia; CSP diperbarui. Opsi bergantung harga/paket (PERLU KONFIRMASI; Founder menghindari biaya bulanan) | **Butuh persetujuan (pihak ketiga, env, privasi)** |
| P1-5 | Terapkan #48 (guard kuota AI: peran/validasi input) | migrasi (lihat `docs/AI_JOBS_QUOTA_GUARD_RUNBOOK.md`) | Peran selain owner/marketing ditolak `ROLE_NOT_ALLOWED` | **Butuh persetujuan (migrasi produksi)** |
| P1-6 | `/api/health` readiness terpisah (cek database, tanpa detail) dan CSP `report-uri` | rute baru + eksempsi `proxy.ts` | Rute readiness mengembalikan 200/503 tanpa data sensitif; UptimeRobot memakainya | **Butuh persetujuan (`proxy.ts`)** |
| P1-7 | Fungsi penghapusan data per tenant (hitung dulu, hapus bertransaksi) | migrasi baru | Menghapus hanya tabel `prompter_*` tenant itu; menolak tanpa filter; tidak menyentuh tabel bersama | **Butuh persetujuan (migrasi, proyek bersama)** |
| P1-8 | Tambah `.eq("tenant_id", ...)` pada lima kueri kredensial service-role | file pada T8 | Kueri dengan tenant lain mengembalikan kosong; tes unit per file | **Butuh persetujuan** (menyentuh area koneksi/oauth) |
| P1-9 | Perbaiki Privasi/Syarat: nama penyedia pembayaran, tanggal berlaku, pemberitahuan insiden | `app/(legal)/*`, `features/legal/legal-meta.ts` | Teks sesuai fitur nyata; `effectiveDate` diisi saat Founder menyetujui | **Menunggu keputusan Founder (konten hukum)** |

Tidak direkomendasikan sekarang: pembatas laju terdistribusi (Redis) dan Admin Center nyata. Keduanya berbiaya/migrasi; tidak perlu untuk 10 tenant.

## 11. Yang dilakukan dan tidak dilakukan PR ini

Dilakukan: dua dokumen ini; batas per IP pada `app/api/demo/start/route.ts` (+ tes); `lib/security/login-throttle.ts` murni tidak tersambung (+ tes);
tes drift dokumen (`tests/unit/docs/soft-launch-docs.test.ts`).
Tidak dilakukan: tidak menyentuh `proxy.ts`, auth/login, migrasi, billing, RLS, env, `netlify.toml`, Netlify/Supabase, produksi; tidak ada tes beban; tidak ada pengajuan hukum; tidak ada panggilan MCP.
Header baru di `netlify.toml`/`next.config.ts` tidak ditambahkan: `netlify.toml` tidak punya pola header, `next.config.ts` sudah punya header yang dijaga tes, dan CSP `report-uri` butuh rute publik baru (T7, P1-6).
