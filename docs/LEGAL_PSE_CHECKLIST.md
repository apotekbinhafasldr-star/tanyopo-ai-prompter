# Checklist legal: PSE Privat, NIB/KBLI, UU PDP, DPA, PJP BI (soft launch gratis 10 tenant)

Status: **Draft riset dan checklist untuk Founder dan konsultan hukum**. **Ini bukan nasihat hukum dan bukan pernyataan kepatuhan.** Keputusan hukum ada pada
konsultan hukum/PDP dan otoritas. Dokumen ini hanya mengumpulkan apa yang dapat dirujuk ke sumber dan apa yang masih harus dikonfirmasi.
**Tidak ada pengajuan, pendaftaran, atau komunikasi ke otoritas yang dilakukan oleh dokumen/PR ini.**
Semua tanggal akses: **2026-11-11**. Pasangan operasional: [SOFT_LAUNCH_10_TENANTS.md](SOFT_LAUNCH_10_TENANTS.md).
Seluruh langkah Founder bisa dilakukan dari HP (browser, OSS, email).

Empat tingkat kepastian dipakai di bawah:
- **TERVERIFIKASI (resmi)**: teks dibaca dari situs pemerintah/otoritas/penyedia sendiri, URL dicantumkan. Pembacaan lewat alat ringkasan halaman: cocokkan nomor ayat dengan PDF resmi sebelum dikutip ke pihak lain.
- **TERVERIFIKASI SEKUNDER**: dibaca dari situs non-resmi (pasal.id, kantor hukum, media). Cocokkan dengan teks resmi.
- **PERLU KONFIRMASI**: menyangkut penerapan ke LINOE atau tidak ada sumber yang cukup. Jangan jadikan dasar keputusan tanpa konsultan/otoritas.
- **BELUM TERVERIFIKASI**: sumber tidak terjangkau saat akses (kegagalan, daftar putih, butuh login). Tidak ada isi yang diklaim.

## 1. Fakta perusahaan yang diketahui (dari repo dan catatan Founder)

- Penyelenggara: PT Tanyopo Future Technology, Ladang Rimba, Aceh Selatan (`features/legal/legal-meta.ts`).
- Layanan: LINOE, SaaS pemasaran berbasis AI (brief, konten, perencanaan kampanye, SEO, analitik); penayangan iklan otomatis belum tersedia; pembayaran riil OFF.
- Pengguna eksternal pertama: maksimal 10 tenant undangan, gratis (soft launch). Data yang diproses: akun, data bisnis/pemasaran tenant, masukan AI (teks bebas dapat memuat data pribadi), token koneksi (terenkripsi), log, alamat IP/perangkat pada sesi autentikasi (Kebijakan Privasi bagian 2).
- Pemroses/penyedia: Netlify (hosting), Supabase (basis data, auth, berkas), OpenAI dan/atau Anthropic (AI), layanan email, kandidat gateway DOKU/Midtrans (belum live).
- Akun login dipakai bersama produk Tanyopo lain (basis data Supabase bersama): pembagian peran pengendali antar produk perlu dikaji (pertanyaan K9).
- Fakta kode yang relevan: checkbox persetujuan Syarat/Privasi wajib saat daftar (`features/auth/register-form.tsx`, `schemas/auth.ts`), tetapi komentar di `schemas/auth.ts` menyatakan **persetujuan tidak disimpan** (tanpa bukti/tanggal). Kebijakan Privasi bagian 8: retensi tetap belum ditetapkan. Halaman `/data-deletion`: manual, tanpa jangka waktu.
- **Tidak diketahui dari repo (Founder isi)**: nomor NIB, KBLI yang tercatat, status NPWP/akta, apakah TDPSE sudah ada, lokasi server penyedia, jenis akun/ketentuan yang dipakai di tiap penyedia AI (API komersial atau lainnya).

## 2. PSE Lingkup Privat: kewajiban pendaftaran

