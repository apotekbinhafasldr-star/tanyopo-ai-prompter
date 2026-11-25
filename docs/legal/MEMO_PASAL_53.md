# Memo Analisis: Kewajiban Penunjukan Pejabat/Petugas PDP (UU 27/2022 Pasal 53-54)

> **STATUS: DRAF analisis internal. Bukan nasihat hukum. Perlu konfirmasi konsultan.**
> Tanggal sumber diakses: 24 November 2026. Penetapan akhir adalah keputusan Founder bersama konsultan.

## 1. Kesimpulan ringkas

Berdasarkan fakta yang tercatat, kewajiban Pasal 53(1) **belum terpicu** pada saat ini. Kesimpulan ini **perlu dikonfirmasi konsultan**, terutama tafsir "skala besar", "pelayanan publik", dan penerapan huruf b/c terhadap peran prosesor. Dianjurkan menetapkan Penanggung Jawab PDP (Sementara) sebagai praktik tata kelola, bukan sebagai pemenuhan Pasal 53 (lihat `SK_PENANGGUNG_JAWAB_PDP_SEMENTARA.md`).

## 2. Bunyi pasal

Sumber: JDIH Komdigi; penomoran ayat/huruf dilengkapi dari salinan sekunder karena halaman sumber menghilangkan penomoran.

**Pasal 53**
(1) Pengendali Data Pribadi dan Prosesor Data Pribadi wajib menunjuk pejabat atau petugas yang melaksanakan fungsi Pelindungan Data Pribadi dalam hal:
 a. pemrosesan Data Pribadi untuk kepentingan pelayanan publik;
 b. kegiatan inti Pengendali Data Pribadi memiliki sifat, ruang lingkup, dan/atau tujuan yang memerlukan pemantauan secara teratur dan sistematis atas Data Pribadi dengan skala besar; dan
 c. kegiatan inti Pengendali Data Pribadi terdiri dari pemrosesan Data Pribadi dalam skala besar untuk Data Pribadi yang bersifat spesifik dan/atau Data Pribadi yang berkaitan dengan tindak pidana.
(2) Pejabat atau petugas ... ditunjuk berdasarkan profesionalitas, pengetahuan mengenai hukum, praktik Pelindungan Data Pribadi, dan kemampuan untuk memenuhi tugas-tugasnya.
(3) Pejabat atau petugas ... dapat berasal dari dalam dan/atau luar Pengendali Data Pribadi atau Prosesor Data Pribadi.

**Pasal 54**
(1) Pejabat atau petugas ... memiliki tugas paling sedikit:
 a. menginformasikan dan memberikan saran kepada Pengendali ... atau Prosesor ... agar mematuhi ketentuan dalam Undang-Undang ini;
 b. memantau dan memastikan kepatuhan terhadap Undang-Undang ini dan kebijakan Pengendali ... atau Prosesor ...;
 c. memberikan saran mengenai penilaian dampak Pelindungan Data Pribadi dan memantau kinerja Pengendali ... dan Prosesor ...; dan
 d. berkoordinasi dan bertindak sebagai narahubung untuk isu yang berkaitan dengan pemrosesan Data Pribadi.
(2) Dalam melaksanakan tugas ..., pejabat atau petugas ... memperhatikan risiko terkait pemrosesan Data Pribadi, dengan mempertimbangkan sifat, ruang lingkup, konteks, dan tujuan pemrosesan.
(3) Ketentuan lebih lanjut ... diatur dalam Peraturan Pemerintah.

Penjelasan Pasal 53 (menurut sumber): pejabat atau petugas adalah yang bertanggung jawab memastikan pemenuhan kepatuhan atas prinsip Pelindungan Data Pribadi dan mitigasi risiko pelanggaran.

Elemen terkait: Pasal 4(2) mendefinisikan Data Pribadi spesifik (kesehatan, biometrik, genetika, catatan kejahatan, anak, keuangan pribadi, dan lainnya menurut peraturan). Pasal 34(2) memuat kriteria pemrosesan berisiko tinggi.

## 3. Putusan MK 151/PUU-XXII/2024

- Diucapkan 30 Juli 2025. Menurut berita resmi MKRI, kata "dan" pada Pasal 53 ayat (1) huruf b tidak mempunyai kekuatan hukum mengikat secara bersyarat sepanjang tidak dimaknai "dan/atau".
- Akibat: huruf a, b, c adalah kriteria **alternatif**. Terpenuhinya salah satu sudah mewajibkan penunjukan.
- Catatan sumber: teks amar verbatim dari putusan lengkap belum diekstrak; baru dari berita MKRI. Label: V (berita resmi), amar verbatim: KONS.
- Dasar analisis ini adalah Pasal 53-54 dan putusan MK. PP 33/2026 tidak dipakai sebagai dasar.

## 4. Fakta yang dipakai

SaaS AI untuk pemasaran UMKM; tahap soft-launch dengan tenant yang sangat sedikit (sekitar sepuluh atau kurang); data: akun, teks bebas tenant, referensi pelanggan akhir, token koneksi platform iklan; memakai penyedia AI pihak ketiga; tidak ada profiling individu. **Fakta ini belum diaudit ulang** (tidak ada akses basis data produksi saat memo disusun).

