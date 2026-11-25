# Catatan Kegiatan Pemrosesan Data Pribadi (RoPA) LINOE (DRAF)

> **STATUS: DRAF untuk tinjauan konsultan. Belum diadopsi. Bukan nasihat hukum.**
> Dasar kewajiban merekam pemrosesan: UU 27/2022 Pasal 31 (label HUKUM). Disusun dari inventaris kode dan dokumen repo per 24 November 2026.
> Status skema produksi: UNKNOWN (migrasi di repo belum tentu seluruhnya diterapkan di produksi).

## 0. Cara membaca

- **Peran**: P = Pengendali; PR = Prosesor; P/PR = peran campur (penilaian peran = KONS).
- **Subjek**: S1 pengguna LINOE (pemilik/pengelola akun tenant); S2 anggota/pegawai tenant; S3 pelanggan akhir tenant (pihak ketiga dalam data yang diisi tenant); S4 staf/operator LINOE; S5 pengunjung/demo.
- **Dasar (UU 27/2022 Pasal 20(2))**: a persetujuan; b perjanjian; c kewajiban hukum; d kepentingan vital; e tugas kepentingan umum; f kepentingan sah lainnya (perlu uji keseimbangan/LIA; LIA belum ditulis).
- **Retensi**: merujuk `KEBIJAKAN_RETENSI.md` (kode RT-xx). Angka di sana berstatus MENUNGGU PERSETUJUAN FOUNDER.
- **Lokasi/transfer**: penyimpanan basis data di Singapura; fungsi dan cache hosting di Amerika Serikat; penyedia AI dan email di AS/global. Rincian sub-prosesor vendor belum dibuka (UNKNOWN). Penilaian transfer lintas negara: KONS.
- **Pengamanan umum**: isolasi data antar-tenant pada basis data, kunci rahasia hanya di sisi server, HTTPS, jejak audit (belum tahan-ubah; lihat R-09). Klaim ini berasal dari dokumentasi/kode dan belum diuji penetrasi (UNKNOWN). Detail teknis kontrol sengaja tidak dirinci di dokumen publik ini.
- **Rujukan kode**: berupa path berkas/folder tanpa nomor baris agar tidak cepat usang.

## 1. Ringkasan

| ID | Kegiatan | Peran | Subjek | Dasar Pasal 20(2) |
|---|---|---|---|---|
| R-01 | Pendaftaran dan akun | P | S1 | b |
| R-02 | Email verifikasi, OTP, reset sandi | P | S1 | b |
| R-03 | Sesi, pembatasan laju, keamanan, log teknis | P | S1, S5 | f (LIA belum ada) |
| R-04 | Onboarding dan profil brand | P | S1 (S3 bila teks bebas) | b |
| R-05 | Katalog produk dan media | P/PR | S1, S3 insidental | b |
| R-06 | Fitur AI pihak ketiga | P/PR | S1, S3 | b + pemberitahuan (opsi a dipertimbangkan, KONS) |
| R-07 | Koneksi akun iklan | P | S1 | b |
| R-08 | Kampanye, persetujuan, anggaran, autopilot | P | S1, S2 | b |
| R-09 | Catatan audit aktivitas workspace | P | S1, S2 | f dan bukti kepatuhan |
| R-10 | Konversi, atribusi, metrik | PR (referensi pelanggan) | S3, S1 | b atas instruksi tenant |
| R-11 | Integrasi UMKMpro | PR | S3, S1 | b |
| R-12 | Langganan, invoice, pembayaran | P | S1 | b dan c |
| R-13 | Peringatan pembayaran ke operator | P | S4 | f |
| R-14 | Admin Center, keuangan, akuntansi, pajak | P | S4, S1 | b, c, f |
| R-15 | Telemetri produk (tidak aktif) | P | S1 (pseudonim) | f |
| R-16 | Mode demo | P | S5 | f / b |
| R-17 | Dukungan dan komunikasi | P | S1, S2, S3 | b dan f |
| R-18 | Hak subjek, bukti, register | P | semua | c dan f |
| R-19 | Hosting, log, cache, cadangan | P (vendor sebagai prosesor) | semua | f dan b |
| R-20 | Permintaan aparat, insiden, kewajiban hukum | P | semua terkait | c |

## 2. Detail per kegiatan

