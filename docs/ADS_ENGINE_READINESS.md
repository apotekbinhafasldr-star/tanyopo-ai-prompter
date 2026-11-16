# Kesiapan Ads Engine (One-Click Ads): audit kode dan daftar SANDBOX E2E

Tanggal: 2026-11-11. Dasar: `main` 6287160. Level: **KODE** (tidak ada panggilan jaringan, tidak ada biaya, tidak ada publikasi iklan).

> Gerbang S1 (`lib/campaigns/external-budget-guard.ts`, `BUDGET_WRITE_ENABLED_PLATFORMS`) **tetap terkunci** dan tidak diubah. Dokumen ini melengkapi `docs/META_ADS_LAUNCH_READINESS.md` (status Meta, versi API, satuan IDR, persyaratan App Review) dan tidak mengulanginya.

Label bukti yang dipakai: CODE READY, UNIT TEST PASS, MOCK E2E PASS, SANDBOX E2E PASS, REAL E2E PASS, CUSTOMER READY. Tes unit dijalankan CI, bukan lokal. Status "PASS" di bawah hanya berlaku setelah CI PR ini hijau (lihat laporan PR).

## 1. Hasil audit alur

| Area | Temuan (bukti di kode) | Hasil |
|---|---|---|
| Penulisan ke platform tanpa gerbang S1 | Konektor create/budget (`createCampaign`, `createAdSet`, `updateBudget`) hanya dipanggil dari `features/campaigns/launch-actions.ts` dan `features/approvals/actions.ts`; keduanya memanggil `evaluateExternalBudgetWrite` lebih dulu. `createCreative`/`createAd` hanya dipanggil dari urutan peluncuran yang sama, setelah `createCampaign`/`createAdSet` lolos gerbang dan klaim. `pauseCampaign` hanya dari eksekusi autopilot (menurunkan risiko, tidak menaikkan budget). Dijaga tes `tests/unit/lib/budget-write-callsites.test.ts`. | Tidak ada jalur bypass ditemukan. UNIT TEST PASS (tes ada, bukan perubahan PR ini). |
| Kampanye lolos tanpa approval | Peluncuran hanya dari master `SCHEDULED`; status itu hanya dicapai lewat `decideApprovalAction` (Owner saja, klaim atomik pada baris `PENDING`). Untuk Meta, peluncuran juga membaca approval `CAMPAIGN_LAUNCH` terbaru dan menolak bila bukan `APPROVED`, bila snapshot tujuan berubah, atau (di atas `require_approval_above`) bila tidak ada keputusan Owner yang tercatat. | Tidak ada bypass untuk Meta. Celah laten untuk TikTok/X: lihat temuan L1. |
| Batas anggaran dilewati | **Terbukti satu celah**: `campaign_limit` hanya dibandingkan dengan `total_budget`, dan Quick Promote/wizard mengizinkan `total_budget` kosong. Campaign hanya-harian (tanpa total, tanpa durasi) tidak pernah dibandingkan dengan batas itu. | **Diperbaiki di PR ini** (bagian 2, F1). |
| Ledger / jejak audit | Audit `campaign.submitted_for_approval`, `campaign.approved`, `campaign.launched`, `campaign.launch_failed`, `metrics.synced`, `autopilot_action.*` ditulis ke `prompter_audit_logs`. Penulisan audit peluncuran bersifat best-effort. Tidak ada tabel ledger biaya iklan. | Jejak ada; risiko L2 (id objek bisa hilang bila audit gagal). |
| Kegagalan parsial tanpa pemulihan | Klaim eksklusif `SCHEDULED -> FAILED` dengan nonce, tulisan berpagar, niat disimpan sebelum tiap create, token korelasi pada nama objek Meta, Emergency Stop dibaca ulang sebelum tiap create. Kegagalan setelah objek pertama tidak pernah dilepas otomatis. | Kuat. Satu celah kecil: **terbukti** pada rekomendasi optimasi (bagian 2, F2). |
| Status kampanye | Meta dicatat `PAUSED` (tidak ada langkah aktivasi di kode); TikTok/X `ACTIVE` bila gerbang dibuka. `canSyncInsights` mengizinkan `ACTIVE` dan `PAUSED` dengan id eksternal. | Konsisten dengan `launched-status.ts`. |
| Sinkron insight | `syncChannelCampaignInsightsAction` hanya memanggil `getInsights` (baca), upsert per `(channel_campaign_id, date)`, tidak membuat metrik palsu; kegagalan dikembalikan sebagai pesan, bukan angka. | Aman. Dua catatan belum terverifikasi: L3, L4. |
| Pembayaran biaya iklan | Pencarian kode (`ad_spend`, `ledger`, `wallet`, `biaya iklan`, jalur billing) tidak menemukan jalur di mana LINOE memegang atau memindahkan dana iklan. UI/ToS menyatakan biaya iklan dibayar langsung ke platform (`features/campaigns/launch-readiness-panel.tsx`, `docs/INTEGRATIONS.md`, halaman ToS). Billing tidak disentuh. | Tidak ada jalur biaya iklan lewat LINOE. |

