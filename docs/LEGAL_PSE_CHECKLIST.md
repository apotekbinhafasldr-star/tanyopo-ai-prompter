# Checklist legal: PSE Privat, NIB/KBLI, UU PDP, PJP BI (soft launch 10 tenant)

Status: **Draft untuk Founder dan konsultan**. **Ini bukan nasihat hukum.** Dokumen ini mengumpulkan apa yang dapat dirujuk ke sumber resmi
dan apa yang harus dikonfirmasi konsultan hukum atau otoritas. **Tidak ada pengajuan, pendaftaran, atau komunikasi ke otoritas yang dilakukan oleh dokumen/PR ini.**
Semua tanggal akses: **2026-11-11**. Pasangan operasional: [SOFT_LAUNCH_10_TENANTS.md](SOFT_LAUNCH_10_TENANTS.md).
Seluruh langkah Founder bisa dilakukan dari HP (browser, OSS, email).

Tiga tingkat kepastian dipakai di bawah:
- **TERVERIFIKASI (resmi)**: dibaca dari situs pemerintah/otoritas, URL dicantumkan.
- **TERVERIFIKASI SEKUNDER**: teks benar menurut situs non-resmi yang mengutip; teks resmi belum dibuka. Cocokkan dulu.
- **PERLU KONFIRMASI**: tidak ada sumber resmi yang terjangkau, atau menyangkut penerapan ke LINOE. Jangan jadikan dasar keputusan tanpa konsultan/otoritas.

## 1. Fakta perusahaan yang diketahui (dari repo dan catatan Founder)

- Penyelenggara: PT Tanyopo Future Technology, Ladang Rimba, Aceh Selatan (`features/legal/legal-meta.ts`).
- Layanan: LINOE, SaaS pemasaran berbasis AI (brief, konten, perencanaan kampanye, SEO, analitik); penayangan iklan otomatis belum tersedia; pembayaran riil OFF.
- Pengguna eksternal pertama: maksimal 10 tenant undangan (soft launch). Data yang diproses: akun, data bisnis/pemasaran tenant, masukan AI, token koneksi (terenkripsi), log.
- Pemroses/penyedia: Netlify (hosting), Supabase (basis data, auth, berkas), OpenAI dan/atau Anthropic (AI), layanan email, kandidat gateway DOKU/Midtrans (belum live).
- **Tidak diketahui dari repo (Founder isi)**: nomor NIB, KBLI yang tercatat, status NPWP/akta, apakah TDPSE sudah ada, lokasi server penyedia.

## 2. PSE Lingkup Privat (PP 71/2019, Pasal 6)

