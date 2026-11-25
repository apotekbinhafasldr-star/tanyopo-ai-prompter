# SOP Hak Subjek Data dan Permintaan Aparat (DRAF)

> **STATUS: DRAF. Belum berlaku, belum diuji, belum diadopsi. Bukan nasihat hukum.**
> Tidak ada janji waktu layanan (SLA) kepada publik. Angka waktu di bawah adalah **target internal** dan tidak boleh dipublikasikan sebelum Founder dan konsultan memutuskan serta SOP teruji.
> Dapat dijalankan dari ponsel; verifikasi dan balasan lewat email.

## 1. Tenggat hukum

Tenggat **3 x 24 jam** hanya berlaku untuk pasal-pasal berikut dalam UU 27/2022 (label V menurut hasil verifikasi internal; cocokkan dengan teks resmi sebelum dijadikan janji kepada pihak luar):

| Pasal | Hak/kewajiban |
|---|---|
| 30 | Koreksi/pembaruan data |
| 32 | Akses dan salinan |
| 40 | Penghentian pemrosesan / penarikan persetujuan |
| 41 | Penundaan/pembatasan pemrosesan |

Pasal 43-44 (penghapusan/pemusnahan): **tidak ada tenggat 3 x 24 jam**; tenggat lain belum ditetapkan (target internal diputuskan Founder). Pasal 46 (insiden) diatur di `SOP_INSIDEN.md`.

Dokumen ini tidak memakai PP 33/2026 sebagai dasar.

## 2. Dua dunia data

| | **Data akun dan operasi LINOE** | **Data pelanggan akhir tenant** |
|---|---|---|
| Contoh | Email, nama, nama usaha, peran, sesi, langganan, log audit, data staf | Referensi pelanggan/pesanan, referensi pengguna eksternal, muatan webhook, teks bebas yang memuat pelanggan |
| Peran LINOE | Pengendali | Prosesor (KONS); tenant = pengendali |
| Pemutus | LINOE | Tenant |
| Pemohon | Pemilik/anggota workspace | Pelanggan akhir, atau tenant atas nama |
| Tindakan LINOE | Verifikasi, putuskan, laksanakan, balas | Teruskan ke tenant (target internal paling lama 2 hari kalender, di dalam tenggat hukum), bantu teknis atas instruksi tenant; jangan memutuskan sendiri |

Bila peran tidak jelas: perlakukan sebagai pengendali, beri tahu tenant, minta konsultan menilai.

Akun login (`auth.users`) dibagi dengan produk Tanyopo lain. **Penghapusan data LINOE tidak menghapus akun login.** Penghapusan akun login adalah permintaan terpisah yang dinilai tersendiri, dan modul produk lain tidak disentuh.

## 3. Penerimaan

Kanal: (1) kotak surat khusus privasi [DIISI FOUNDER]; (2) formulir/halaman hak data bila nanti tersedia (belum tersedia saat ini); (3) surat tertulis.

Setiap permintaan dicatat di register: nomor, tenant, pemohon, jenis, status (diterima, identitas terverifikasi, disetujui, dilaksanakan, ditolak, ditutup), waktu terima, target jatuh tempo internal, metode dan waktu verifikasi, persetujuan pelaksanaan, hasil (hanya hitungan), catatan. Saat ini register berupa lembar manual; **register di basis data belum tersedia**. Register tidak menyimpan isi data pribadi. Retensi register: RT-13 (`KEBIJAKAN_RETENSI.md`).

Balasan penerimaan dikirim segera (Template A). Hitungan waktu dimulai dari penerimaan.

## 4. Verifikasi identitas (minimum yang cukup)

| Pemohon | Metode | Dilarang |
|---|---|---|
| Pengguna sedang login | Sesi login + konfirmasi email untuk hapus/ekspor/tarik persetujuan | Meminta kata sandi |
| Lewat email | Balasan dari email akun terdaftar atau tautan konfirmasi sekali pakai | Meminta dokumen identitas tanpa alasan tertulis; meminta data lebih banyak dari yang sudah ada |
| Pemilik workspace (data bisnis) | Verifikasi kepemilikan workspace | Mengabulkan permintaan non-pemilik |
| Anggota non-pemilik | Hanya data pribadinya sendiri | Data bisnis workspace |
| Pelanggan akhir tenant | Tidak dapat diverifikasi LINOE; teruskan ke tenant (Template F) | Memberikan data tanpa instruksi tenant |
| Pihak yang mengaku mewakili | Surat kuasa dan identitas pemberi kuasa (konsultan menilai) | Mengabulkan tanpa kuasa |

Verifikasi gagal: minta kelengkapan sekali (Template B); bila tetap gagal, tutup dengan penjelasan tertulis. Verifikasi melindungi data orang lain.

