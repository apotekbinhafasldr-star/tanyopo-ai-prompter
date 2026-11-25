# SOP Penanganan Insiden dan Notifikasi Kegagalan Pelindungan Data Pribadi (DRAF)

> **STATUS: DRAF. Belum diuji (tabletop belum dilakukan), belum diadopsi. Bukan nasihat hukum.**
> Pasangan: `docs/RUNBOOK.md`, `RoPA.md`, `KEBIJAKAN_RETENSI.md`. Dapat dijalankan dari ponsel.

## 1. Fakta hukum dan status verifikasi

| Hal | Status |
|---|---|
| UU 27/2022 Pasal 46(1): pemberitahuan **tertulis** paling lambat **3 x 24 jam** kepada (a) Subjek Data Pribadi dan (b) lembaga | V |
| Pasal 46(2): isi minimal: data pribadi yang terungkap; kapan dan bagaimana terungkap; upaya penanganan dan pemulihan | V |
| Pasal 46(3): dalam hal tertentu pengendali juga memberitahu masyarakat | Ayat: V. Penjelasan: KONS |
| Pasal 50: pengecualian tertentu | KONS (hanya dengan dasar tertulis konsultan) |
| **Titik mulai hitung 3 x 24 jam** | **UNKNOWN**: tidak tertulis pada Pasal 46. Sikap hati-hati SOP ini: hitung dari saat insiden DIKETAHUI (T0). Keputusan akhir: KONS |
| **"Lembaga" penerima dan saluran notifikasi** | **UNKNOWN**. Jangan mengarang alamat. Konsultan/otoritas harus memastikan sebelum insiden pertama |
| Kewajiban prosesor memberi tahu pengendali (batas jam) | Tidak ada angka di pasal yang dibaca. Target internal 24 jam, ditetapkan dalam perjanjian dengan tenant (KONS) |
| Angka retensi catatan insiden | UNKNOWN (lihat RT-15) |

Dokumen ini tidak memakai PP 33/2026 sebagai dasar.

## 2. Peran dan kontak

| Peran | Tugas | Pemegang | Kontak |
|---|---|---|---|
| Pemimpin Insiden | Memutuskan tingkat keparahan, penahanan, notifikasi | Founder | [DIISI FOUNDER] |
| **Kontak cadangan** | Mengambil alih bila Pemimpin tidak dapat dihubungi dalam 2 jam (usulan) | [DIISI FOUNDER] | [DIISI FOUNDER] (gunakan kanal selain email) |
| Teknis | Penahanan, log, pemulihan | Founder atau pihak yang ditunjuk; agen AI hanya atas persetujuan | [DIISI FOUNDER] |
| Hukum/PDP | Menilai kewajiban notifikasi, menyetujui teks | Konsultan / Penanggung Jawab PDP (Sementara) | [DIISI FOUNDER] |
| Komunikasi tenant | Mengirim notifikasi | Pemimpin Insiden | [DIISI FOUNDER] (kotak surat khusus privasi) |

Catatan: titik gagal tunggal pada kontak harus diselesaikan sebelum tenant eksternal. Catat jam T0 dalam WIB.

## 3. Deteksi

| Sumber | Contoh sinyal |
|---|---|
| Aplikasi | Endpoint kesehatan; sistem peringatan pembayaran |
| Platform | Log hosting dan database; pemberitahuan keamanan vendor |
| Tenant/pengguna | Email: "data saya terlihat orang lain", "email aneh dari LINOE" |
| Vendor | Pemberitahuan insiden vendor (bagian 8) |
| Peneliti eksternal | Laporan kerentanan lewat kanal yang tercantum di `docs/SECURITY.md` |
| Internal | Salah kirim, perangkat hilang, akses tidak sah |

Siapa pun yang mencurigai insiden melapor segera ke Pemimpin Insiden, tidak menghapus bukti, dan tidak mengonfrontasi pelaku.

## 4. Klasifikasi

### 4.1 Pohon keputusan "Kegagalan PDP?"
1. Apakah data pribadi terkena? Bila tidak (hanya ketersediaan tanpa dampak data): insiden operasional, selesai di RUNBOOK.
2. Apakah terjadi, atau patut diduga terjadi, kehilangan, pengungkapan, perubahan, akses tidak sah, atau ketidaktersediaan data pribadi? Bila ya: kegagalan PDP potensial; hitungan 3 x 24 jam berjalan dari T0 (sikap hati-hati).
3. Bila dampak kecil dan terbukti tidak ada pihak luar yang mengakses: keputusan "tidak perlu notifikasi" dicatat tertulis dengan bukti oleh Pemimpin Insiden dan ditinjau konsultan.

### 4.2 Tingkat keparahan
| Sev | Contoh (kategori) | Respons | Notifikasi PDP |
|---|---|---|---|
| 1 | Data satu tenant terlihat tenant lain; kebocoran kredensial/token; akun administrasi dikuasai pihak lain; berkas publik memuat data pribadi; pembayaran atau iklan berjalan tanpa izin | Segera; konsultan hari yang sama | Hampir pasti; jam berjalan |
| 2 | Aplikasi mati lama tanpa dampak data; email terkirim ke orang salah (data terbatas) | RUNBOOK; eskalasi Founder | Nilai dengan pohon 4.1 |
| 3 | Lonjakan tidak wajar; bug satu tenant tanpa pengungkapan; permintaan hak subjek | Hari kerja | Umumnya tidak |