| Hal | Status | Rujukan |
|---|---|---|
| Setiap PSE Lingkup Privat wajib mendaftar (Permenkominfo 5/2020 Pasal 2 ayat 1) | **TERVERIFIKASI (resmi)** | [JDIH Komdigi, Permenkominfo 5/2020](https://jdih.komdigi.go.id/produk_hukum/view/id/759/t/peraturan+menteri+komunikasi+dan+informatika+nomor+5+tahun+2020), diakses 2026-11-11 |
| Pendaftaran dilakukan **sebelum Sistem Elektronik mulai digunakan oleh Pengguna** (Pasal 2 ayat 3). Sama dengan PP 71/2019 Pasal 6 | **TERVERIFIKASI (resmi)** untuk Permenkominfo 5/2020. PP 71/2019 Pasal 6 dibaca resmi pada penyusunan awal; akses ulang JDIH PP 71/2019 gagal pada 2026-11-11 (server_error), dikonfirmasi silang sekunder | URL Permenkominfo di atas; [JDIH Komdigi, PP 71/2019](https://jdih.komdigi.go.id/produk_hukum/view/id/695/t/peraturan+pemerintah+nomor+71+tahun+2019); sekunder: [pasal.id PP 71/2019](https://pasal.id/peraturan/pp/pp-no-71-tahun-2019), diakses 2026-11-11 |
| Cakupan (Pasal 2 ayat 2): (a) PSE yang diatur/diawasi Kementerian/Lembaga; dan/atau (b) pemilik portal/situs/aplikasi daring untuk enam kegiatan: perdagangan barang/jasa; layanan transaksi keuangan; pengiriman konten digital berbayar; layanan komunikasi dan media sosial; mesin pencari/penyediaan konten elektronik; pemrosesan data pribadi untuk kegiatan transaksi elektronik | **TERVERIFIKASI (resmi)** (pembacaan ringkasan halaman; daftar harus dicocokkan ke PDF) | URL Permenkominfo di atas |
| Apakah LINOE (SaaS pemasaran AI, tenant undangan, tanpa pembayaran riil) masuk salah satu kategori di atas | **PERLU KONFIRMASI konsultan/Komdigi.** Teks tidak menyebut "SaaS" sebagai kategori. Kandidat yang paling dekat: pemrosesan data pribadi untuk transaksi elektronik, atau layanan lain. Bacaan hati-hati: anggap wajib sampai konsultan menyatakan sebaliknya | pembacaan teks resmi di atas |
| Pengecualian untuk sistem gratis, berskala kecil, atau undangan terbatas | **TIDAK DITEMUKAN** pada teks yang dibaca (halaman JDIH 120.602 karakter; 100.000 karakter pertama dibaca; sisanya **BELUM TERVERIFIKASI**). Pengecualian yang ada bersifat prosedural (Pasal 3 ayat 5 pendaftaran tanpa OSS bagi PSE tertentu; Pasal 4 PSE asing). Tidak ada pembedaan berbayar/gratis | URL Permenkominfo di atas |
| Pengajuan lewat OSS (Pasal 3 ayat 2); Menteri menerbitkan tanda daftar (Pasal 6 ayat 1) | **TERVERIFIKASI (resmi)**. Istilah "TDPSE" tidak muncul di teks yang dibaca; teks memakai "Tanda Daftar PSE" | URL Permenkominfo di atas |
| Isi formulir (Pasal 3 ayat 3-4): gambaran umum sistem (nama, sektor, URL, DNS/IP server, model bisnis, data pribadi yang diproses, lokasi penyimpanan data), komitmen keamanan informasi, pelindungan data pribadi, uji kelaikan sistem, dan pernyataan kesediaan memberi akses untuk pengawasan/penegakan hukum | **TERVERIFIKASI (resmi)**. Formulir OSS terkini **BELUM TERVERIFIKASI** (butuh login; `pse.komdigi.go.id` tidak terjangkau) | URL Permenkominfo di atas |
| Perubahan data wajib dilaporkan (Pasal 5); PSE wajib memberi akses sistem/data kepada Kementerian/Lembaga untuk pengawasan (Pasal 21 ayat 1) | **TERVERIFIKASI (resmi)** | URL Permenkominfo di atas |
| Sanksi: tidak mendaftar dikenai **pemutusan akses** (Pasal 7 ayat 2); kelalaian lapor perubahan/data tidak benar bertahap: teguran tertulis, penghentian sementara, pemutusan akses dan pencabutan tanda daftar bila tidak ada konfirmasi 7 hari (Pasal 7 ayat 3). Tidak ada sanksi denda di Pasal 7 | **TERVERIFIKASI (resmi)**. Apakah ada peringatan lebih dulu sebelum pemutusan akses karena tidak mendaftar: **PERLU KONFIRMASI** (teks ayat 2 tidak menyebut tahapan) | URL Permenkominfo di atas |
| Batas waktu peralihan: PSE wajib mendaftar paling lambat 6 bulan sejak OSS berbasis risiko berlaku efektif (Permenkominfo 10/2021 mengubah Pasal 47). Peralihan itu sudah lewat; tidak menunda kewajiban untuk sistem baru | **TERVERIFIKASI (resmi)** (abstrak). Perhitungan "sekitar Maret 2022" adalah hitungan ringkasan, bukan teks | [JDIH Komdigi, abstrak Permenkominfo 10/2021](https://jdih.komdigi.go.id/produk_hukum/unduh-abstrak/450), diakses 2026-11-11 |
| Perubahan/pengganti Permenkominfo 5/2020 setelah 2021 (mis. peraturan Komdigi baru) | **BELUM TERVERIFIKASI.** Pencarian 2026-11-11 tidak menemukan pengganti, tetapi basis JDIH tidak dapat disisir penuh. Konsultan wajib memeriksa | pencarian web, tanpa hasil resmi |
| Penegakan 2026: Komdigi dilaporkan menyurati puluhan PSE privat yang belum daftar dan mengancam pemblokiran (judul pemberitaan April-September 2026) | **TERVERIFIKASI SEKUNDER** hanya dari judul/ringkasan hasil pencarian (isi artikel tidak dibuka; siaran pers infopublik gagal dibuka) | mis. [Bisnis.com, 21 Apr 2026](https://teknologi.bisnis.com/read/20260421/101/1968110/tenggat-wimikedia-foundation-daftar-pse-hampir-habis-terancam-ditutup-sementara), [Bisnis.com, 18 Sep 2026](https://teknologi.bisnis.com/read/20260918/101/2005294/lion-air-hingga-kcic-diminta-segera-daftar-pse-paling-lambat-22-september), diakses 2026-11-11 |
| PSE Privat boleh mengelola/menyimpan sistem dan data di dalam atau luar Indonesia (PP 71/2019 Pasal 21); wajib prosedur/sarana pengamanan (Pasal 24); wajib edukasi pengguna termasuk prosedur komplain (Pasal 28) | **TERVERIFIKASI SEKUNDER** (teks sebagian terpotong) | [pasal.id PP 71/2019](https://pasal.id/peraturan/pp/pp-no-71-tahun-2019), diakses 2026-11-11 |
| Tarif PNBP pendaftaran; dokumen pendukung terkini (akta, NIB aktif dan KBLI sesuai) | **PERLU KONFIRMASI** (hanya artikel konsultan: [izin.co.id](https://izin.co.id/blog/apa-itu-pse-kominfo/), [SmartLegal](https://smartlegal.id/pse/2025/11/17/cara-daftar-pse-kominfo-ini-prosedur-dasar-hukum-dan-persyaratannya-sl/)). Jangan membayar "biro" tanpa memeriksa |

## 3. Kapan kewajiban berlaku untuk soft launch gratis 10 tenant

| Pertanyaan | Jawaban berdasarkan sumber | Status |
|---|---|---|
| Kapan tepatnya pendaftaran PSE harus ada? | Sebelum sistem dipakai Pengguna (Permenkominfo 5/2020 Pasal 2 ayat 3). Tenant undangan adalah pengguna. Gratis atau undangan terbatas tidak disebut sebagai pengecualian pada teks yang dibaca | **TERVERIFIKASI (resmi)** untuk kalimat Pasal; penerapan ke LINOE **PERLU KONFIRMASI** |
| Apakah mengundang tenant sebelum tanda daftar terbit melanggar? | Bila LINOE termasuk PSE Privat wajib daftar, ya menurut bunyi Pasal 2 ayat 3; akibat yang tertulis: pemutusan akses (Pasal 7 ayat 2). Besar risiko praktis (kemungkinan penindakan untuk sistem kecil) **tidak diketahui** | **PERLU KONFIRMASI konsultan** |
| UU PDP sudah berlaku untuk LINOE saat soft launch? | UU 27/2022 diundangkan 17 Okt 2022; Pasal 74: masa penyesuaian 2 tahun (jatuh sekitar 17 Okt 2024, hitungan dari ringkasan, bukan teks). Tidak ada pengecualian skala kecil pada ringkasan yang dibaca. Jadi kewajiban pengendali (dasar pemrosesan, hak subjek, notifikasi insiden) dianggap berlaku sejak undangan pertama bila ada data pribadi | **TERVERIFIKASI SEKUNDER**; penerapan **PERLU KONFIRMASI** |
| PP 33/2026 (pelaksana UU PDP) berlaku kapan? | Ditetapkan 16 Juli 2026, berlaku 16 Januari 2027 (Pasal 225 menurut ringkasan). Soft launch sebelum tanggal itu hanya tunduk pada UU PDP dan peraturan lama; setelahnya tunduk juga pada PP. Persiapan (ROPA, DPA, retensi, DPIA) sebaiknya mulai sekarang | **TERVERIFIKASI SEKUNDER** (teks resmi PP tidak terjangkau) |
| Pembayaran/PJP | Tidak relevan selama `PAYMENT_LIVE_ENABLED` OFF (bagian 9) | Fakta repo |
| Rangkuman | Dua keputusan Founder yang tidak bisa diwakili AI: (1) apakah TDPSE ditunggu sebelum undangan, (2) siapa yang menandatangani keputusan itu secara tertulis (G9). Dokumen ini tidak menyarankan atau melarang | Keputusan Founder + konsultan |

## 4. NIB dan KBLI

| Hal | Status | Rujukan |
|---|---|---|
| KBLI 73100 = "Periklanan" (KBLI 2020): jasa periklanan termasuk saran, kreatif, perencanaan/pembelian media, produksi iklan; kode ini tetap di KBLI 2025 | **TERVERIFIKASI (resmi)** | [OSS, KBLI 73100](https://oss.go.id/en/kbli/detail/31ed304d-a3e6-4087-83aa-9c8e37d02fc7), diakses 2026-11-11 |
| Contoh kode perangkat lunak: KBLI 62019 "Aktivitas Pemrograman Komputer Lainnya" (2020; menjadi 62199 di KBLI 2025); 62191 "Pengembangan Aplikasi Perdagangan melalui Internet (E-Commerce)" (KBLI 2025) | **TERVERIFIKASI (resmi)** untuk deskripsi kode, **bukan** rekomendasi pemilihan | [OSS 62019](https://oss.go.id/en/kbli/detail/5e8659f8-01e8-48d9-bceb-4af4015caa73), [OSS 62191](https://oss.go.id/en/kbli/detail/7fe22b1e-1c4a-585e-bf8c-83e080632031), diakses 2026-11-11 |
| KBLI mana yang tepat untuk LINOE (73100, kode perangkat lunak/platform, atau kombinasi) dan apakah KBLI di NIB PT sudah sesuai | **PERLU KONFIRMASI konsultan/OSS.** Kode usaha di NIB memengaruhi pendaftaran PSE dan perizinan berbasis risiko |
| Edisi KBLI yang berlaku untuk perubahan NIB (2020 vs 2025) dan tata cara perubahan | **PERLU KONFIRMASI** di OSS |
| NIB aktif dan KBLI sesuai sebagai prasyarat pendaftaran PSE | **PERLU KONFIRMASI** (sumber sekunder menyatakan prasyarat) |

## 5. UU PDP (UU 27/2022) dan turunannya: ringkasan kewajiban

Teks resmi UU 27/2022 di `peraturan.bpk.go.id` **tidak terjangkau** (gagal dibuka dua kali) dan `meridianhukum.com` tidak memuat teks pasal. Semua pasal di bawah dibaca dari [pasal.id UU 27/2022](https://pasal.id/peraturan/uu/uu-no-27-tahun-2022) (ringkasan halaman, beberapa pasal terpotong: 15, 34, 50, 57, 60, 70), diakses 2026-11-11 = **TERVERIFIKASI SEKUNDER**. Resmi untuk dicocokkan: [peraturan.bpk.go.id UU 27/2022](https://peraturan.bpk.go.id/Details/229798/uu-no-27-tahun-2022).

| Topik | Isi menurut sumber | Dampak ke LINOE (untuk dikonfirmasi) |
|---|---|---|
| Dasar pemrosesan dan persetujuan | Pengendali wajib punya dasar pemrosesan (Pasal 20). Persetujuan harus eksplisit dan dapat dibuktikan/direkam (Pasal 21, 22, 24); klausul tanpa persetujuan sah batal (Pasal 23) | Checkbox pendaftaran ada, **bukti persetujuan tidak disimpan** (lihat bagian 1). Perlu keputusan: simpan bukti (versi teks, waktu, akun) atau dasar pemrosesan lain (kontrak). Butuh migrasi DB: **butuh persetujuan Founder**, di luar PR ini |
| Hak subjek data | Informasi, koreksi, akses/salinan, mengakhiri pemrosesan/penghapusan, menarik persetujuan, keberatan atas keputusan otomatis termasuk profil, menunda/membatasi, ganti rugi, portabilitas (Pasal 5-13) | Privasi bagian 9 mencantumkan akses/koreksi/hapus/tarik, tanpa jangka waktu. Tidak ada alat swalayan; semua manual lewat email |
| Tenggat penanganan | Koreksi dalam 3 x 24 jam (Pasal 30), akses (Pasal 32), berhenti memproses setelah persetujuan ditarik (Pasal 40) menurut ringkasan. PP 33/2026: permintaan pembaruan, akses, salinan, tarik persetujuan, pembatasan dalam 3 x 24 jam sejak diverifikasi (ringkasan SIP Law Firm) | **Konflik dengan teks sendiri**: `/data-deletion` menyatakan tanpa jangka waktu. Tenggat 3 x 24 jam untuk SOP internal perlu diputuskan (pertanyaan K3); halaman bukan file milik tugas ini |
| Penghapusan/pemusnahan | Hak mengakhiri pemrosesan dan menghapus (Pasal 8 menurut ringkasan, nomor pasal harus dicocokkan). Penghapusan yang dapat dikecualikan karena kewajiban hukum belum diverifikasi | `/data-deletion` sudah membahas data yang dapat dipertahankan dan akun login bersama |
| Notifikasi kegagalan pelindungan data (Pasal 46) | Tertulis paling lambat 3 x 24 jam kepada subjek dan lembaga; isi minimal: data terungkap, kapan dan bagaimana, penanganan dan pemulihan; ayat (3) pemberitahuan ke publik dalam hal tertentu. Lihat bagian 8 | SOP di SOFT_LAUNCH bagian 6.3 |
| Pemroses | Pemroses bertindak hanya atas instruksi pengendali (Pasal 51) | Lihat bagian 7 (DPA) |
| Pejabat PDP | Wajib ditunjuk pada kondisi berisiko tinggi (Pasal 53); Putusan MK 151/PUU-XXII/2024 mengubah "dan" menjadi "dan/atau" pada ayat (1) (ringkasan pasal.id dan SIP) | Penerapan ke 10 tenant: K6 |
| Transfer data ke luar Indonesia | Diatur Pasal 55-56 (syarat kecukupan/pelindungan memadai/persetujuan) | Penyedia AI/hosting kemungkinan memproses di luar negeri: K5 |
| Sanksi | Sanksi administratif (peringatan, penghentian sementara, penghapusan data, denda sampai 2% pendapatan tahunan menurut ringkasan PP 33/2026, Pasal 184-185), pidana Pasal 67-69 (ringkasan pasal.id) | Nilai risiko: konsultan |
| Lembaga PDP | Per September 2026 belum terbentuk penuh menurut pemberitaan; Pasal 58: lembaga ditetapkan Presiden | **PERLU KONFIRMASI**: kepada siapa notifikasi dikirim |

### 5.1 PP 33/2026 (pelaksana UU PDP)

| Hal | Isi menurut ringkasan | Status |
|---|---|---|
| Berlaku | Ditetapkan 16 Juli 2026; berlaku 16 Januari 2027 (Pasal 225). Pasal 223: pemrosesan tetap berjalan selama tidak bertentangan dengan PP | **TERVERIFIKASI SEKUNDER** ([SIP Law Firm](https://siplawfirm.id/resources/pp-33-2026-pelindungan-data-pribadi), [Veritask](https://veritask.ai/id/artikel/pengaturan-teknis-pelindungan-data-pribadi-dan-kewajiban-pengendali-serta-prosesor-akhirnya-terbit-lewat-pp-33-2026), [Meridian Hukum](https://meridianhukum.com/peraturan/pp-no-33-tahun-2026), [Katadata](https://katadata.co.id/amp/finansial/makro/6a9979b7c5745/pp-pelindungan-data-pribadi-berlaku-januari-2027-ini-aturan-baru-data-anak)), diakses 2026-11-11. Teks resmi **BELUM TERVERIFIKASI** |
| Dasar pemrosesan | Enam dasar, termasuk persetujuan eksplisit untuk tujuan tertentu (Pasal 30-31) | Sekunder (Veritask) |
| Catatan kegiatan pemrosesan (ROPA) | Wajib; memuat masa retensi, identitas prosesor dan pihak ketiga yang mengakses data | Sekunder (SIP). Veritask tidak menyebut ROPA |
| DPIA | Wajib sebelum pemrosesan berisiko tinggi; teknologi baru seperti AI menjadi pemicu; pemrosesan berskala besar dinilai kontekstual tanpa angka (Pasal 120-122 menurut Veritask) | Sekunder. Apakah fitur AI LINOE memicu DPIA: K6 |
| DPO | Wajib untuk pelayanan publik, pemantauan sistematis berskala besar, data spesifik/pidana berskala besar (Pasal 142-147 menurut Veritask) | Sekunder |
| Larangan klausul eksonerasi pengendali; tinjau Privasi dan dokumen onboarding vendor | Disebut SIP | Sekunder |
| Pengecualian UMKM/usaha kecil | **Tidak disebut** pada dua ringkasan | BELUM TERVERIFIKASI |
| Kesamaan nomor pasal | Ringkasan SIP dan Veritask memberi penomoran yang berbeda pada beberapa topik; jangan mengutip nomor pasal sebelum teks resmi dibuka | Peringatan |

## 6. Retensi data, hak subjek, dan persetujuan: status praktis

| Hal | Status |
|---|---|
| Masa retensi data yang **wajib** (umum): tidak ada angka tunggal yang diverifikasi. Teks PP 71/2019 yang dibaca di pasal.id membahas kriteria penghapusan data tidak relevan (nomor pasal 16 menurut halaman itu; retensi disinggung di Pasal 25) dan Permenkominfo 5/2020 menyebut rekam jejak audit (Pasal 43-44) tanpa jangka waktu | **TERVERIFIKASI SEKUNDER** (pasal.id) dan **PERLU KONFIRMASI**. Ketentuan retensi sektoral (pajak/akuntansi/invoice) dan Permenkominfo 20/2016 (data pribadi dalam sistem elektronik): **BELUM TERVERIFIKASI** |
| Retensi yang LINOE janjikan | Belum ada: Privasi bagian 8 menyatakan belum menetapkan jangka retensi tetap; `legal-meta.ts` melarang menambah angka sebelum diputuskan. PP 33/2026 menuntut retensi di ROPA (sekunder). **Keputusan Founder + konsultan**: tabel retensi per kategori (akun, konten tenant, log AI, log keamanan, invoice, cadangan) |
| Retensi di penyedia | Supabase: pengembalian/penghapusan data diminta dalam 30 hari setelah perjanjian berakhir ([DPA Supabase](https://supabase.com/legal/dpa), diakses 2026-11-11). OpenAI: periode retensi tidak tertulis di DPA, diatur konfigurasi pelanggan ([DPA OpenAI](https://openai.com/policies/data-processing-addendum/), diakses 2026-11-11). Retensi log Netlify: tidak diverifikasi (SOFT_LAUNCH bagian 8) |
| Persetujuan eksplisit | Checkbox ada; **bukti tidak disimpan** (bagian 1). Bila dasar pemrosesan = kontrak, persetujuan untuk pemrosesan inti mungkin tidak dibutuhkan; persetujuan terpisah mungkin perlu untuk pengiriman data ke penyedia AI/transfer dan pemasaran: K2 |
| Persetujuan data pelanggan akhir milik tenant (konten bebas) | Tenant yang memasukkan data pelanggan mereka kemungkinan pengendali; LINOE pemroses. Perlu DPA LINOE-tenant (belum ada) dan peringatan di UI: K1 |
| Hak subjek: kanal | Email perusahaan umum (`tanyopofuturetechnology@gmail.com`). PP 33/2026 (sekunder): permohonan lewat kanal elektronik yang mudah diakses, dengan verifikasi proporsional. Alamat khusus tanpa biaya: pertimbangkan (F8) |
| Anak | Terms mensyaratkan cukup umur; PP 33/2026 punya aturan data anak (Katadata). Penerapan: K8 |

## 7. DPA dengan pemroses (penyedia)

| Penyedia | Mekanisme DPA (menurut halaman penyedia) | Pelaporan insiden ke pelanggan | Catatan |
|---|---|---|---|
| **Supabase** | DPA menjadi bagian dari Terms/perjanjian; tidak ada langkah tanda tangan terpisah; menerima perjanjian setara menandatangani SCC (klausul 12.2). Halaman memuat "Versi 1, 1 Agustus 2026" | "Without undue delay" dan bila memungkinkan dalam 48 jam sejak mengetahui Security Incident terkonfirmasi (klausul 10) | Otorisasi umum sub-prosesor; pemberitahuan perubahan hanya bila pelanggan berlangganan notifikasi. SCC berpusat pada GDPR/Swiss (hukum Irlandia); **tidak** merujuk hukum Indonesia. Cara meminta salinan bertanda tangan tidak tertulis. **TERVERIFIKASI (resmi penyedia)**: [supabase.com/legal/dpa](https://supabase.com/legal/dpa), diakses 2026-11-11 |
| **OpenAI** | Berlaku saat pelanggan menyetujui, menerima Order Form, atau memakai layanan; tidak ada proses tanda tangan terpisah | "Tanpa penundaan yang tidak semestinya"; **tidak ada batas jam** | Daftar sub-prosesor di `platform.openai.com/subprocessors`; batas waktu menjawab permintaan subjek data dan retensi tidak tertulis. **TERVERIFIKASI (resmi penyedia)**: [openai.com/policies/data-processing-addendum](https://openai.com/policies/data-processing-addendum/), diakses 2026-11-11. Jenis akun yang LINOE pakai (API/bisnis) harus dicek Founder di dashboard |
| **Anthropic** | DPA dan SCC otomatis termasuk dalam Commercial Terms (Claude API, Claude for Work); produk konsumen berbeda | Batas jam **BELUM TERVERIFIKASI** (teks DPA di `anthropic.com/legal/data-processing-addendum` tidak terjangkau dari sesi ini; hanya halaman bantuan dibaca) | **TERVERIFIKASI (resmi penyedia)**: [privacy.claude.com, DPA](https://privacy.claude.com/en/articles/7996862-how-do-i-view-and-sign-your-data-processing-addendum-dpa), diakses 2026-11-11 |
| **Netlify** | DPA dapat diunduh dari Trust Center; cara menandatangani tidak dijelaskan; sub-prosesor utama di AS (AWS, GCP); region data pelanggan tidak dinyatakan | **BELUM TERVERIFIKASI** | **TERVERIFIKASI (resmi penyedia)** hanya untuk keberadaan DPA: [netlify.com/trust-center](https://www.netlify.com/trust-center.md), diakses 2026-11-11 |
| Layanan email, gateway pembayaran | Belum dikaji | BELUM TERVERIFIKASI | Daftar penyedia email yang dipakai: Founder isi |

Implikasi untuk SOP insiden (SOFT_LAUNCH bagian 6.3): batas 48 jam Supabase masih memungkinkan 3 x 24 jam LINOE, tetapi OpenAI/Netlify tidak punya batas jam tertulis. Pantau halaman status penyedia, jangan menunggu pemberitahuan.
Yang **tidak** ada: DPA LINOE-tenant (LINOE sebagai pemroses; PP 33/2026 menurut ringkasan Veritask mengatur isi minimal perjanjian pengendali-prosesor, Pasal 13-16). Rancangan ke konsultan: K1.
Yang **tidak** dijawab penyedia: kesesuaian SCC GDPR dengan syarat transfer UU PDP Pasal 56 (K5).

## 8. Pelaporan insiden

| Hal | Status | Rujukan |
|---|---|---|
| Pasal 46 UU PDP: notifikasi tertulis paling lambat 3 x 24 jam kepada subjek data dan lembaga; isi minimal ayat (2); ayat (3) publik dalam hal tertentu | **TERVERIFIKASI SEKUNDER** (kutipan ayat dibaca; halaman resmi BPK tidak terjangkau) | [pasal.id Pasal 46](https://pasal.id/peraturan/uu/uu-no-27-tahun-2022/pasal-46), diakses 2026-11-11 |
| Saat jam mulai | PP 33/2026 (sekunder): sejak kegagalan "diketahui secara pasti, patut, dan wajar" berdasarkan dokumentasi; prosesor lapor ke pengendali "pada kesempatan pertama"; setiap kegagalan wajib didokumentasikan (Pasal 114-119 menurut Veritask) | **PERLU KONFIRMASI.** Sikap hati-hati internal: hitung dari jam temuan |
| Penerima "lembaga" dan saluran | Lembaga belum terbentuk penuh (pemberitaan September 2026) | **PERLU KONFIRMASI** ([Bisnis.com, 8 Sep 2026](https://teknologi.bisnis.com/read/20260908/84/2002386/uu-dan-pp-sudah-ada-pengamat-aturan-pdp-belum-efektif-tanpa-lembaga); [Bisnis.com, 13 Sep 2026](https://teknologi.bisnis.com/read/20260913/84/2003698/pembentukan-badan-pdp-dipercepat-implementasi-uu-pdp-dinilai-belum-efektif), hanya hasil pencarian) |
| Kewajiban PSE melapor insiden siber ke otoritas sektor/BSSN | **BELUM TERVERIFIKASI** (tidak dikaji) | K4 |
| SOP dan templat | SOFT_LAUNCH_10_TENANTS.md bagian 6 | Fakta repo |

## 9. PJP Bank Indonesia

| Hal | Status | Rujukan |
|---|---|---|
| PJP = bank/lembaga selain bank yang memfasilitasi transaksi pembayaran; kegiatan berizin: penatausahaan sumber dana, penyediaan informasi sumber dana, inisiasi pembayaran dan/atau akuisisi, remitansi; kategori izin I/II/III menurut PBI 23/6/PBI/2021 (PBI 22/23/PBI/2020 untuk sistem pembayaran) | **TERVERIFIKASI (resmi)** | [BI, Perizinan Penyelenggara Jasa Sistem Pembayaran](https://www.bi.go.id/id/fungsi-utama/sistem-pembayaran/perizinan), diakses 2026-11-11 |
| Apakah LINOE perlu izin PJP bila menerima pembayaran langganan lewat gateway berizin (DOKU/Midtrans) sebagai merchant biasa, tanpa memegang/menyimpan dana pelanggan | **PERLU KONFIRMASI konsultan/BI.** Bacaan hati-hati: tidak termasuk, **selama LINOE tidak** mengelola saldo, wallet, top-up iklan, atau meneruskan dana. Keputusan bisnis Founder: pelanggan membayar iklan langsung ke Meta/TikTok, LINOE hanya menerima biaya layanan, tanpa saldo/wallet |
| Selama soft launch: tidak ada pembayaran riil | **Fakta repo** (`PAYMENT_LIVE_ENABLED` OFF), PJP tidak relevan sampai pembayaran diaktifkan; tinjau ulang sebelum aktivasi |
| Fitur dompet/penarikan Mitapeng | **Di luar lingkup LINOE**; kajian PJP sendiri sebelum rilis |

## 10. Dokumen yang harus disiapkan (siapkan, jangan ajukan)

Perusahaan: akta pendirian dan pengesahan, NPWP, NIB beserta daftar KBLI, identitas penanggung jawab, alamat/domisili, kontak teknis dan hukum.
Sistem: deskripsi singkat LINOE (alur, tipe data), domain/URL produksi (tiap domain didaftarkan sendiri; saat ini `*.netlify.app`), diagram aliran data (tenant, Supabase, penyedia AI, hosting, email), lokasi server penyedia, daftar penyedia dan perannya, jumlah pengguna.
Pelindungan data: Kebijakan Privasi dan Syarat final (tanggal berlaku), prosedur penghapusan (halaman `/data-deletion` + SOP bagian 7 soft launch), SOP insiden dan templat 3 x 24 jam (bagian 6.3), ROPA (apa, mengapa, dasar, penerima, retensi, keamanan), rancangan DPA tenant, salinan DPA penyedia (bagian 7).
Bukti keamanan yang sudah ada di repo (rujukan, bukan klaim sertifikasi): `docs/SECURITY.md`, header keamanan di `next.config.ts`, SOP backup di `docs/BACKUP_RESTORE.md`. **Jangan** menyatakan sertifikasi (ISO/SOC) yang tidak ada.
Operasional: kontak eskalasi terisi (RUNBOOK bagian 4), nama konsultan, arsip insiden.

## 11. Pengajuan/keputusan yang butuh Founder (tidak dilakukan di sini)

| # | Tindakan Founder | Dari HP? | Kapan |
|---|---|---|---|
| F1 | Putuskan tertulis: tunda undangan sampai tanda daftar PSE terbit, atau lanjut dengan risiko sadar (G9) | Ya | Sebelum undangan pertama |
| F2 | Cek NIB di OSS: nomor, daftar KBLI, kesesuaian dengan LINOE | Ya (oss.go.id di browser) | Segera |
| F3 | Bila perlu: ubah/tambah KBLI di OSS (konsultan bila ragu) | Ya | Sebelum F4 |
| F4 | Ajukan pendaftaran PSE Lingkup Privat lewat OSS, setelah isian terkini dikonfirmasi (formulir BELUM TERVERIFIKASI) | Ya | Sebelum pengguna eksternal (Pasal 2 ayat 3) |
| F5 | Pilih konsultan hukum/PDP; kirim bagian 12; minta jawaban tertulis | Ya | Sebelum tenant ke-11 atau pembayaran riil; idealnya sebelum undangan |
| F6 | Setujui teks final Privasi/Syarat dan tetapkan `effectiveDate` (perubahan kode lewat sesi Claude) | Ya (setujui) | Sebelum undangan |
| F7 | Tetapkan penanggung jawab data pribadi/DPO atau keputusan tidak menunjuk (dengan konsultan) | Ya | Sebelum 16 Jan 2027 bila PP 33/2026 terverifikasi |
| F8 | Putuskan kanal email dukungan; pertimbangkan alamat khusus tanpa biaya | Ya | Sebelum undangan |
| F9 | Sebelum pembayaran riil: konfirmasi status PJP/merchant, pajak, faktur, dan sinkronkan Privasi (nama penyedia pembayaran) | Ya | Sebelum aktivasi pembayaran |
| F10 | Di dashboard penyedia (HP): catat jenis akun/paket AI, Supabase, Netlify dan unduh DPA yang tersedia; catat region data | Ya | Sebelum konsultasi |
| F11 | Putuskan apakah bukti persetujuan pendaftaran disimpan (butuh migrasi DB; persetujuan eksplisit Founder, bukan dikerjakan di PR ini) | Ya (setujui) | Setelah jawaban K2 |

## 12. Pertanyaan untuk konsultan hukum

PSE
- K0. Apakah LINOE (SaaS pemasaran AI, 10 tenant undangan gratis) termasuk kategori Pasal 2 ayat (2) Permenkominfo 5/2020, dan apakah ada peraturan pengganti/perubahan setelah 2021 (Komdigi)? Apakah kegagalan mendaftar sebelum undangan pertama berisiko pemutusan akses, dan apakah ada peringatan terlebih dahulu?
- K0b. KBLI apa yang harus ada di NIB sebelum mendaftar, dan apakah isian OSS terkini meminta uji kelaikan sistem dan dokumen tambahan?

PDP
- K1. Peran LINOE terhadap data pelanggan tenant (pemroses) dan data akun tenant (pengendali). Isi DPA LINOE-tenant minimum; apakah klausul tenant sebagai pengendali perlu masuk Syarat.
- K2. Dasar pemrosesan yang tepat untuk akun, konten AI, dan pemasaran; perlukah persetujuan terpisah untuk pengiriman data ke penyedia AI; bentuk dan masa simpan bukti persetujuan.
- K3. Tenggat penanganan permintaan hak subjek dan penghapusan (3 x 24 jam menurut ringkasan) untuk operasi manual satu orang; apakah halaman `/data-deletion` yang menyatakan "tanpa jangka waktu" perlu diganti sebelum undangan.
- K4. Notifikasi insiden: titik awal 3 x 24 jam, penerima "lembaga" saat Lembaga PDP belum terbentuk, kewajiban lain (BSSN/sektoral) bagi PSE kecil.
- K5. Transfer data ke luar Indonesia (Netlify, Supabase, OpenAI, Anthropic): apakah DPA/SCC penyedia cukup di bawah UU PDP Pasal 56 dan PP 33/2026; apakah perlu pemberitahuan atau persetujuan; pengaruh pilihan region.
- K6. Apakah 10 tenant dengan fitur AI memicu DPIA, ROPA, dan pejabat PDP (UU PDP Pasal 53, Putusan MK 151/PUU-XXII/2024, PP 33/2026)? Apakah ada pengecualian skala kecil?
- K7. Tabel retensi yang aman per kategori data (akun, konten, log AI, log keamanan, invoice, cadangan), termasuk kewajiban retensi minimal (Permenkominfo 20/2016 dan ketentuan perpajakan) dan apakah angka retensi boleh dicantumkan di Privasi.
- K8. Data anak dan data sensitif dalam konten bebas tenant; kewajiban peringatan di UI.
- K9. Basis data Supabase dan akun login yang dipakai bersama produk Tanyopo lain: siapa pengendali, apakah perlu perjanjian antar-produk, dampaknya pada hak penghapusan dan notifikasi insiden.
- K10. Teks Privasi/Syarat: kecukupan terhadap PP 33/2026 (larangan klausul eksonerasi), pencantuman penyedia pembayaran dan tanggal berlaku.

## 13. Daftar sumber (akses 2026-11-11)

Resmi (pemerintah/otoritas): [Permenkominfo 5/2020 (JDIH Komdigi)](https://jdih.komdigi.go.id/produk_hukum/view/id/759/t/peraturan+menteri+komunikasi+dan+informatika+nomor+5+tahun+2020);
[PP 71/2019 (JDIH Komdigi; akses ulang gagal pada 2026-11-11)](https://jdih.komdigi.go.id/produk_hukum/view/id/695/t/peraturan+pemerintah+nomor+71+tahun+2019);
[Abstrak Permenkominfo 10/2021 (JDIH Komdigi)](https://jdih.komdigi.go.id/produk_hukum/unduh-abstrak/450);
[KBLI 73100 (OSS)](https://oss.go.id/en/kbli/detail/31ed304d-a3e6-4087-83aa-9c8e37d02fc7);
[KBLI 62019 (OSS)](https://oss.go.id/en/kbli/detail/5e8659f8-01e8-48d9-bceb-4af4015caa73);
[KBLI 62191 (OSS)](https://oss.go.id/en/kbli/detail/7fe22b1e-1c4a-585e-bf8c-83e080632031);
[PJP (Bank Indonesia)](https://www.bi.go.id/id/fungsi-utama/sistem-pembayaran/perizinan).
Penyedia (DPA): [Supabase DPA](https://supabase.com/legal/dpa); [OpenAI DPA](https://openai.com/policies/data-processing-addendum/); [Anthropic DPA (halaman bantuan)](https://privacy.claude.com/en/articles/7996862-how-do-i-view-and-sign-your-data-processing-addendum-dpa); [Netlify Trust Center](https://www.netlify.com/trust-center.md).
Resmi untuk dicocokkan, tidak terjangkau saat akses: [UU 27/2022 (peraturan.bpk.go.id)](https://peraturan.bpk.go.id/Details/229798/uu-no-27-tahun-2022).
Sekunder: [pasal.id UU 27/2022](https://pasal.id/peraturan/uu/uu-no-27-tahun-2022); [pasal.id Pasal 46](https://pasal.id/peraturan/uu/uu-no-27-tahun-2022/pasal-46); [pasal.id PP 71/2019](https://pasal.id/peraturan/pp/pp-no-71-tahun-2019);
[SIP Law Firm PP 33/2026](https://siplawfirm.id/resources/pp-33-2026-pelindungan-data-pribadi); [Veritask PP 33/2026](https://veritask.ai/id/artikel/pengaturan-teknis-pelindungan-data-pribadi-dan-kewajiban-pengendali-serta-prosesor-akhirnya-terbit-lewat-pp-33-2026);
[Meridian Hukum PP 33/2026](https://meridianhukum.com/peraturan/pp-no-33-tahun-2026); [Katadata PP PDP](https://katadata.co.id/amp/finansial/makro/6a9979b7c5745/pp-pelindungan-data-pribadi-berlaku-januari-2027-ini-aturan-baru-data-anak);
[izin.co.id PSE](https://izin.co.id/blog/apa-itu-pse-kominfo/); [SmartLegal PSE](https://smartlegal.id/pse/2025/11/17/cara-daftar-pse-kominfo-ini-prosedur-dasar-hukum-dan-persyaratannya-sl/).
Pendukung teknis (platform, bukan hukum): [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [Supabase rate limits](https://supabase.com/docs/guides/auth/rate-limits), [Supabase backups](https://supabase.com/docs/guides/platform/backups).

**Tidak terjangkau/BELUM TERVERIFIKASI (2026-11-11)**: teks resmi UU 27/2022 dan PP 33/2026; JDIH PP 71/2019 (akses ulang gagal); formulir terkini PSE di OSS dan `pse.komdigi.go.id` (di luar daftar akses/butuh login); siaran pers Komdigi (infopublik) dan artikel Bisnis.com tentang persetujuan (gagal dibuka); teks DPA Anthropic dan batas jam notifikasinya; DPA Netlify (hanya keberadaan); peraturan pengganti Permenkominfo 5/2020; Permenkominfo 20/2016; 20.000 karakter terakhir halaman Permenkominfo 5/2020.