### R-01 Pendaftaran dan akun
| Atribut | Isi |
|---|---|
| Tujuan | Membuat akun dan workspace; mengautentikasi pengguna |
| Kategori data | Nama, nama usaha, email, kata sandi (ditangani penyedia autentikasi; aplikasi LINOE tidak menyimpannya), jenis usaha default |
| Dasar | b (perjanjian). Bukan persetujuan PDP |
| Penerima | Supabase (autentikasi dan basis data) |
| Lokasi | Singapura |
| Retensi | RT-01 |
| Rujukan kode | `features/auth/actions.ts`, `schemas/auth.ts`, `docs/DATABASE.md` |
| Catatan | Penerimaan Syarat dan versi pemberitahuan belum direkam (belum tersedia). Tabel akun/tenant dibagikan dengan produk lain dan tidak diubah oleh LINOE |

### R-02 Email verifikasi, OTP, reset sandi
| Atribut | Isi |
|---|---|
| Tujuan | Verifikasi email, masuk dengan kode (bila aktif), pemulihan akun |
| Kategori data | Email, token sekali pakai, waktu kirim |
| Dasar | b |
| Penerima | Supabase Auth; penyedia SMTP produksi UNKNOWN |
| Lokasi | Singapura; pengirim email dapat berada di AS (UNKNOWN produksi) |
| Retensi | RT-01 dan RT-11; sisi vendor UNKNOWN |
| Rujukan kode | `app/auth/confirm/route.ts`, `features/auth/otp-actions.ts`, `lib/auth/email-otp.ts`, `docs/QA2_AUTH_SMTP_CONFIG.md` |

### R-03 Sesi, pembatasan laju, keamanan, log teknis
| Atribut | Isi |
|---|---|
| Tujuan | Menjaga sesi, mencegah penyalahgunaan, investigasi insiden |
| Kategori data | Cookie sesi; alamat IP dan perangkat pada log platform |
| Dasar | f (keamanan/anti-penyalahgunaan); LIA belum ditulis. Cookie sesi bersifat esensial |
| Penerima | Supabase, Netlify |
| Lokasi | Singapura; AS (fungsi/log hosting); log Supabase di UE (menurut dokumentasi vendor) |
| Retensi | RT-11 |
| Rujukan kode | `proxy.ts`, `lib/rate-limit.ts`, `lib/security/`, `lib/demo/`, `app/(legal)/privacy/page.tsx` |

### R-04 Onboarding dan profil brand
| Atribut | Isi |
|---|---|
| Tujuan | Memberi konteks bagi AI dan menyiapkan kampanye |
| Kategori data | Nama brand, deskripsi bisnis, produk, target pasar, nada, bahasa, lokasi, logo, URL situs. Usaha perorangan dapat berarti data pribadi; teks bebas dapat memuat pihak ketiga |
| Dasar | b |
| Penerima | Supabase; isi dikirim ke penyedia AI saat fitur AI dipakai (R-06) |
| Lokasi | Singapura; AS/global untuk AI |
| Retensi | RT-02 |
| Rujukan kode | `schemas/onboarding.ts`, `supabase/migrations/` (skema fondasi) |

### R-05 Katalog produk dan media
| Atribut | Isi |
|---|---|
| Tujuan | Menyimpan produk dan materi kreatif untuk kampanye |
| Kategori data | Nama, deskripsi, harga, stok, kategori; berkas gambar/video; subjek insidental (wajah, nama pada gambar) |
| Dasar | b |
| Penerima | Supabase (basis data dan penyimpanan berkas); platform iklan bila materi dipakai tenant |
| Lokasi | Singapura |
| Retensi | RT-02 |
| Rujukan kode | `features/products/` |
| Catatan | Kerahasiaan berkas media tidak dijanjikan. Tenant dilarang mengunggah data pribadi pihak ketiga atau data spesifik. Peringatan unggah dan pemindaian: belum tersedia |

