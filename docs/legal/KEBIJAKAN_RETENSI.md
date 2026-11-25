# Kebijakan Retensi Data (DRAF)

> **STATUS: DRAF. MENUNGGU PERSETUJUAN FOUNDER. Belum berlaku, belum diadopsi, belum ditinjau konsultan.**
> Bukan nasihat hukum. Seluruh angka operasional di bawah adalah REKOMENDASI, bukan keputusan Founder dan bukan kewajiban hukum.
> Tanggal dasar penyusunan: 24 November 2026.

## 1. Cara membaca

Label dasar:

| Label | Arti |
|---|---|
| **HUKUM** | Ketentuan peraturan yang sudah terverifikasi terhadap teks resmi (daftar di bagian 2). Hanya ini yang boleh disebut "kewajiban hukum". |
| **OPS** | Pilihan operasional/minimisasi data. Bukan kewajiban hukum; dapat diubah Founder. |
| **KONS** | Perlu konfirmasi konsultan hukum/akuntan sebelum dipakai sebagai angka tetap. |
| **UNKNOWN** | Fakta belum diketahui (mis. retensi vendor). Tidak boleh diklaim sampai dicek. |

Kolom "biaya penyimpanan" bersifat kualitatif/ordo. Tidak ada harga vendor yang dikarang. Bila tidak diketahui ditulis "UNKNOWN: cek dashboard".

## 2. Dasar hukum yang dipakai (hanya yang terverifikasi)

| Kode | Ketentuan | Isi yang dipakai | Label |
|---|---|---|---|
| H1 | UU 8/1997 tentang Dokumen Perusahaan, Pasal 11(1) | Dokumen keuangan (catatan, pembukuan) disimpan 10 tahun | HUKUM |
| H2 | UU 27/2022 (UU PDP), Pasal 24 | Pengendali wajib dapat menunjukkan bukti persetujuan (lama penyimpanan bukti tidak ditetapkan angka di sini) | HUKUM |
| H3 | UU 27/2022, Pasal 43-44 | Penghapusan dan pemusnahan Data Pribadi. **Tidak ada tenggat 3x24 jam** pada pasal ini | HUKUM |
| H4 | UU 27/2022, Pasal 31 | Wajib merekam kegiatan pemrosesan (dasar RoPA; RoPA memuat retensi) | HUKUM |

Yang SENGAJA tidak dipakai sebagai dasar:

| Ketentuan | Alasan | Label |
|---|---|---|
| PP 33/2026 | Tidak terverifikasi dari sumber resmi | Tidak dipakai |
| Permenkominfo 20/2016 Pasal 15 (penyimpanan 5 tahun) | Bunyi dan status berlaku terhadap UU PDP belum dipastikan; bertentangan dengan minimisasi bila dipakai untuk semua data | UNKNOWN (belum dipakai) |
| UU KUP (UU 28/2007) Pasal 28(11) pasca-UU HPP | Redaksi pasca-perubahan belum terverifikasi | KONS |
| Angka retensi "log 1 tahun", "bukti consent 3 tahun" sebagai kewajiban | Tidak ada dasar terverifikasi | Hanya OPS |

## 3. Tabel retensi (rekomendasi)

Semua baris: **status MENUNGGU PERSETUJUAN FOUNDER**.