Faktor kenaikan: jumlah subjek, data spesifik, kredensial, bukti eksfiltrasi, insiden berlanjut.

## 5. Alur dan jam (T0 = saat diketahui)

| Waktu | Langkah | Pemilik |
|---|---|---|
| T0 | Catat jam WIB, penemu, sumber; buka baris register | Penemu/Pemimpin |
| T0 + 1 jam | Triase dan klasifikasi; beri nomor insiden | Pemimpin |
| Segera | **Penahanan**: cabut kredensial yang diduga bocor, putar kunci (butuh persetujuan Founder), batasi akses berkas, isolasi akun, rollback. **Awetkan bukti dulu** (tangkapan layar log, jam, tenant terdampak) | Teknis |
| T0 + 4 jam | Ukur dampak: kategori data, subjek, perkiraan jumlah, sejak kapan, apakah masih berlangsung | Teknis + Pemimpin |
| T0 + 6 jam | Bila data pelanggan akhir tenant terdampak (LINOE prosesor): beri tahu tenant (template 7.3; target 24 jam dari T0) | Pemimpin |
| T0 + 12 jam | Libatkan konsultan/Penanggung Jawab PDP; putuskan penerima, kanal lembaga, isi | Pemimpin + Konsultan |
| T0 + 36 jam (internal) | Keputusan notifikasi dicatat dengan alasan | Pemimpin |
| **Paling lambat T0 + 72 jam** | Kirim notifikasi tertulis ke subjek terdampak dan lembaga (Pasal 46(1)), isi minimal Pasal 46(2). Bila info belum lengkap: kirim yang diketahui, lengkapi menyusul | Pemimpin |
| Setelah itu | Notifikasi publik bila memenuhi "hal tertentu" (Pasal 46(3)); keputusan konsultan | Konsultan |
| T0 + 14 hari (usulan) | Tinjauan pasca-insiden; perbarui RoPA dan RUNBOOK | Pemimpin |

72 jam adalah jam kalender, bukan hari kerja. Pengecualian Pasal 50 hanya dengan dasar tertulis konsultan.

## 6. Dua peran LINOE

| Situasi | LINOE sebagai | Notifikasi |
|---|---|---|
| Data akun, penagihan, keamanan, staf | Pengendali | Langsung ke subjek dan lembaga (Pasal 46) |
| Data pelanggan akhir tenant dan isi konten tenant | Prosesor (KONS) | Beri tahu tenant dulu dan secepatnya; tenant memutuskan notifikasi; LINOE membantu. Bila konsultan menilai LINOE ikut pengendali, jalur pengendali juga berlaku |
| Tidak jelas | | Perlakukan sebagai pengendali dan beri tahu tenant |

## 7. Template notifikasi

Jangan dikirim sebelum Founder dan konsultan menyetujui. Jangan menyertakan data pribadi lain. Jangan menulis nomor registrasi PSE/TDPSE yang belum diverifikasi.

### 7.1 Ke Subjek Data
```
Subjek: Pemberitahuan insiden keamanan data pribadi pada LINOE (No. [INS-...])
Yth. [nama/pemilik akun],
1. Data pribadi Anda yang terungkap/terpengaruh: [kategori, bukan nilai data].
2. Kapan dan bagaimana: ditemukan [tanggal jam WIB]; diperkirakan terjadi [tanggal jam]; penyebab sementara: [ringkas, tanpa spekulasi].
3. Yang sudah kami lakukan untuk menangani dan memulihkan: [langkah].
4. Yang kami sarankan Anda lakukan: [ganti kata sandi, cabut izin aplikasi di akun platform iklan, waspada penipuan mengatasnamakan LINOE; kami tidak pernah meminta kata sandi].
5. Kontak: [DIISI FOUNDER], jam layanan [DIISI FOUNDER].
Informasi tambahan akan kami sampaikan bila ada pembaruan.
```
### 7.2 Ke Lembaga (alamat/kanal: DIKONFIRMASI KONSULTAN, jangan dikarang)
```
Kepada: [lembaga/kanal resmi: ISI SETELAH KONFIRMASI]
Dari: PT Tanyopo Future Technology (LINOE), [alamat dan kontak: DIISI FOUNDER]
Perihal: Pemberitahuan kegagalan Pelindungan Data Pribadi (Pasal 46 UU 27/2022), No. [INS-...]
1. Data pribadi yang terungkap: [kategori, perkiraan jumlah subjek dan rekaman].
2. Kapan dan bagaimana: [waktu diketahui, perkiraan waktu terjadi, cara, status].
3. Upaya penanganan dan pemulihan: [langkah, jadwal, langkah bagi subjek].
4. Subjek telah/belum diberi tahu pada [waktu]; pemberitahuan publik: [ya/tidak, alasan].
5. Kontak: [DIISI FOUNDER].
```
### 7.3 Ke Tenant (LINOE sebagai prosesor)
```
Subjek: [SEGERA] Insiden keamanan pada layanan LINOE yang memengaruhi data yang Anda kendalikan (No. [INS-...])
Yth. [pemilik workspace],
Dalam kapasitas kami sebagai pemroses atas data pelanggan akhir Anda, kami memberi tahu bahwa pada [waktu WIB] kami mengetahui [uraian ringkas].
1. Data yang terdampak: [kategori, fitur, perkiraan jumlah rekaman milik workspace Anda].
2. Kapan dan bagaimana: [waktu, penyebab sementara, status].
3. Yang sudah kami lakukan: [penahanan, pemulihan].
4. Yang kami butuhkan dari Anda: [keputusan mengenai pemberitahuan kepada subjek dan lembaga; Pasal 46 mengatur batas 3 x 24 jam; kami siap membantu menyusun isi].
5. Bantuan LINOE: [log/ringkasan yang dapat kami berikan; kontak DIISI FOUNDER].
```
### 7.4 Publik (bila Pasal 46(3) berlaku)
Teks pendek di situs/aplikasi; isi mengikuti 7.1 tanpa nama. Keputusan konsultan.