| Hal | Status | Rujukan |
|---|---|---|
| PSE Lingkup Privat wajib mendaftar; pendaftaran dilakukan **sebelum sistem elektronik mulai digunakan oleh pengguna** | **TERVERIFIKASI (resmi)**: PP 71/2019 Pasal 6 ayat (1) dan (2) | [JDIH Komdigi, PP 71/2019](https://jdih.komdigi.go.id/produk_hukum/view/id/695/t/peraturan+pemerintah+nomor+71+tahun+2019), diakses 2026-11-11 |
| Pendaftaran diajukan kepada Menteri melalui pelayanan perizinan berusaha terintegrasi secara elektronik (OSS); tata cara lebih lanjut mengacu pada peraturan menteri | **TERVERIFIKASI (resmi)**: Pasal 6 ayat (3), (4) | URL sama |
| Lingkup Privat mencakup penyelenggara portal/situs/aplikasi daring untuk kegiatan tertentu | **TERVERIFIKASI (resmi)** untuk keberadaan ketentuan (Pasal 2 ayat 2 dan 5); halaman sumber sebagian terpotong, daftar kegiatan lengkap tidak dikutip di sini | URL sama |
| Permenkominfo 5/2020 diubah Permenkominfo 10/2021 (ketentuan peralihan terkait waktu berlakunya OSS berbasis risiko; kewajiban daftar dalam 6 bulan sejak itu) | **TERVERIFIKASI (resmi)** hanya abstrak perubahan | [JDIH Komdigi, abstrak Permenkominfo 10/2021](https://jdih.komdigi.go.id/produk_hukum/unduh-abstrak/450), diakses 2026-11-11 |
| Apakah LINOE (SaaS, 10 tenant undangan) termasuk PSE Privat yang wajib daftar | **PERLU KONFIRMASI konsultan/Komdigi.** Bacaan hati-hati: ya, karena tenant adalah "pengguna" dan LINOE aplikasi daring untuk kegiatan usaha. Sumber sekunder menyebut SaaS tercakup | pemberitaan/artikel konsultan, bukan resmi |
| Sanksi bila tidak terdaftar (pemblokiran akses, apakah tanpa peringatan bertahap) | **PERLU KONFIRMASI.** Pasal 100 PP 71/2019 menyebut sanksi administratif (terverifikasi resmi hanya keberadaannya; Pasal 100 merujuk pasal registrasi domain 82(7) dalam kutipan yang dibaca, rincian PSE ada di peraturan menteri). Klaim "blokir tanpa peringatan" berasal dari artikel sekunder | [izin.co.id](https://izin.co.id/blog/apa-itu-pse-kominfo/) (sekunder, artikel 21-30 Juli 2026) |
| Dokumen/isian pendaftaran (identitas PSE, penanggung jawab, domisili/akta, jumlah pengguna dan nilai transaksi dari Indonesia, deskripsi sistem, komitmen keamanan/data pribadi, URL, data lokasi, pernyataan akses untuk pengawasan) | **PERLU KONFIRMASI** isian terkini di OSS; daftar di bagian 5 berasal dari artikel sekunder | [SmartLegal](https://smartlegal.id/pse/2025/11/17/cara-daftar-pse-kominfo-ini-prosedur-dasar-hukum-dan-persyaratannya-sl/) (sekunder, diperbarui 8 April 2026) |
| Tidak ada tarif PNBP resmi untuk pendaftaran | **PERLU KONFIRMASI** (artikel sekunder). Founder menghindari biaya: jangan membayar "biro" tanpa memeriksa | izin.co.id (sekunder) |

Catatan implikasi: bila memilih mengundang tenant sebelum TDPSE terbit, itu keputusan risiko sadar Founder (G9 di dokumen soft launch), idealnya dengan masukan konsultan. Dokumen ini tidak menyarankan atau melarangnya secara hukum.

## 3. NIB dan KBLI

| Hal | Status | Rujukan |
|---|---|---|
| KBLI 73100 = "Periklanan" (KBLI 2020): jasa periklanan termasuk saran, kreatif, perencanaan/pembelian media, produksi iklan; kode ini tetap di KBLI 2025 | **TERVERIFIKASI (resmi)** | [OSS, KBLI 73100](https://oss.go.id/en/kbli/detail/31ed304d-a3e6-4087-83aa-9c8e37d02fc7), diakses 2026-11-11 |
| Contoh kode perangkat lunak: KBLI 62019 "Aktivitas Pemrograman Komputer Lainnya" (2020; menjadi 62199 di KBLI 2025); 62191 "Pengembangan Aplikasi Perdagangan melalui Internet (E-Commerce)" (KBLI 2025) | **TERVERIFIKASI (resmi)** untuk deskripsi kode, **bukan** rekomendasi pemilihan | [OSS 62019](https://oss.go.id/en/kbli/detail/5e8659f8-01e8-48d9-bceb-4af4015caa73), [OSS 62191](https://oss.go.id/en/kbli/detail/7fe22b1e-1c4a-585e-bf8c-83e080632031), diakses 2026-11-11 |
| KBLI mana yang tepat untuk LINOE (SaaS AI pemasaran: 73100, kode perangkat lunak/platform, atau kombinasi) dan apakah KBLI yang tercatat di NIB PT sudah sesuai | **PERLU KONFIRMASI konsultan/OSS.** Kode usaha di NIB memengaruhi pendaftaran PSE dan perizinan berbasis risiko |
| Edisi KBLI yang berlaku untuk perubahan NIB (2020 vs 2025) dan tata cara perubahan | **PERLU KONFIRMASI** di OSS |
| NIB aktif dan KBLI yang sesuai sebagai prasyarat pendaftaran PSE | **PERLU KONFIRMASI** (sumber sekunder menyatakan prasyarat) |

## 4. UU PDP (UU 27/2022) dan turunannya

| Hal | Status | Rujukan |
|---|---|---|
| Pasal 46 ayat (1): kegagalan pelindungan data pribadi, pengendali wajib memberi **pemberitahuan tertulis paling lambat 3 x 24 jam** kepada subjek data dan lembaga; ayat (2) isi minimal; ayat (3) pemberitahuan kepada masyarakat dalam hal tertentu | **TERVERIFIKASI SEKUNDER** (teks dikutip pasal.id; halaman resmi BPK tidak terjangkau saat akses) | [pasal.id Pasal 46](https://pasal.id/peraturan/uu/uu-no-27-tahun-2022/pasal-46); resmi untuk dicocokkan: [peraturan.bpk.go.id UU 27/2022](https://peraturan.bpk.go.id/Details/229798/uu-no-27-tahun-2022) |
| Cara hitung 3 x 24 jam dan saat jam mulai (temuan vs terbukti) | **PERLU KONFIRMASI.** Sikap hati-hati internal: hitung dari jam temuan |
| Siapa/apa "lembaga" penerima pemberitahuan dan saluran penyampaiannya saat ini | **PERLU KONFIRMASI.** Pemberitaan sekunder 2026 menyebut lembaga PDP belum terbentuk penuh: [Bisnis.com, 8 Sep 2026](https://teknologi.bisnis.com/read/20260908/84/2002386/uu-dan-pp-sudah-ada-pengamat-aturan-pdp-belum-efektif-tanpa-lembaga) (tidak dibuka penuh), [MKRI](https://www.mkri.id/berita/Kekosongan_Lembaga_Independen_Pelindungan_Data_Pribadi-25005) |
| PP 33/2026 (pelaksana UU PDP): ditandatangani 16 Juli 2026, berlaku 16 Januari 2027 | **PERLU KONFIRMASI.** Hanya sumber sekunder: [SIP Law Firm](https://siplawfirm.id/resources/pp-33-2026-pelindungan-data-pribadi), [Katadata, 3 Sep 2026](https://katadata.co.id/amp/finansial/makro/6a9979b7c5745/pp-pelindungan-data-pribadi-berlaku-januari-2027-ini-aturan-baru-data-anak). Teks resmi tidak ditemukan di situs pemerintah saat pencarian |
| Pejabat PDP (DPO), penilaian dampak (DPIA), catatan kegiatan pemrosesan, retensi, transfer lintas negara (penyedia AI/hosting di luar negeri) berlaku bagi LINOE | **PERLU KONFIRMASI konsultan** (ringkasan sekunder menyebut kewajiban ini; penerapan ke skala 10 tenant tidak ditentukan di sini) |
| Peran LINOE: pengendali (data akun tenant) dan/atau prosesor (data pelanggan tenant dalam konten); perlu perjanjian pemrosesan data (DPA) dengan tenant | **PERLU KONFIRMASI konsultan** |
| Konsistensi Kebijakan Privasi dengan kewajiban (dasar pemrosesan, retensi, hak subjek, pihak ketiga, pemberitahuan insiden) | **PERLU KONFIRMASI konsultan.** Cek internal: lihat T11 di dokumen soft launch |

## 5. PJP Bank Indonesia

| Hal | Status | Rujukan |
|---|---|---|
| PJP = bank/lembaga selain bank yang memfasilitasi transaksi pembayaran; kegiatan berizin: penatausahaan sumber dana, penyediaan informasi sumber dana, inisiasi pembayaran dan/atau akuisisi, remitansi; kategori izin I/II/III menurut PBI 23/6/PBI/2021 (PBI 22/23/PBI/2020 untuk sistem pembayaran) | **TERVERIFIKASI (resmi)** | [BI, Perizinan Penyelenggara Jasa Sistem Pembayaran](https://www.bi.go.id/id/fungsi-utama/sistem-pembayaran/perizinan), diakses 2026-11-11 |
| Apakah LINOE perlu izin PJP bila menerima pembayaran langganan lewat gateway berizin (DOKU/Midtrans) sebagai merchant biasa, tanpa memegang/menyimpan dana pelanggan | **PERLU KONFIRMASI konsultan/BI.** Bacaan hati-hati: tidak termasuk, **selama LINOE tidak** mengelola saldo, wallet, top-up iklan, atau meneruskan dana. Keputusan bisnis Founder: pelanggan membayar iklan langsung ke Meta/TikTok, LINOE hanya menerima biaya layanan, tanpa saldo/wallet |
| Selama soft launch: tidak ada pembayaran riil | **Fakta repo** (`PAYMENT_LIVE_ENABLED` OFF) sehingga PJP tidak relevan sampai pembayaran diaktifkan; tinjau ulang sebelum aktivasi |
| Fitur dompet/penarikan Mitapeng | **Di luar lingkup LINOE**; produk lain, perlu kajian PJP sendiri sebelum rilis (PERLU KONFIRMASI) |

## 6. Dokumen yang harus disiapkan (siapkan, jangan ajukan)

Perusahaan: akta pendirian dan pengesahan, NPWP, NIB beserta daftar KBLI, identitas penanggung jawab, alamat/domisili, kontak teknis dan hukum.
Sistem: deskripsi singkat LINOE (alur, tipe data), domain/URL produksi (tiap domain didaftarkan sendiri), diagram aliran data (tenant, Supabase, penyedia AI, hosting, email), lokasi server penyedia, daftar penyedia dan perannya.
Pelindungan data: Kebijakan Privasi dan Syarat final (tanggal berlaku), prosedur penghapusan (halaman `/data-deletion` + SOP internal bagian 7 soft launch), SOP insiden dan templat pemberitahuan 3 x 24 jam (bagian 6.3), daftar pemrosesan (apa, mengapa, dasar, penerima, retensi, keamanan), rancangan DPA untuk tenant.
Bukti keamanan yang sudah ada di repo (rujukan, bukan klaim sertifikasi): `docs/SECURITY.md` (RLS, enkripsi token AES-256-GCM, tanda tangan layanan HMAC), header keamanan di `next.config.ts`, SOP backup di PR #116. **Jangan** menyatakan sertifikasi (ISO/SOC) yang tidak ada.
Operasional: kontak eskalasi terisi (RUNBOOK bagian 4), nama konsultan, arsip insiden.

## 7. Pengajuan/keputusan yang butuh Founder (tidak dilakukan di sini)

| # | Tindakan Founder | Dari HP? | Kapan |
|---|---|---|---|
| F1 | Putuskan: tunda undangan sampai TDPSE terbit, atau lanjut dengan risiko sadar | Ya | Sebelum undangan pertama |
| F2 | Cek NIB di OSS: nomor, daftar KBLI, kesesuaian dengan LINOE (73100 dan/atau kode perangkat lunak) | Ya (oss.go.id di browser) | Segera |
| F3 | Bila perlu: ubah/tambah KBLI di OSS (konsultan bila ragu) | Ya | Sebelum F4 |
| F4 | Ajukan pendaftaran PSE Lingkup Privat lewat OSS, setelah isian terkini dikonfirmasi | Ya | Sebelum pengguna eksternal (Pasal 6 ayat 2) |
| F5 | Pilih konsultan hukum/PDP untuk konfirmasi bagian PERLU KONFIRMASI; minta jawaban tertulis | Ya | Sebelum tenant ke-11 atau pembayaran riil |
| F6 | Setujui teks final Privasi/Syarat dan tetapkan `effectiveDate` (perubahan kode lewat sesi Claude) | Ya (setujui) | Sebelum undangan |
| F7 | Tetapkan penanggung jawab data pribadi/DPO atau keputusan tidak menunjuk (dengan konsultan) | Ya | Sebelum PP 33/2026 berlaku bila terverifikasi |
| F8 | Putuskan kanal email dukungan: alamat umum perusahaan sudah dipakai; pertimbangkan alamat khusus tanpa biaya (konsultasikan opsi) | Ya | Sebelum undangan |
| F9 | Sebelum pembayaran riil: konfirmasi status PJP/merchant, pajak, faktur, dan sinkronkan Privasi (nama penyedia pembayaran) | Ya | Sebelum aktivasi pembayaran |

## 8. Daftar sumber (akses 2026-11-11)

Resmi: [PP 71/2019 (JDIH Komdigi)](https://jdih.komdigi.go.id/produk_hukum/view/id/695/t/peraturan+pemerintah+nomor+71+tahun+2019);
[Abstrak Permenkominfo 10/2021 (JDIH Komdigi)](https://jdih.komdigi.go.id/produk_hukum/unduh-abstrak/450);
[KBLI 73100 (OSS)](https://oss.go.id/en/kbli/detail/31ed304d-a3e6-4087-83aa-9c8e37d02fc7);
[KBLI 62019 (OSS)](https://oss.go.id/en/kbli/detail/5e8659f8-01e8-48d9-bceb-4af4015caa73);
[KBLI 62191 (OSS)](https://oss.go.id/en/kbli/detail/7fe22b1e-1c4a-585e-bf8c-83e080632031);
[PJP (Bank Indonesia)](https://www.bi.go.id/id/fungsi-utama/sistem-pembayaran/perizinan).
Resmi untuk dicocokkan, tidak terjangkau saat akses: [UU 27/2022 (peraturan.bpk.go.id)](https://peraturan.bpk.go.id/Details/229798/uu-no-27-tahun-2022).
Sekunder: [pasal.id Pasal 46](https://pasal.id/peraturan/uu/uu-no-27-tahun-2022/pasal-46); [SIP Law Firm PP 33/2026](https://siplawfirm.id/resources/pp-33-2026-pelindungan-data-pribadi);
[Katadata PP PDP](https://katadata.co.id/amp/finansial/makro/6a9979b7c5745/pp-pelindungan-data-pribadi-berlaku-januari-2027-ini-aturan-baru-data-anak);
[izin.co.id PSE](https://izin.co.id/blog/apa-itu-pse-kominfo/); [SmartLegal PSE](https://smartlegal.id/pse/2025/11/17/cara-daftar-pse-kominfo-ini-prosedur-dasar-hukum-dan-persyaratannya-sl/).
Pendukung teknis (platform, bukan hukum): [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [Supabase rate limits](https://supabase.com/docs/guides/auth/rate-limits), [Supabase backups](https://supabase.com/docs/guides/platform/backups).

Tidak terjangkau/BLOCKED: teks resmi UU 27/2022 dan PP 33/2026 di situs pemerintah; isian terkini formulir PSE di OSS (butuh login); pemberitaan Bisnis.com (gagal dibuka).