| ID | Kategori | Usulan | Dasar | Alasan | Risiko bila diterapkan / tidak | Biaya penyimpanan |
|---|---|---|---|---|---|---|
| RT-01 | Akun/autentikasi (email, nama, ID auth) | Selama akun aktif + 30 hari masa tenggang pemulihan, lalu hapus/anonimkan data LINOE | OPS; prinsip hapus bila tidak diperlukan: HUKUM (H3); angka 5 tahun Permenkominfo 20/2016: UNKNOWN | Minimisasi; 30 hari memberi ruang pemulihan akun | Terlalu pendek: pengguna tidak bisa memulihkan akun. Terlalu panjang: melanggar prinsip batas penyimpanan. Konflik dengan aturan 5 tahun (bila ternyata berlaku): KONS | Rendah (data teks kecil) |
| RT-02 | Profil brand, katalog produk, media milik tenant | Selama akun aktif; hapus paling lama 30 hari setelah penutupan atau permintaan | OPS | Aset milik tenant; tidak perlu setelah akun ditutup | Tenant kehilangan aset bila tidak sempat mengambil: sediakan cara ekspor (saat ini belum tersedia) | Menengah (berkas media lebih besar dari teks); UNKNOWN: cek dashboard penyimpanan |
| RT-03 | Kampanye dan konten | Selama akun aktif + 90 hari setelah penutupan, lalu hapus | OPS | Arsip pemulihan | Lebih pendek boleh; lebih panjang menambah data tersimpan | Rendah-menengah |
| RT-04 | Riwayat job AI (masukan/keluaran teks bebas) | 90 hari bergulir; tenant dapat menghapus lebih awal; jangan simpan permanen | OPS | Teks bebas dapat memuat data pribadi tidak sengaja; riwayat dibutuhkan untuk kuota/biaya | Mengurangi riwayat dapat memengaruhi perhitungan kuota: pisahkan metadata kuota dari isi. Retensi di sisi vendor AI: UNKNOWN (cek per vendor) | Rendah-menengah |
| RT-05 | Catatan audit aktivitas | 12 bulan; tanpa muatan sensitif | OPS | Keamanan dan pembuktian | Bila dibutuhkan sebagai bukti insiden, tahan sampai selesai. Catatan: klien aplikasi tidak memiliki hak ubah/hapus, tetapi pemilik sistem/service role tetap dapat mengubah dan catatan ikut terhapus bila tenant dihapus (cascade). Jangan disebut "tidak dapat diubah" | Rendah |
| RT-06 | Invoice, langganan, bukti pembayaran, pembukuan | 10 tahun (catatan transaksi dan invoice; bukan data kartu, yang tidak disimpan LINOE) | **HUKUM** (H1). Dokumen pajak: UU KUP Pasal 28(11) pasca-HPP = KONS | Kewajiban penyimpanan dokumen keuangan | Menghapus lebih awal: melanggar H1. Pisahkan dari data akun, batasi aksesnya; setelah akun dihapus simpan seminimal mungkin | Rendah (catatan teks); UNKNOWN: cek dashboard |
| RT-07 | Token OAuth platform iklan | Hapus saat disconnect, penutupan akun, atau kedaluwarsa; cabut segera bila dicurigai bocor | OPS (minimisasi); prinsip hapus: HUKUM (H3) | Token tidak boleh disimpan bila tidak dipakai | Kegagalan menghapus menambah dampak bila terjadi insiden | Sangat rendah |
| RT-08 | Konversi/atribusi (`customer_reference`, `order_reference`) | 90 hari; batas atas lebih panjang hanya atas instruksi tenant dan setelah konfirmasi konsultan; pseudonim/hash bila memungkinkan | OPS; batas atas KONS | LINOE berperan prosesor; ikuti instruksi tenant | Pendek mengurangi nilai atribusi bagi tenant | Rendah |
| RT-09 | Payload webhook mentah | 14 hari untuk debug; simpan ID event untuk anti-replay seperlunya | OPS | Payload dapat memuat data pribadi | Terlalu pendek mempersulit investigasi. ID event/anti-replay tidak dihapus saat penghapusan data (lihat bagian 5) | Rendah |
| RT-10 | Bukti persetujuan / penerimaan pemberitahuan | Selama hubungan berjalan + usulan 3 tahun setelah penarikan/penutupan | Kewajiban memiliki bukti: **HUKUM** (H2). Lama simpan: OPS/KONS (tidak ada angka hukum) | Pembuktian akuntabilitas | Jangan mengklaim "wajib 3 tahun". Mekanisme perekaman bukti: **belum tersedia** saat ini | Sangat rendah |
| RT-11 | Log aplikasi dan platform (hosting, database) | 30-90 hari, atau default vendor bila lebih pendek | OPS; default vendor: UNKNOWN: cek dashboard | Operasional dan investigasi | Hindari PII/token di log | UNKNOWN: cek dashboard |
| RT-12 | Cadangan (backup) | Maksimum mengikuti jendela vendor (usulan batas 30 hari); penghapusan data bergulir mengikuti siklus cadangan | OPS; jendela vendor: UNKNOWN | Pemulihan bencana | Data terhapus dapat bertahan di cadangan sampai rotasi; harus diungkapkan di Privasi | UNKNOWN: cek dashboard |
| RT-13 | Register permintaan hak subjek | 3 tahun sejak penyelesaian (metadata saja, bukan salinan data) | OPS/KONS | Bukti kepatuhan | Tanpa angka hukum | Sangat rendah |
| RT-14 | Sesi demo | 7-30 hari lalu hapus; jangan pakai data pelanggan nyata | OPS | Data demo sintetis | - | Sangat rendah |
| RT-15 | Register insiden dan permintaan aparat | UNKNOWN | UNKNOWN/KONS | Belum ada dasar angka terverifikasi | Tahan selama ada proses terkait | Sangat rendah |
| RT-16 | Data staf/admin internal (akses, audit keuangan) | UNKNOWN; data pembukuan mengikuti RT-06 | KONS | Perlu penilaian konsultan/akuntan | - | Sangat rendah |
| RT-17 | Telemetri produk | Saat ini tidak aktif. Bila diaktifkan: tentukan ulang sebelum aktif | UNKNOWN | - | Wajib masuk Privasi dan RoPA saat aktif | - |