## 2. Perbaikan di PR ini (terbukti, dengan tes unit)

**F1. `campaign_limit` tidak berlaku untuk campaign tanpa `total_budget`.**
`checkBudgetGuard` (`lib/budget-guard.ts`) membandingkan `campaign_limit` hanya bila `totalBudget != null`. Skema `quickPromoteSchema` dan `promoteWizardSchema` membuat `totalBudget` dan `durationDays` opsional, jadi campaign hanya-harian lolos batas per-campaign dan, di Meta, berjalan tanpa `end_time`.
Perbaikan: modul murni baru `lib/campaigns/campaign-limit.ts` (`checkCampaignLimitCoverage`), refusal-only, dipanggil di `submitForApprovalAction` (sebelum approval dibuat) dan `launchChannelCampaignAction` (sebelum klaim). Batas kosong = perilaku lama; batas tak terbaca = ditolak; ada total = tetap dinilai Budget Guard; tanpa total: harian x durasi harus <= batas, tanpa durasi = ditolak karena pengeluaran tak terbatas.
Tes: `tests/unit/lib/campaign-limit.test.ts` (murni) dan blok baru di `tests/unit/features/campaigns-launch-actions.test.ts` (ditolak sebelum klaim, tanpa panggilan konektor, tanpa audit).
Gerbang S1 tidak dilemahkan; modul ini hanya menambah penolakan.

**F2. Pengajuan rekomendasi optimasi menerima argumen klien tanpa validasi.**
`submitRecommendationAsApprovalAction` (server action) meneruskan `suggestedDailyBudget` dan `actionType` dari klien. Budget kosong, pecahan, nol atau negatif untuk `INCREASE_BUDGET`/`DECREASE_BUDGET` tetap membuat approval `PENDING`; setelah Owner menyetujui, gerbang S1 menolak eksekusi (butuh bilangan bulat >= 1), sehingga approval terpakai untuk perubahan yang tidak pernah bisa jalan.
Perbaikan: `submitRecommendationCore` menolak budget tidak valid dan jenis tindakan tak dikenal sebelum baris approval dibuat.
Tes: `tests/unit/features/campaign-optimization-submit.test.ts`.

## 3. Temuan yang TIDAK diubah (dilaporkan)