### R-06 Fitur AI pihak ketiga
| Atribut | Isi |
|---|---|
| Tujuan | Menghasilkan brief, konten, proposal kampanye, rekomendasi, analitik |
| Kategori data | Profil brand, produk, teks bebas tenant (dikirim sebagai prompt); hasil keluaran; catatan job (jenis, model, jumlah token, estimasi biaya) |
| Dasar | b + pemberitahuan. Persetujuan eksplisit sebagai peningkatan: KONS |
| Penerima | OpenAI dan/atau Anthropic; Supabase |
| Lokasi | AS/global (sub-prosesor belum dibuka); penyimpanan hasil di Singapura |
| Retensi | RT-04; retensi sisi vendor AI: UNKNOWN (cek per vendor) |
| Rujukan kode | `lib/ai/`, `docs/AI_SYSTEM.md` |
| Catatan | Pemindai data pribadi sebelum kirim belum tersedia; peringatan ke tenant hanya berupa teks Privasi |

### R-07 Koneksi akun iklan
| Atribut | Isi |
|---|---|
| Tujuan | Membaca dan menyiapkan kampanye di akun iklan tenant atas perintah tenant |
| Kategori data | ID/nama akun eksternal, izin yang diberikan, masa berlaku, pihak yang menghubungkan, token akses/refresh (disimpan terenkripsi), data kinerja iklan yang diizinkan |
| Dasar | b; tindakan otorisasi eksplisit pemilik workspace |
| Penerima | Platform iklan tujuan (Meta, TikTok; koneksi X dinonaktifkan). Status mereka sebagai prosesor: UNKNOWN; Supabase |
| Lokasi | AS/global; penyimpanan di Singapura |
| Retensi | RT-07 (token), RT-08 (kinerja terimpor: KONS) |
| Rujukan kode | `lib/connectors/`, `features/connections/actions.ts`, `lib/crypto/token-cipher.ts`, `app/api/connections/` |
| Catatan | Teks Privasi tentang izin platform perlu diselaraskan dengan perilaku kode (perubahan teks butuh persetujuan PR) |

### R-08 Kampanye, persetujuan, anggaran, autopilot
| Atribut | Isi |
|---|---|
| Tujuan | Menyusun kampanye, kontrol anggaran, persetujuan manusia |
| Kategori data | Kampanye, anggaran, target wilayah, catatan audiens (teks bebas), pengaju/pemutus persetujuan, kebijakan autopilot |
| Dasar | b |
| Penerima | Supabase; platform iklan bila diluncurkan tenant |
| Lokasi | Singapura; AS/global |
| Retensi | RT-03 |
| Rujukan kode | `features/approvals/actions.ts`, `docs/SECURITY.md` |
| Catatan | Emergency Stop dan kontrol anggaran tidak dihapus saat penghapusan data (lihat `KEBIJAKAN_RETENSI.md` bagian 5) |

### R-09 Catatan audit aktivitas workspace
| Atribut | Isi |
|---|---|
| Tujuan | Jejak tindakan penting untuk keamanan dan pembuktian |
| Kategori data | Pelaku, aksi, jenis/ID sumber daya, data sebelum/sesudah, konteks (teks bebas yang dapat memuat data pribadi) |
| Dasar | f dan bukti kepatuhan; LIA belum ada |
| Penerima | Supabase |
| Lokasi | Singapura |
| Retensi | RT-05 |
| Rujukan kode | `supabase/migrations/` (skema fondasi) |
| Catatan | Klien aplikasi tidak memiliki hak ubah/hapus pada catatan ini; namun pemilik sistem/service role tetap dapat mengubah, dan catatan ikut terhapus bila tenant dihapus (cascade). Jangan disebut tidak dapat diubah. Penyelarasan dengan hak hapus/anonimisasi: KONS |

### R-10 Konversi, atribusi, metrik
| Atribut | Isi |
|---|---|
| Tujuan | Mengukur kinerja kampanye |
| Kategori data | Referensi pelanggan dan pesanan (teks pendek), nilai, mata uang, metadata bebas; metrik harian; input manual metrik |
| Dasar | b atas instruksi tenant. Dasar tenant terhadap pelanggan akhir: tanggung jawab tenant (penilaian peran: KONS) |
| Penerima | Supabase |
| Lokasi | Singapura |
| Retensi | RT-08 |
| Rujukan kode | `schemas/umkmpro.ts`, `services/umkmpro.ts` |
| Catatan | Perjanjian pemrosesan (DPA) dengan tenant belum ada. Panduan agar tenant tidak mengisi data pribadi bebas di kolom metadata: belum ada |