## 4. Hal yang perlu konfirmasi konsultan (KONS)

1. Status dan bunyi Permenkominfo 20/2016 Pasal 15 terhadap UU PDP (5 tahun vs minimisasi).
2. Redaksi UU KUP Pasal 28(11) setelah UU HPP untuk dokumen pajak.
3. Lama penyimpanan bukti persetujuan dan register hak subjek.
4. Batas atas retensi data konversi atas instruksi tenant.

## 5. Yang TIDAK dihapus saat penghapusan data tenant/akun

Perlindungan berikut dipertahankan, dengan alasan integritas keuangan, keamanan, dan pencegahan penyalahgunaan:

| Kategori | Alasan |
|---|---|
| Buku besar keuangan | Kewajiban dokumen keuangan (H1) |
| Peringatan pembayaran | Integritas dan jejak keuangan |
| Mekanisme anti-replay webhook (ID event) | Mencegah pemrosesan ganda pembayaran |
| Emergency Stop dan kontrol anggaran | Kontrol keamanan dan keuangan |
| Akun login (`auth.users`) | Dibagi dengan produk Tanyopo lain; **tidak dihapus oleh LINOE**. Penghapusan akun login adalah permintaan terpisah yang dinilai tersendiri |

## 6. Hal yang belum tersedia (jangan dijanjikan ke publik)

- Job penghapusan/purge otomatis terjadwal: **belum tersedia** (target implementasi, perlu persetujuan sesuai aturan perubahan produksi).
- Ekspor data mandiri oleh pengguna: **belum tersedia**.
- Perekaman bukti persetujuan dan penerimaan syarat: **belum tersedia**.
- Pernyataan di Privasi cukup berbentuk: "Kami menyimpan data selama diperlukan untuk layanan dan kewajiban hukum; dokumen keuangan disimpan sesuai ketentuan peraturan perundang-undangan." Halaman publik boleh menyebut "umumnya 10 tahun" HANYA untuk dokumen keuangan (HUKUM, H1); jangan menyebut dokumen pajak (KONS) dan jangan mencantumkan angka operasional sebelum disetujui Founder.

## 7. Langkah berikutnya

1. Founder meninjau dan memutuskan tiap angka (status berubah dari "MENUNGGU PERSETUJUAN FOUNDER" hanya oleh Founder).
2. Founder mengisi retensi vendor dari dashboard masing-masing (kolom UNKNOWN).
3. Konsultan menjawab butir bagian 4.
4. Implementasi teknis (penghapusan terjadwal) hanya setelah persetujuan tertulis sesuai aturan perubahan.
