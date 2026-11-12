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

## Batas laju
- 60 detik per alamat dan 6 per jam per IP (in-memory, per instance: usaha terbaik). Supabase punya batas sendiri (interval per pengguna dan batas email per jam).
- Setelah #141 (SEC-01) di-merge, ganti `getClientIp` pada `features/auth/recovery-actions.ts` dengan `getAuthClientBucket` agar konsisten dengan perbaikan IP tepercaya.

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