| # | Temuan | Mengapa tidak diubah | Tindakan lanjutan |
|---|---|---|---|
| L1 | Pembacaan approval dan `checkApprovalThreshold` di aksi peluncuran hanya untuk Meta. TikTok/X hanya bergantung pada master `SCHEDULED`. | Gerbang S1 menolak semua platform, dan konektor TikTok/X berhenti di `createAdSet` (butuh id lokasi). Mengubahnya tanpa platform yang dapat diuji hanya menambah risiko regresi. Sudah dicatat di `docs/META_ADS_LAUNCH_READINESS.md` 3.1. | Perluas ke semua platform sebelum satu platform non-Meta masuk `BUDGET_WRITE_ENABLED_PLATFORMS`. |
| L2 | Penulisan akhir peluncuran menghapus catatan progres (id ad set, creative, ad); id itu lalu hanya tersimpan di audit `campaign.launched`, yang best-effort. Bila audit gagal, id tersisa hanya di Ads Manager (nama objek Meta membawa token korelasi `LNE-...`). | Pemulihan butuh tempat simpan baru (kolom/tabel = migrasi) atau perubahan semantik penulisan akhir. | Butuh persetujuan Founder bila ingin kolom/tabel baru. |
| L3 | `getInsights` Meta memanggil `/{id}/insights` tanpa rentang tanggal eksplisit, lalu hasilnya disimpan sebagai baris `date = hari ini` dan dijumlahkan Budget Guard per bulan. Rentang bawaan Meta dan akibatnya pada penjumlahan (hitung ganda) **BELUM TERVERIFIKASI**: dokumen resmi Meta tidak terjangkau dari lingkungan ini pada 2026-11-11 (URL tidak ada di allowlist). | `lib/connectors/**` bukan lingkup tugas ini. Arah kesalahan bila terjadi: pengeluaran terlalu tinggi (menolak lebih banyak), bukan terlalu rendah. | Verifikasi pada akun uji; lalu beri `time_range` eksplisit di konektor. |
| L4 | Sinkron insight memakai tanggal UTC (`toISOString().slice(0,10)`), sedangkan tenant berzona WIB. Baris antara 00:00 dan 07:00 WIB jatuh ke tanggal sebelumnya. | Dampak kecil, konsisten dengan penjumlahan bulanan UTC server. | Putuskan zona tanggal metrik bersama analytics. |
| L5 | `executeAutopilotAction` (`features/approvals/actions.ts`, bukan file tugas ini) membaca Emergency Stop non-ketat untuk `PAUSE_CHANNEL` (kegagalan baca dianggap tidak aktif) dan tidak mencatat budget baru di LINOE setelah `updateBudget`. Jalur budget tidak terjangkau selama S1 terkunci; `PAUSE_CHANNEL` hanya menurunkan risiko. | Di luar kepemilikan file tugas ini. | Tinjau sebelum S1 dibuka untuk update budget. |
| L6 | Pesan error `getInsights` dikembalikan apa adanya ke klien (`err.message`). Kontrak `ConnectorApiError` menyebut teks penyedia boleh ditampilkan tetapi tidak boleh dicatat; tidak ada pencatatan di jalur ini. | Perilaku sesuai kontrak. | Pertimbangkan pesan generik sebelum pelanggan nyata. |

Tidak ada temuan yang butuh file terlarang (billing, auth, `proxy.ts`, migrasi, `features/oauth*`). Satu-satunya perubahan skema yang disarankan (L2) butuh persetujuan Founder.

## 4. Daftar kesiapan SANDBOX E2E

Tidak ada satu pun tes di repositori ini yang pernah menyentuh platform iklan. **Tidak ada klaim SANDBOX E2E atau REAL E2E.**

