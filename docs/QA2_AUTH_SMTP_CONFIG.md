# QA-2: Konfigurasi Supabase Auth + SMTP Resend (proyek QA)

**Status: DOKUMEN SAJA. Tidak ada yang diubah di Supabase, Resend, DNS, GitHub, atau Netlify oleh dokumen ini.**
Semua langkah di bawah dilakukan **Founder** dari dashboard, masing-masing butuh frasa persetujuan terpisah. Frasa di kolom "Frasa" adalah USULAN nama; Founder yang menetapkan.

Target: proyek Supabase QA `gasdqsadnjoknisloaec` (`https://gasdqsadnjoknisloaec.supabase.co`). Hanya proyek ini. Jangan sentuh proyek produksi/bersama.

Tujuan alur: signup -> email konfirmasi -> `/auth/confirm` -> `/onboarding`.

## 1. Bukti dari kode (dibaca, bukan dijalankan)
| Fakta | Sumber di repo |
|---|---|
| Signup memakai `supabase.auth.signUp` TANPA `emailRedirectTo`; nama/usaha dikirim di metadata | `features/auth/actions.ts` |
| Tanpa sesi setelah signup = mengandalkan email konfirmasi | `features/auth/actions.ts` |
| `/auth/confirm` memanggil `verifyOtp({ type, token_hash })`, hanya menerima `type=signup`; sukses redirect ke `next`; gagal ke `/login?notice=link_expired` atau `link_invalid` | `app/auth/confirm/route.ts` |
| `next` hanya path internal (selain itu jatuh ke `/dashboard`) | `lib/auth/safe-next.ts` |
| `/auth/confirm` dikecualikan dari gerbang cookie | `proxy.ts` |
| Reset password memakai `redirectTo = {NEXT_PUBLIC_APP_URL}/auth/callback` (bukan jalur signup) | `features/auth/actions.ts` |
| Resend konfirmasi: `auth.resend({ type: "signup" })`, dibatasi 1/menit per alamat di sisi app | `features/auth/actions.ts`, `features/auth/otp-actions.ts` |
| Acuan lokal (QA-1): Site URL `http://localhost:3000`, signup ON, confirmations ON, rate limit email 100 | `qa/supabase-local/supabase/config.toml` |

## 2. Konfigurasi yang DIBUTUHKAN
Kolom "Siapa": semua **Founder** (butuh persetujuan). Status saat ini di proyek QA: **UNKNOWN** untuk semua baris (tidak diperiksa; tidak ada bukti).

| # | Pengaturan | Nilai | Wajib? | Frasa (usulan) |
|---|---|---|---|---|
| A1 | Enable email signup (provider Email) | ON | WAJIB | `APPROVE QA-2-SUPABASE-AUTH-CONFIG` |
| A2 | Confirm email | ON | WAJIB (tanpa ini tidak ada email konfirmasi dan sesi langsung terbit, alur tidak teruji) | sama |
| A3 | Site URL | lihat bagian 4 | WAJIB | sama |
| A4 | Redirect URLs | tambah `http://localhost:3000/auth/callback` (setara config lokal) | OPSIONAL untuk signup (link `/auth/confirm` tidak lewat langkah redirect Supabase); hanya perlu untuk reset password | sama |
| A5 | Template email "Confirm signup" | isi bagian 3 (token_hash ke `/auth/confirm`) | WAJIB | sama |
| A6 | Subjek template | bebas, usul: `Konfirmasi pendaftaran LINOE (QA)` | OPSIONAL | sama |
| A7 | Rate limit email | naikkan dari awal (docs: 30/jam setelah SMTP kustom) ke mis. 100/jam, setara lokal | OPSIONAL (30/jam cukup untuk satu inbox tetap) | sama |
| A8 | Data API | ON (app memakai klien supabase-js ke PostgREST) | WAJIB | sama |
| B1 | Custom SMTP | ON, isi bagian 5 | WAJIB untuk email ke inbox nyata | `APPROVE QA-2-SMTP` (usulan) |
| B2 | Domain pengirim `qa.tanyopo.com` terverifikasi di Resend + DNS SPF/DKIM | terverifikasi | WAJIB sebelum B1 | `APPROVE QA-2-RESEND-DOMAIN` (sudah ada di docs/QA2_REAL_EMAIL_E2E.md) |
| B3 | Password SMTP = API key Resend | diisi langsung di dashboard Supabase | WAJIB, TIDAK dicatat di repo/chat | `APPROVE QA-2-SECRETS` |

Tanpa custom SMTP, bawaan Supabase hanya mengirim ke anggota organisasi proyek dan sekitar 2 pesan/jam (docs; bisa berubah tanpa pemberitahuan), jadi tidak cukup untuk QA-2.