## 5. Per hak

| Hak | Batas hukum | Target internal (belum publik) | Pelaksanaan |
|---|---|---|---|
| Akses dan salinan | Pasal 32: 3 x 24 jam | Tiga hari kalender | Ekspor manual per kategori data oleh Founder dengan persetujuan. **Ekspor mandiri belum tersedia.** Jangan sertakan data tenant lain |
| Koreksi | Pasal 30: 3 x 24 jam; beri tahu hasil | Dua hari kalender (di dalam tenggat hukum 3 x 24 jam) | Lewat aplikasi bila ada; selain itu manual dengan jejak |
| Tarik persetujuan / hentikan pemrosesan | Pasal 40: 3 x 24 jam | Dua hari | Hanya untuk pemrosesan berbasis persetujuan (saat ini praktis tidak ada). Menarik Syarat berarti penutupan akun |
| Tunda/batasi | Pasal 41: 3 x 24 jam | Dua hari | Tandai akun: tidak diproses lebih lanjut kecuali disimpan |
| Hapus/musnahkan | Pasal 43-44: tanpa tenggat 3 x 24 jam | **Ditetapkan Founder** | Lihat urutan di bawah |
| Keberatan atas keputusan otomatis | KONS (rincian peraturan turunan UNKNOWN) | 14 hari (usulan) | LINOE tidak membuat keputusan otomatis berdampak hukum atas individu; bila ada keberatan, lakukan tinjauan manusia |
| Portabilitas | KONS | Bersama akses | Format JSON/CSV terstruktur bila tersedia |
| Pengaduan | - | Balas penerimaan segera; tindak lanjut 14 hari (usulan) | Register pengaduan |

Penolakan karena membahayakan keamanan/mengungkap data orang lain atau pengecualian lain hanya dengan dasar tertulis konsultan; bukan alasan umum.

**Urutan penghapusan (data akun LINOE):**
1. Verifikasi dan persetujuan tertulis Founder per kasus.
2. Hapus berkas penyimpanan lewat jalur aplikasi/API (bukan SQL langsung).
3. Fungsi penghapusan terpusat: **belum tersedia** (rancangan); sebelum tersedia, penghapusan manual dengan uji kering dan persetujuan Founder. Tidak ada job purge otomatis.
4. Putus koneksi platform iklan dan cabut token.
5. Catat hasil (hitungan saja).
6. Beri tahu pemohon secara tertulis.

## 6. Yang dipertahankan setelah penghapusan

Rujukan angka: `KEBIJAKAN_RETENSI.md` (status MENUNGGU PERSETUJUAN FOUNDER).

| Kategori | Perlakuan | Alasan yang boleh disampaikan |
|---|---|---|
| Brief, produk, kampanye, konten, analitik, pengaturan, koneksi dan token | Hapus | Tidak diperlukan lagi |
| Konversi dengan referensi pelanggan; muatan webhook | Hapus atau anonimkan sesuai instruksi tenant | Data pihak ketiga; tenant pengendali |
| Riwayat pemakaian AI | Anonimkan; baris metadata kuota tetap | Perhitungan kuota/biaya |
| Catatan audit | Pertahankan, redaksi konteks bebas bila perlu (KONS). Tidak dijanjikan tidak dapat diubah; ikut terhapus bila tenant dihapus | Keamanan dan pertanggungjawaban |
| Langganan, invoice, buku besar keuangan | Pertahankan | Kewajiban dokumen keuangan (UU 8/1997 Pasal 11(1)) |
| Peringatan pembayaran, anti-replay webhook, Emergency Stop dan kontrol anggaran | Pertahankan, tidak dihapus | Integritas keuangan dan keamanan |
| Bukti persetujuan, register permintaan, register insiden | Pertahankan | Bukti kepatuhan (UU PDP Pasal 24 untuk bukti persetujuan) |
| Akun login bersama | Tidak dihapus oleh LINOE | Dipakai produk lain; permintaan terpisah |
| Cadangan vendor | Tidak dihapus manual | Rotasi vendor; diungkapkan |
| Data yang telah diteruskan ke vendor AI/email | Tidak dapat dijamin terhapus | Di luar kendali; retensi vendor UNKNOWN; diungkapkan |

## 7. Alur ringkas
1. Terima, catat, kirim Template A.
2. Klasifikasi: data akun atau data pelanggan akhir tenant. Bila tenant: Template F ke tenant, Template G ke pemohon.
3. Verifikasi identitas; gagal: Template B.
4. Nilai lingkup dan pengecualian; konsultan bila ragu; Founder menyetujui tindakan merusak.
5. Laksanakan; catat hasil hanya sebagai hitungan.
6. Balas tertulis (Template C-E): apa dilakukan, apa dipertahankan dan alasan, hak pengaduan, kontak.
7. Tutup dan arsipkan bukti tanpa menyalin data pribadi.
8. Tinjau pola tiap 6 bulan; perbarui RoPA.