| Komponen | Ada di repo? | Label | Bukti |
|---|---|---|---|
| Alur ajukan -> approval Owner -> launch (dengan gerbang S1 terkunci) memakai server action asli, DB dan konektor palsu | Ya | MOCK E2E PASS (setelah CI hijau) | `tests/unit/features/one-click-ads-mock-e2e-gate-closed.test.ts`, `.../one-click-ads-mock-e2e-flow.test.ts`, `tests/unit/helpers/one-click-ads-mock-world.ts`. Bukan bukti E2E nyata. |
| Alur sampai pembuatan 4 objek dengan gerbang disimulasikan terbuka | Ya | UNIT TEST PASS | `tests/unit/features/campaigns-launch-actions.test.ts`, `launch-claim-safety.test.ts`, `launch-h2-safety.test.ts` (mock gerbang/validator budget; bukan bukti Meta menerima payload). |
| Klaim eksklusif, pagar, rollback, kegagalan parsial pada PostgreSQL nyata (kontainer CI terisolasi) | Ya | UNIT TEST PASS (integrasi PG di CI) | `tests/integration/pg/*`, job `pg-concurrency` di `.github/workflows/ci.yml`. Bukan Supabase produksi. |
| Kontrak payload konektor Meta (tanpa jaringan) | Ya | UNIT TEST PASS | `tests/unit/connectors/meta-connector*.test.ts`, `lib/connectors/meta-connector-contract.ts` |
| Preflight Meta (akun, Page, objective, URL, gambar) | Ya | UNIT TEST PASS | `lib/campaigns/meta-launch-preflight.ts`, `tests/unit/lib/meta-launch-preflight.test.ts` |
| Pembacaan kesiapan akun iklan Meta (read-only) | Ya | CODE READY, UNIT TEST PASS | `lib/connectors/meta-readiness.ts`; belum pernah dijalankan pada akun nyata. |
| Sinkron insight (read-only) | Ya | CODE READY | `features/campaigns/sync-insights-actions.ts`; belum diuji pada akun uji (L3). |
| Aktivasi iklan (PAUSED -> ACTIVE) | **Tidak ada** | BELUM ADA | Tidak ada kode aktivasi (`launched-status.ts`). Perlu desain dan persetujuan terpisah. |
| Satuan budget IDR di Meta | Kode ada, belum terverifikasi | BLOCKED | `meta-budget-units.ts` `verified: false`. Butuh akun iklan uji (`docs/META_ADS_LAUNCH_READINESS.md` bagian 4). |
| Akun iklan uji Meta + Halaman uji, izin `ads_management` | Tidak ada | EXTERNAL BLOCKED | Business Verification, App Review, Advanced Access belum diajukan (`docs/META_ADS_LAUNCH_READINESS.md` bagian 5, 8). |
| Akses jaringan ke `graph.facebook.com` dari lingkungan pengembangan | Tidak ada | BLOCKED | Tidak tersedia; semua tes memakai konektor palsu. |
| TikTok / X pembuatan iklan | Tidak lengkap | BLOCKED | `createAdSet` berhenti (butuh id lokasi); X belum mengimplementasikan create. Penyedia belum memberi izin. |
| Dokumen resmi Meta untuk rentang bawaan insight | Tidak terjangkau | BELUM TERVERIFIKASI | Lihat L3. |
| Biaya iklan lewat LINOE | Tidak ada (sengaja) | TIDAK BERLAKU | Dibayar langsung ke platform. |

Prasyarat sebelum SANDBOX E2E bisa diklaim (semua butuh keputusan Founder, bisa dari HP Android lewat browser):
1. Akun iklan uji dan Halaman Facebook uji, bukan akun pelanggan.
2. Persetujuan eksplisit sebelum `BUDGET_WRITE_ENABLED_PLATFORMS` diubah di PR ber-review terpisah (bukan di PR ini).
3. Verifikasi satuan budget IDR dan bukti mata uang akun (`getAdAccountCurrencyEvidence`) pada akun uji.
4. Uji hanya objek `PAUSED`, anggaran serendah mungkin, lalu hapus objek uji; tidak ada aktivasi.

## 5. Risiko tersisa

- Mock E2E dan tes unit tidak membuktikan Meta menerima payload; hanya akun uji yang membuktikan.
- Budget harian Meta bukan batas keras (lihat `docs/META_ADS_LAUNCH_READINESS.md` 3.2); `campaign_limit` dan `total_budget` ditegakkan di sisi LINOE sebagai proyeksi, bukan oleh Meta.
- Perubahan F1 dapat menolak campaign hanya-harian milik tenant yang sudah menetapkan `campaign_limit`; pesan menjelaskan cara memperbaikinya (isi total, atau harian dan durasi).