## 3. Template "Confirm signup" (identik dengan qa/supabase-local)
Isi persis sama dengan `qa/supabase-local/supabase/templates/confirm.html`:

```html
<h2>Konfirmasi pendaftaran (QA lokal)</h2>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/onboarding">Konfirmasi email</a></p>
```

Catatan penting:
- `type=signup` HARUS dipakai. Contoh di docs Supabase SSR memakai `type=email`, tetapi `/auth/confirm` repo ini menolak selain `signup` (hasilnya `link_invalid`).
- Link memakai `{{ .SiteURL }}`, jadi host link = Site URL proyek (lihat bagian 4).

## 4. Site URL untuk run CI
- Aplikasi dijalankan lokal di runner, jadi nilai yang cocok adalah `http://localhost:3000` (sama dengan `NEXT_PUBLIC_APP_URL` di workflow).
- Konsekuensi: link di email nyata berbunyi `http://localhost:3000/auth/confirm?...`. Link itu hanya bisa dibuka di mesin runner. Skrip QA harus mengambil link dari inbox lalu membukanya di runner (pola yang sama dengan QA-1). Membuka link itu dari HP Founder akan GAGAL (localhost milik HP).
- Site URL localhost HANYA untuk proyek QA terpisah ini; jangan disalin ke proyek lain.
- Bila suatu saat aplikasi QA di-host publik, Site URL harus diganti ke URL itu (persetujuan terpisah) dan A4 disesuaikan.
- Token konfirmasi sekali pakai dan kedaluwarsa; email lama dari run sebelumnya tidak boleh dipakai ulang.

## 5. Custom SMTP Resend (tanpa password)
| Kolom dashboard | Nilai | Sumber |
|---|---|---|
| Sender email | `noreply@qa.tanyopo.com` (domain harus terverifikasi di Resend) | konvensi repo (`QA_SENDER_EMAIL`) |
| Sender name | `LINOE QA` (usulan) | usulan |
| Host | `smtp.resend.com` | docs Resend |
| Port | `465` (SSL implisit) atau `587` (STARTTLS); keduanya didukung Resend | docs Resend |
| Username | `resend` (nilai tetap) | docs Resend |
| Password | API key Resend. **Tidak ditulis di sini.** Isi sendiri di dashboard. | docs Resend |
| Minimum interval | biarkan bawaan | UNKNOWN nilai bawaan |

Saran (bukan fakta terverifikasi di sini): buat API key Resend khusus QA dengan izin kirim saja.

## 6. Langkah dari HP Android (Chrome, aktifkan "Situs desktop")
Label menu dashboard dapat berubah antar versi: **UNKNOWN**, ikuti nama terdekat.
1. Buka dashboard Supabase, pilih proyek dengan ref `gasdqsadnjoknisloaec` (cek URL; pastikan BUKAN proyek lain).
2. Authentication -> Sign In / Providers -> Email: Enable ON, Confirm email ON, Save. (A1, A2)
3. Authentication -> URL Configuration: Site URL `http://localhost:3000`; tambah Redirect URL (A4); Save. (A3)
4. Authentication -> Email Templates -> Confirm signup: tempel isi bagian 3; Save. (A5, A6)
5. Authentication -> Emails -> SMTP Settings (atau SMTP): aktifkan Custom SMTP, isi bagian 5, password dari Resend; Save. (B1, B3)
6. Authentication -> Rate Limits: atur batas email (A7).
7. Project Settings -> Data API: pastikan aktif (A8).
8. Jangan kirim email uji dari dashboard; QA-2 yang mengirim saat diaktifkan.

## 7. UNKNOWN dan risiko
| Hal | Status |
|---|---|
| Nilai semua pengaturan di proyek QA saat ini | UNKNOWN (tidak diperiksa) |
| Skema/migrasi di proyek QA (mis. trigger `handle_new_user`, tabel onboarding) | UNKNOWN, dokumen QA2_REAL_EMAIL_E2E menyatakan belum diterapkan; onboarding bisa gagal tanpanya |
| Status verifikasi domain `qa.tanyopo.com` di Resend dan DNS | UNKNOWN |
| Nilai bawaan "minimum interval" antar email | UNKNOWN |
| Penyedia inbox tetap | BELUM diputuskan |
| Apakah email Resend masuk inbox (bukan spam) | UNKNOWN sampai diuji, dan SPF/DKIM baru terbukti dari header email nyata |

## 8. Sumber resmi
- Supabase SMTP kustom, batas bawaan, 30/jam: https://supabase.com/docs/guides/auth/auth-smtp
- Supabase password + template token_hash + `/auth/confirm`: https://supabase.com/docs/guides/auth/passwords
- Resend SMTP (host, port, username, password): https://resend.com/docs/send-with-smtp
- Repo: `docs/QA2_REAL_EMAIL_E2E.md`, `qa/supabase-local/supabase/config.toml`