### 7.5 Tambahan/penutupan
Rujuk nomor insiden; apa yang baru; status pemulihan; langkah pencegahan.

## 8. Kontak vendor

Banyak vendor menyatakan akan memberi tahu pelanggan dalam jangka tertentu (mis. 48 jam) menurut dokumen DPA masing-masing; ini harus diverifikasi Founder dari dokumen vendor (KONS). Jam LINOE tidak menunggu vendor: bila vendor memberi tahu pada jam ke-48, tersisa 24 jam.

| Vendor | Janji vendor ke LINOE | Kanal LINOE ke vendor |
|---|---|---|
| Supabase | UNKNOWN: cek dokumen vendor | [DIISI FOUNDER] |
| Netlify | UNKNOWN | [DIISI FOUNDER] |
| Anthropic | UNKNOWN | [DIISI FOUNDER] |
| OpenAI | UNKNOWN | [DIISI FOUNDER] |
| Resend | UNKNOWN | [DIISI FOUNDER] |
| Meta, TikTok, X | UNKNOWN | [DIISI FOUNDER] |
| Penyedia email dukungan (Google) | UNKNOWN | [DIISI FOUNDER] |
| Telemetri produk | Tidak aktif; tambahkan bila diaktifkan | - |

Aturan: (1) bila LINOE mengetahui insiden vendor lebih dulu, T0 = saat LINOE tahu; (2) saat vendor melapor, minta rincian data, jam, subjek, status; (3) simpan semua komunikasi sebagai bukti; (4) kontak vendor diisi Founder; agen tidak masuk dashboard.

## 9. Latihan meja (tabletop)

Dilakukan sebelum tenant eksternal pertama; ulangi tiap 6-12 bulan (usulan). SOP dianggap BELUM TERUJI sampai lembar hasil terisi.

| # | Skenario | Hasil yang diharapkan |
|---|---|---|
| S1 | Peneliti melapor berkas berisi dokumen identitas dapat diakses publik | Penahanan; bukti; pohon 4.1; notifikasi tenant |
| S2 | Token platform iklan bocor di log | Cabut token; putus koneksi; rotasi kunci bila perlu; beri tahu tenant |
| S3 | Vendor melapor insiden pada jam ke-48 | Hitung ulang sisa jam; minta rincian; nilai peran |
| S4 | Tenant melapor data pelanggan akhir bocor | Verifikasi pelapor; jalur prosesor; template 7.3 |
| S5 | Akun administrasi disusupi | Cabut sesi dan akses, rotasi rahasia, tinjau log audit |
| S6 | Kontak utama tidak merespons | Kontak cadangan mengambil alih |

Bukti disimpan tanpa data pribadi nyata: tanggal dan peserta, jam tiap tahap, keputusan dan alasan, template fiktif terisi, temuan dan perbaikan, tanda tangan Founder dan konsultan. Target waktu per skenario ditetapkan saat latihan; ini target internal, bukan janji.

## 10. Register insiden (kolom minimal)
No, T0 (WIB), penemu, sumber, kategori data, perkiraan jumlah subjek, tingkat keparahan, keputusan "kegagalan PDP" (ya/tidak + alasan), jam penahanan, notifikasi subjek/lembaga/tenant/publik (jam, kanal, bukti), vendor terlibat, akar masalah, perbaikan, tanggal penutupan, penandatangan. Retensi: RT-15 (UNKNOWN).

## 11. Belum terverifikasi (jangan diklaim)
Titik mulai 3 x 24 jam; identitas dan saluran lembaga; peraturan turunan; batas waktu prosesor ke tenant; ada tidaknya formulir resmi; Penjelasan Pasal 46(3); kontak keamanan tiap vendor.