## 8. Template (jangan kirim sebelum disetujui Founder)

**A. Penerimaan**
```
Subjek: Permintaan Anda kepada LINOE telah kami terima (No. [REQ-...])
Yth. [nama],
Kami menerima permintaan [akses/koreksi/penarikan persetujuan/penghapusan] pada [tanggal jam WIB]. Kami akan memverifikasi identitas Anda lebih dulu dan memberi tahu hasilnya secara tertulis. Kami tidak pernah meminta kata sandi Anda.
[PT Tanyopo Future Technology / kontak DIISI FOUNDER]
```
**B. Permintaan verifikasi**
```
Subjek: Verifikasi permintaan Anda (No. [REQ-...])
Untuk melindungi data Anda, mohon balas email ini dari alamat email akun terdaftar [atau klik tautan konfirmasi]. Kami hanya meminta informasi yang diperlukan untuk memastikan Anda pemilik data.
```
**C. Hasil akses**
```
Subjek: Hasil permintaan akses data (No. [REQ-...])
Terlampir salinan data pribadi Anda pada akun LINOE Anda dalam format [JSON/CSV], beserta ringkasan tujuan dan penerima pemrosesan. Data pihak lain tidak disertakan.
```
**D. Hasil koreksi**
```
Subjek: Hasil permintaan koreksi data (No. [REQ-...])
Kami telah memperbaiki: [bidang]. Hasil koreksi telah kami sampaikan kepada pihak penerima data dari kami, bila ada: [daftar atau "tidak ada"].
```
**E. Hasil penghapusan / penolakan sebagian**
```
Subjek: Hasil permintaan penghapusan data (No. [REQ-...])
Pada [tanggal] kami telah: (1) menghapus: [kategori]; (2) menganonimkan: [kategori]; (3) mempertahankan: [kategori] karena [alasan hukum/keuangan/keamanan yang sah]; (4) tidak menghapus: akun login bersama (dipakai produk Tanyopo lain) dan data pada cadangan yang diganti sesuai siklus penyedia; data yang telah diteruskan kepada penyedia pihak ketiga tidak dapat kami jamin terhapus.
Bila Anda keberatan, hubungi [kanal pengaduan: DIISI FOUNDER].
```
**F. Penerusan ke tenant**
```
Subjek: Permintaan hak subjek data atas data yang Anda kendalikan (No. [REQ-...])
Kami menerima permintaan dari seorang pelanggan akhir Anda terkait [jenis]. Sesuai peran kami sebagai pemroses, keputusan ada pada Anda sebagai pengendali. Mohon instruksikan tindakan yang Anda inginkan. Kami siap membantu secara teknis.
```
**G. Balasan ke pemohon pelanggan akhir**
```
Subjek: Permintaan Anda telah kami teruskan
Data yang Anda maksud dikendalikan oleh [nama bisnis/tenant], bukan oleh LINOE. Kami telah meneruskan permintaan Anda kepada mereka.
```

## 9. Permintaan aparat penegak hukum dan kementerian/lembaga

Dasar: Permenkominfo 5/2020 (Pasal 21-23, 36-37 menurut catatan internal) dan UU PDP Pasal 50. **Seluruh rujukan ini berlabel KONS**: belum diverifikasi ulang terhadap teks terkini, termasuk perubahannya. Jangka waktu pemenuhan yang tercatat (5 hari kalender) juga KONS.

Langkah:
1. Terima hanya lewat narahubung resmi atau surat tertulis; catat tanggal dan jam. Narahubung berdomisili di Indonesia: [DIISI FOUNDER].
2. Verifikasi keaslian (kop, nomor surat; hubungi balik lewat saluran resmi yang dicari sendiri, bukan nomor di surat).
3. Periksa kelengkapan: dasar kewenangan, tujuan, deskripsi data; penetapan pengadilan untuk konten komunikasi (KONS).
4. Eskalasi ke konsultan hukum sebelum menyerahkan apa pun.
5. Serahkan seminimal mungkin lewat kanal aman; catat jenis dan hitungan.
6. Bila tidak lengkap, balas tertulis meminta kelengkapan.
7. Jangan memberi tahu subjek bila dilarang hukum; selebihnya ikuti konsultan.
8. Simpan register (tanggal, instansi, dasar, data diserahkan, penyetuju). Retensi: RT-15.

LINOE sebagai prosesor atas data tenant: beri tahu tenant kecuali dilarang atau konsultan menyarankan lain. Isi dan kredensial tidak diserahkan karena tekanan lisan.
