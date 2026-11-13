# Auth Recovery (konfirmasi email) — status dan usulan

Status: perubahan kode di PR ini hanya UI/pesan auth. Tidak mengubah Supabase (dashboard), database, env, atau secret.

## Yang berubah
| Situasi | Sebelum | Sesudah |
|---|---|---|
| Login, email belum dikonfirmasi (password benar) | "Email atau kata sandi salah." | Pesan khusus + form kirim ulang |
| Tautan konfirmasi kedaluwarsa / tidak berlaku | Redirect diam-diam ke `/login` | `/login?notice=link_expired` atau `link_invalid`, pesan jelas + form kirim ulang |
| Email tidak tiba | Tidak ada jalan keluar (kirim ulang hanya bila `EMAIL_OTP_ENABLED=true`) | Kirim ulang tautan (tidak bergantung flag OTP) |

## Tidak membocorkan keberadaan akun
- Pesan "belum dikonfirmasi" hanya muncul bila password BENAR (Supabase memeriksa password lebih dulu).
- Kirim ulang menjawab sama untuk alamat berhasil, tidak dikenal, atau sudah terkonfirmasi. Batasan yang diketahui: bila Supabase menolak dengan 429 per-pengguna (email baru saja dikirim), jawabannya "tunggu"; selisih waktu respons SMTP untuk alamat nyata juga mungkin terukur. Batas 6/jam/IP membatasi penyalahgunaan keduanya. Jawaban TIDAK diklaim identik secara mutlak.
- Kunci cooldown per alamat mengabaikan "+tag".
- Kode `notice` hanya dua konstanta, tidak pernah memantulkan input.

## Batas laju (BUKAN batas global)
- 60 detik per alamat dan 6 per jam per IP tepercaya. Penghitung disimpan di memori SATU instance server (`lib/rate-limit.ts`): usaha terbaik. Instance lain dan cold start menghitung sendiri, jadi jumlah total permintaan yang lolos bisa beberapa kali lipat. Batas global TIDAK terbukti dan tidak diklaim.
- IP klien hanya dari header Netlify `x-nf-client-connection-ip` setelah divalidasi `isIP` (`lib/auth/recovery-ip.ts`). `x-forwarded-for` TIDAK pernah dibaca karena hop pertamanya bisa dipalsukan penelepon (bypass batas atau menghabiskan jatah korban). IPv6 dikelompokkan per /64. Header kosong atau tidak valid masuk satu bucket bersama `unidentified` (30 per jam, lebih longgar agar pengguna sah tidak saling memblokir; cooldown 60 detik per alamat tetap berlaku). `getClientIp` global tidak diubah.
- UNKNOWN: apakah Netlify menimpa `x-nf-client-connection-ip` yang dikirim klien. Uji di deploy nyata sebelum menganggapnya kontrol keras.
- Supabase punya batas sendiri (interval per pengguna, email per jam). Nilainya UNKNOWN sampai dicek di dashboard; Resend punya kuota sendiri.
- Setelah #141 (SEC-01) di-merge, satukan `lib/auth/recovery-ip.ts` ke `getAuthClientBucket` agar satu sumber kebenaran.

## Risiko abuse yang tersisa
- Email-bombing ke satu alamat: dibatasi cooldown per alamat per instance; dengan N instance hangat, hingga sekitar 60 x N per jam sebelum batas Supabase/Resend. Banyak alamat: dibatasi 6/jam per IP tepercaya per instance, atau 30/jam untuk bucket `unidentified` per instance.
- Penyerang tanpa IP teridentifikasi bisa menghabiskan bucket `unidentified` di satu instance sehingga pengguna sah di instance itu mendapat "tunggu" sampai jam berikutnya.
- Resend bisa dipicu untuk alamat mana pun di `auth.users` bersama (termasuk pengguna produk lain); template "Confirm signup" berlaku untuk seluruh proyek. Cek template dan Site URL di dashboard (UNKNOWN).
- Sebelum skala lebih luas diperlukan perlindungan global (penyimpanan bersama atau batas di tepi/WAF, atau captcha). Itu perubahan DB/dependensi/infra dan butuh persetujuan terpisah.

## Aksesibilitas tombol kirim ulang
Tombol tidak pernah `disabled` native (fokus tidak hilang); saat pending atau cooldown memakai `aria-disabled` dan klik dibatalkan. Nama tombol statis; hitung mundur hanya visual, dan satu catatan sopan dibacakan saat cooldown berakhir. Error dihubungkan ke kolom lewat `aria-invalid` dan `aria-describedby`. Tombol membungkus teks dengan tinggi minimum 44px.

## RISIKO: scanner / prefetch mengonsumsi token (USULAN, belum diterapkan)
`GET /auth/confirm` langsung memanggil `verifyOtp`. Pemindai email atau prefetch dapat membuka tautan dan menghanguskan token, sehingga pengguna melihat tautan "tidak berlaku" padahal akunnya sudah aktif. PR ini hanya memitigasi dampaknya lewat pesan ("jika akun sudah aktif, silakan masuk") dan kirim ulang. Mitigasi penyebabnya mengubah alur, jadi TIDAK dilakukan diam-diam:

| Opsi | Cara | Perubahan | Catatan |
|---|---|---|---|
| A (disarankan) | `GET /auth/confirm` menampilkan halaman dengan tombol "Konfirmasi email saya"; `POST` yang memanggil `verifyOtp` | Kode saja; URL di template email tetap | Scanner tidak menekan tombol |
| B | Template email menunjuk ke halaman perantara berbeda | Kode + template dashboard Supabase | Butuh akses dashboard |
| C | Biarkan, andalkan pesan + kirim ulang | Tidak ada | Risiko tetap ada |

Butuh persetujuan khusus Founder sebelum A atau B. Status: USULAN. Jika A dipilih, kirim juga `Referrer-Policy: no-referrer` pada halaman konfirmasi.

## Perlu dicek Founder (UNKNOWN)
`/auth/confirm` kini hanya menerima `type=signup` (sudah demikian di main). Proyek Supabase dipakai bersama umkmpro-ai: pastikan tidak ada template email lain (invite/magiclink/email_change) yang menunjuk ke rute ini.

## Bukti
Tes unit (jsdom/mocks, kelas UNIT/MOCK) untuk pemetaan error, kirim ulang (seragam, cooldown, batas IP, 429, transport), notice, dan UI. Pengiriman email nyata TIDAK diuji di sini (lihat QA-2).