### R-11 Integrasi UMKMpro
| Atribut | Isi |
|---|---|
| Tujuan | Sinkronisasi produk, fitur "Promosikan dengan AI", konversi, webhook |
| Kategori data | Salinan produk dan gambar; referensi pengguna eksternal; muatan event webhook (bebas); konversi (R-10) |
| Dasar | b (tenant memakai kedua produk) |
| Penerima | Supabase (proyek dibagi dengan produk lain) |
| Lokasi | Singapura |
| Retensi | RT-08, RT-09 |
| Rujukan kode | `services/umkmpro.ts`, `app/api/v1/integrations/umkmpro/` |
| Catatan | Modul produk lain tidak diubah. Anti-replay webhook tidak dihapus saat penghapusan data |

### R-12 Langganan, invoice, pembayaran
| Atribut | Isi |
|---|---|
| Tujuan | Mengelola paket, kuota, penagihan. Pembayaran riil belum aktif (sandbox) |
| Kategori data | Paket, status, periode, jumlah, mata uang, ID pembayaran dari gateway, alasan gagal, invoice. Data kartu tidak disimpan LINOE |
| Dasar | b; c untuk pembukuan |
| Penerima | Gateway pembayaran (Midtrans/DOKU, sandbox); Supabase |
| Lokasi | Gateway: UNKNOWN; penyimpanan di Singapura |
| Retensi | RT-06 (HUKUM: UU 8/1997 Pasal 11(1)) |
| Rujukan kode | `app/api/webhooks/payment/route.ts`, `lib/billing/providers/`, `docs/GO_LIVE_PAYMENTS.md` |
| Catatan | Saat live, perbarui Privasi dengan nama penyedia |

### R-13 Peringatan pembayaran ke operator
| Atribut | Isi |
|---|---|
| Tujuan | Memberi tahu operator tentang anomali pembayaran |
| Kategori data | ID operator, alamat email penerima, isi peringatan (ID transaksi/tenant), hasil kirim |
| Dasar | f |
| Penerima | Resend (email) |
| Lokasi | AS |
| Retensi | RT-11 (batch peringatan: UNKNOWN). Data peringatan pembayaran tidak dihapus saat penghapusan data |
| Rujukan kode | `netlify/lib/notifier-core.ts`, `netlify/functions/payment-alert-notify.ts`, `docs/BILLING_B4_PAYMENT_ALERTS.md` |

### R-14 Admin Center, keuangan, akuntansi, pajak
| Atribut | Isi |
|---|---|
| Tujuan | Pembukuan, pajak, pelaporan internal; manajemen akses staf |
| Kategori data | Identitas dan peran staf, izin, log audit keuangan, buku besar, refund, settlement, data akuntansi dan pajak |
| Dasar | b/f untuk data staf (KONS); c untuk pembukuan dan pajak; f untuk audit |
| Penerima | Supabase; otoritas pajak melalui pelaporan oleh Founder |
| Lokasi | Singapura |
| Retensi | RT-06, RT-16 |
| Rujukan kode | `lib/admin/permissions.ts`, `services/staff-admin.ts`, `services/admin-audit.ts`, `docs/FINANCE_FOUNDATION.md`, `docs/ADMIN_CENTER.md` |
| Catatan | Buku besar keuangan tidak dihapus saat penghapusan data |

### R-15 Telemetri produk (tidak aktif)
| Atribut | Isi |
|---|---|
| Tujuan | Memantau keandalan fitur AI |
| Kategori data | Peristiwa teknis terbatas dengan pengenal tenant berbentuk pseudonim; dilarang memuat email, nama, prompt, keluaran, IP |
| Status | Tidak aktif di produksi. Bila diaktifkan: wajib masuk Privasi dan RoPA |
| Dasar | f (LIA; KONS) |
| Penerima | PostHog (hanya bila aktif) |
| Lokasi | AS atau UE menurut host (hanya bila aktif) |
| Retensi | RT-17 |
| Rujukan kode | `lib/telemetry/`, `docs/POSTHOG_TELEMETRY.md` |

