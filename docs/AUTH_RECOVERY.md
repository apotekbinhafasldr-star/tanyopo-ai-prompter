# Auth Recovery (konfirmasi email) — status dan usulan

Status: perubahan kode di PR ini hanya UI/pesan auth dan `loginAction`. Tidak mengubah Supabase (dashboard), database, env, atau secret.

## Yang berubah
| Situasi | Sebelum | Sesudah |
|---|---|---|
| Login, email belum dikonfirmasi (kata sandi BENAR) | "Email atau kata sandi salah." | Tautan konfirmasi dikirim ulang otomatis (dengan batas) dan pesan jelas |
| Tautan konfirmasi kedaluwarsa / tidak berlaku | Redirect diam-diam ke `/login` | `/login?notice=link_expired` atau `link_invalid`: instruksi masuk dengan email dan kata sandi + tautan lupa kata sandi |
| Email tidak tiba | Tidak ada jalan keluar (kirim ulang hanya bila `EMAIL_OTP_ENABLED=true`) | Masuk lagi dengan email dan kata sandi yang benar: tautan baru dikirim (maks. 1/menit dan 5/jam per alamat) |

## Desain: kirim ulang terikat kata sandi (tidak ada resend anonim)
- `loginAction` memanggil `auth.resend({ type: "signup" })` HANYA setelah `signInWithPassword` mengembalikan error dengan `code === "email_not_confirmed"`. Keputusan memakai KODE error, tidak pernah teks pesan. Tanpa kode (versi GoTrue lama atau respons lain) berarti tidak ada resend (fail-closed).
- Tidak ada server action atau endpoint resend konfirmasi LINOE yang bisa dipanggil tanpa kata sandi, kecuali `resendSignupOtpAction` yang sudah ada di main (anonim, tetapi dikunci `EMAIL_OTP_ENABLED`, default mati; tidak diubah di PR ini). Action anonim `resendConfirmationAction` dan helper IP-nya sudah dihapus dari kode, bukan sekadar disembunyikan (server action yang diekspor bisa dipanggil langsung lewat POST).
- Tidak ada resend pada: kata sandi salah, akun tak dikenal, login berhasil, atau error lain.
- Pesan "terkirim" hanya bila Supabase menerima permintaan. Respons 429 menjadi "tunggu"; error lain atau exception menjadi "belum bisa dipastikan".
- Batas: 1 per menit dan 5 per jendela satu jam tetap per alamat (di batas jendela bisa lolos hingga 10), di memori SATU instance server (usaha terbaik; instance lain dan cold start menghitung sendiri, jadi BUKAN batas global). Penghitung hanya dibuat setelah bukti kata sandi, sehingga pemanggil anonim tidak bisa menambah entri memori. Supabase punya batas sendiri (nilainya UNKNOWN sampai dicek di dashboard), dan Resend punya kuota.
- Alamat IP tidak dipakai untuk batas ini (header IP belum terbukti tidak bisa dipalsukan di Netlify; UNKNOWN).

## Ini BUKAN isolasi tenant LINOE
- Terikat kata sandi berarti penelepon harus mengetahui kata sandi akun itu. Itu mencegah pihak ketiga memicu email ke alamat orang lain tanpa kata sandi akun itu (pihak ketiga yang memegang kata sandi bocor tetap lolos, dan `loginAction` belum punya pembatasan percobaan di cabang ini). Itu tidak membedakan akun LINOE dari akun produk lain.
- Proyek Supabase dipakai bersama PUBLOE/UMKMpro/Apotek (`auth.users` bersama). Pemilik akun produk lain yang belum terkonfirmasi, bila memasukkan emailnya dan kata sandinya sendiri di LINOE, akan menerima email konfirmasi dari template proyek (satu template untuk seluruh proyek) dan tautan ke domain LINOE. Itu aksinya sendiri atas akunnya sendiri.
- Tidak ada penanda tenant LINOE yang tepercaya untuk akun belum-dikonfirmasi: baris `tenants`/`user_profiles` dibuat oleh trigger `handle_new_user` untuk semua produk, tabel khusus LINOE baru ada setelah onboarding, dan `user_metadata` berasal dari klien. Isolasi sejati butuh penanda sisi server (mis. `service_role` atau migrasi) dan persetujuan terpisah.
- Jalur lintas produk yang sudah ada di main dan tidak diubah di PR ini: `signUp` untuk email yang sudah ada (GoTrue dapat mengirim ulang konfirmasi untuk akun belum-dikonfirmasi; UNKNOWN), `resendSignupOtpAction` (anonim, tetapi dikunci `EMAIL_OTP_ENABLED`, default mati), dan lupa kata sandi.