## 5. Penilaian tiga kondisi

| Kondisi | Penilaian | Alasan | Pemicu tinjau ulang |
|---|---|---|---|
| (a) Pemrosesan untuk kepentingan pelayanan publik | Tidak, menurut fakta | Layanan swasta untuk UMKM; tidak ada kontrak instansi pemerintah. Definisi "pelayanan publik" tidak ditemukan pada teks yang dibaca (UNKNOWN) | Tenant instansi/BUMN/pemda; layanan atas nama pemerintah |
| (b) Kegiatan inti memerlukan pemantauan teratur dan sistematis atas Data Pribadi berskala besar | Tidak pada saat ini, dengan ketidakpastian | Inti LINOE adalah pembuatan konten dan otomasi iklan; tidak ada pelacakan perilaku individu. Data atribusi konversi milik tenant dapat dibaca sebagai "pemantauan" bila memuat jejak perilaku pelanggan akhir. "Skala besar" tidak didefinisikan di UU dan ambang resmi tidak ditemukan (UNKNOWN); jumlah tenant saat ini kecil | Pertumbuhan jumlah subjek akhir; pelacakan lintas kanal; ingest piksel/CAPI |
| (c) Kegiatan inti berupa pemrosesan berskala besar atas data spesifik/tindak pidana | Tidak, menurut fakta, dengan celah teks bebas | LINOE tidak sengaja mengumpulkan data spesifik. Teks bebas tenant dapat memuat data spesifik secara tidak sengaja. Data kartu tidak disimpan LINOE (verifikasi Founder diperlukan) | Fitur memproses data spesifik; kegagalan guardrail larangan unggah di Syarat/Privasi/UI |

Catatan teks: huruf b dan c menyebut "kegiatan inti Pengendali". LINOE berperan ganda (pengendali untuk akun tenant; prosesor untuk data pelanggan akhir). Apakah huruf b/c berlaku bagi peran prosesor tidak jelas dari teks. Pertanyaan untuk konsultan.

## 6. Kewajiban hukum vs praktik baik

| Hal | Status |
|---|---|
| Menunjuk pejabat/petugas PDP | Wajib hanya bila satu kondisi terpenuhi; saat ini belum terpicu (perlu konfirmasi konsultan) |
| Narahubung PDP yang jelas | Praktik baik yang kuat; menopang kewajiban lain: tenggat 3 x 24 jam pada Pasal 30, 32, 40, 41, 46; Pasal 31 (RoPA); Pasal 24 (bukti persetujuan) |
| Kontak PDP publik | Kanal hak subjek harus tersedia; bentuk publikasi kontak PDP tidak diwajibkan oleh ketentuan terverifikasi |
| Memo analisis tertulis | Sangat dianjurkan sebagai bukti akuntabilitas |
| Independensi | Teks Pasal 53-54 tidak memuat syarat independensi. Jangan mengklaim independen |

Bolehkah pihak internal (termasuk Founder) menjadi penanggung jawab sementara? Pasal 53(3) membolehkan dari dalam. Risiko: konflik kepentingan (pengambil keputusan pemrosesan mengawasi dirinya sendiri) dan pembuktian kualifikasi Pasal 53(2). Mitigasi: sebutan "Penanggung Jawab PDP (Sementara)", SK tertulis, review konsultan berkala, pencatatan keputusan berisiko tinggi.

## 7. Opsi

| | Opsi 1: penanggung jawab internal sementara + SK + rencana konsultan | Opsi 2: konsultan/pihak eksternal | Opsi 3: tidak menunjuk; analisis tertulis saja |
|---|---|---|---|
| Kelebihan | Murah, cepat | Pengetahuan hukum, lebih independen | Paling murah; sah bila kondisi Pasal 53 tidak terpenuhi |
| Kekurangan | Konflik kepentingan; kualifikasi harus dibuktikan | Biaya retainer: UNKNOWN; perlu perjanjian kerahasiaan | Tidak ada narahubung bernama |
| Syarat | SK, reviewer konsultan, kontak privasi, log keputusan | Kontrak jasa, akses terbatas | Memo bertanggal, tinjau berkala |

Rekomendasi agen (bukan penetapan): memo ini (Opsi 3) sekarang, ditambah Opsi 1 berlabel jelas, dan rencana ke Opsi 2 sebelum salah satu pemicu tinjau ulang. Keputusan: Founder.

## 8. Pemicu tinjau ulang
Tenant berbayar bertambah signifikan atau jumlah pelanggan akhir signifikan; tenant instansi publik; pemrosesan data spesifik; insiden pertama; permintaan tenant korporasi; terbitnya peraturan turunan Pasal 54(3); terbentuknya lembaga PDP; hasil konsultasi tafsir "skala besar". Tinjau juga paling lambat tiap 6 bulan.

## 9. Hal yang butuh konsultan
1. Tafsir "skala besar" dan "pelayanan publik".
2. Penerapan huruf b/c pada peran prosesor.
3. Amar putusan MK verbatim.
4. Peraturan turunan Pasal 54(3) dan status lembaga PDP.