### R-16 Mode demo
| Atribut | Isi |
|---|---|
| Tujuan | Memperkenalkan produk tanpa akun |
| Kategori data | Cookie sesi demo; pencatatan pemakaian AI demo (ID sesi, jumlah, waktu); data demo simulasi |
| Dasar | f (menyediakan demo, mencegah penyalahgunaan kuota); atau b |
| Penerima | Supabase, Netlify; penyedia AI bila fitur demo AI aktif (UNKNOWN) |
| Lokasi | Singapura; AS |
| Retensi | RT-14 |
| Rujukan kode | `app/api/demo/start/route.ts`, `lib/demo/` |

### R-17 Dukungan dan komunikasi
| Atribut | Isi |
|---|---|
| Tujuan | Menjawab pertanyaan, permintaan hak subjek, laporan insiden, bantuan akun |
| Kategori data | Isi email, alamat pengirim, lampiran/tangkapan layar, catatan kasus |
| Dasar | b bila pengguna; f |
| Penerima | Penyedia layanan email dukungan (Google); jenis akun UNKNOWN |
| Lokasi | AS/global |
| Retensi | UNKNOWN (belum ada kategori khusus; usulkan di `KEBIJAKAN_RETENSI.md` setelah keputusan Founder) |
| Rujukan kode | `features/legal/legal-meta.ts`, `docs/SOFT_LAUNCH_10_TENANTS.md` |
| Catatan | Kontak publik: [DIISI FOUNDER]. Pengguna diminta tidak mengirim tangkapan layar data pelanggan atau kunci rahasia |

### R-18 Hak subjek, bukti penerimaan, register
| Atribut | Isi |
|---|---|
| Tujuan | Memenuhi hak subjek dan membuktikan kepatuhan |
| Kategori data | Rancangan: catatan persetujuan/penerimaan pemberitahuan, register permintaan (jenis, status, verifikasi), register insiden dan akses |
| Dasar | c dan f |
| Penerima | Supabase (bila diterapkan) |
| Lokasi | Singapura |
| Retensi | RT-10, RT-13, RT-15 |
| Rujukan kode | `app/(legal)/data-deletion/page.tsx`, `schemas/auth.ts` |
| Status | **Belum tersedia di produksi.** Permintaan saat ini diproses manual lewat email dengan register manual (lihat `SOP_HAK_SUBJEK.md`) |

### R-19 Hosting, log, cache, cadangan
| Atribut | Isi |
|---|---|
| Tujuan | Menjalankan aplikasi; pemulihan bencana |
| Kategori data | Log permintaan/fungsi (IP, URL, header), cache, basis data dan berkas, cadangan |
| Dasar | b dan f |
| Penerima | Netlify, Supabase (sebagai prosesor) |
| Lokasi | AS (fungsi, cache); Singapura (basis data); UE (log, menurut dokumentasi vendor) |
| Retensi | RT-11, RT-12 |
| Rujukan kode | `netlify.toml`, `netlify/functions/`, `docs/BACKUP_RESTORE.md` |
| Catatan | Data terhapus dapat bertahan di cadangan sampai rotasi vendor; diungkapkan di Privasi |

### R-20 Permintaan aparat, insiden, kewajiban hukum
| Atribut | Isi |
|---|---|
| Tujuan | Memenuhi permintaan akses resmi dari kementerian/lembaga/penegak hukum; menangani insiden; notifikasi UU PDP Pasal 46 |
| Kategori data | Surat permintaan, data yang diserahkan (seminimal mungkin), register insiden |
| Dasar | c |
| Penerima | Instansi berwenang atau lembaga penerima notifikasi (UNKNOWN) |
| Lokasi | Tidak ada transfer |
| Retensi | RT-15 |
| Rujukan kode | `SOP_INSIDEN.md`, `SOP_HAK_SUBJEK.md` (bagian permintaan aparat) |

## 3. Pemeliharaan

RoPA diperbarui dalam PR yang sama dengan: tabel baru, vendor baru, integrasi baru, fitur AI baru, aktivasi telemetri, aktivasi pembayaran live, atau perubahan region. Pemilik: Penanggung Jawab PDP (Sementara), setelah ditetapkan Founder.

## 4. Hal UNKNOWN / KONS

Status skema produksi; penyedia SMTP produksi; peran LINOE (pengendali vs prosesor) untuk data pelanggan akhir; status prosesor platform iklan; sub-prosesor vendor; retensi sisi vendor; lokasi gateway pembayaran; jenis akun email dukungan; LIA untuk dasar f; mekanisme transfer lintas negara.