## Tidak membocorkan keberadaan akun
- Pesan "belum dikonfirmasi" hanya muncul bila kata sandi BENAR (perilaku GoTrue yang umum; UNKNOWN untuk versi proyek ini). Bila tidak berlaku, pengguna melihat "Email atau kata sandi salah." dan tidak ada email terkirim.
- Kata sandi salah, alamat tak dikenal, dan akun terkonfirmasi dengan kata sandi salah mendapat jawaban yang sama persis.
- Kode `notice` hanya dua konstanta, tidak pernah memantulkan input.

## Risiko abuse yang tersisa
- Pemegang kredensial sah dapat memicu resend sampai batas per alamat (5/jam per instance, dikali jumlah instance hangat) lalu batas Supabase/Resend.
- Batas per instance bukan perlindungan global; sebelum skala lebih luas diperlukan batas bersama (penyimpanan bersama atau WAF), yang merupakan perubahan infra dan butuh persetujuan terpisah.
- `loginAction` belum punya pembatasan percobaan kata sandi di cabang ini (ada di PR #141); tebakan kata sandi tetap dibatasi hanya oleh Supabase.

## RISIKO: scanner / prefetch mengonsumsi token (USULAN, belum diterapkan)
`GET /auth/confirm` langsung memanggil `verifyOtp`. Pemindai email atau prefetch dapat membuka tautan dan menghanguskan token, sehingga pengguna melihat tautan "tidak berlaku" padahal akunnya sudah aktif. PR ini hanya memitigasi dampaknya lewat pesan ("jika akun sudah aktif, Anda langsung masuk") dan kirim ulang terikat kata sandi. Mitigasi penyebabnya mengubah alur, jadi TIDAK dilakukan diam-diam:

| Opsi | Cara | Perubahan | Catatan |
|---|---|---|---|
| A (disarankan) | `GET /auth/confirm` menampilkan halaman dengan tombol "Konfirmasi email saya"; `POST` yang memanggil `verifyOtp` | Kode saja; URL di template email tetap | Scanner tidak menekan tombol |
| B | Template email menunjuk ke halaman perantara berbeda | Kode + template dashboard Supabase | Butuh akses dashboard |
| C | Biarkan, andalkan pesan + kirim ulang | Tidak ada | Risiko tetap ada |

Butuh persetujuan khusus Founder sebelum A atau B. Status: USULAN. Jika A dipilih, kirim juga `Referrer-Policy: no-referrer` pada halaman konfirmasi.

## Perlu dicek Founder (UNKNOWN)
`/auth/confirm` kini hanya menerima `type=signup` (sudah demikian di main). Proyek Supabase dipakai bersama umkmpro-ai: pastikan tidak ada template email lain (invite/magiclink/email_change) yang menunjuk ke rute ini.

## Bukti
Tes unit (jsdom/mocks, kelas UNIT/MOCK) untuk pemetaan error berbasis kode, resend hanya setelah kata sandi benar, cooldown dan batas per jam, 429/transport/exception, ketiadaan action anonim, notice, dan UI. Pengiriman email nyata TIDAK diuji di sini (lihat QA-2).
