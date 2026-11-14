# QA-2: opsi kotak masuk tetap (ringkasan keputusan)

Status: REKOMENDASI, belum aktif. Tidak ada DNS/secret/email yang diubah atau dikirim. Adapter: `scripts/qa/inbox-adapter.mjs` (kind `resend`, fetch disuntik, hanya GET).

## Perbandingan
| Opsi | Biaya | DNS | Kerja Founder dari HP | Risiko |
|---|---|---|---|---|
| A. Resend Receiving, alamat `<id>.resend.app` | Rp0; tiap email masuk memakai kuota 100/hari, 3000/bulan | Tidak ada | Buat API key baca, salin alamat dari tab Receiving | Menyimpang dari alamat @qa.tanyopo.com (adapter perlu `allowedDomains` eksplisit) |
| B. Resend Receiving, subdomain `qa.tanyopo.com` | Rp0, kuota sama | Tambah MX (butuh persetujuan Founder). Nilai MX: UNKNOWN (tidak tertulis di halaman yang dibaca) | Tambah MX di panel DNS lewat browser HP | Salah MX dapat mengganggu surat lain di subdomain itu; kuota sent+received berbagi |
| C. IMAP ke satu mailbox QA | Tergantung hosting mailbox (UNKNOWN) | Mungkin MX | Buat mailbox + sandi aplikasi | Perlu klien IMAP (dependensi baru), sandi penuh akun, tidak ada di Node bawaan |
| D. API mail lain (Mailpit/mail.tm dsb) | UNKNOWN | UNKNOWN | Akun pihak ketiga baru | Belum diverifikasi; pihak ketiga memegang email |

## Rekomendasi: satu opsi, Resend Receiving (B, dengan A sebagai jalan tanpa DNS)
Alasan: pengirim QA sudah Resend; tanpa dependensi npm; satu token baca; alamat tetap tanpa membuat email baru. Mulai dari A bila Founder belum mau mengubah DNS; pindah ke B hanya dengan persetujuan DNS.

## Fakta terverifikasi (dokumentasi resmi)
- Penerimaan di domain terverifikasi (butuh MX) atau `<id>.resend.app` tanpa DNS: https://resend.com/docs/dashboard/receiving/introduction.md
- Email masuk dihitung 1 email terhadap kuota harian/bulanan; Free: 100/hari, 3000/bulan, 3 domain, 10 request/detik per tim, retensi 30 hari: https://resend.com/pricing.md , https://resend.com/docs/knowledge-base/account-quotas-and-limits
- Endpoint baca `GET /emails/receiving` dan `GET /emails/receiving/{id}` (html, text, headers) terbaca dari SDK resmi resend-rs: https://docs.rs/crate/resend-rs/0.25.0/source/src/receiving.rs ; param `limit/after/before` dari SDK Go: https://www.mintlify.com/resend/resend-go/api-reference/receiving/list-inbound-emails

## UNKNOWN (belum terverifikasi)
- Nilai/nama MX untuk `qa.tanyopo.com` dan apakah bentrok dengan MX pengiriman yang ada.
- Endpoint hapus pesan masuk: tidak ditemukan. Maka `clear()` TIDAK menghapus; ia menandai pesan yang sudah ada dan hanya pesan setelahnya yang dikembalikan.
- Format pasti `headers` (objek vs larik; adapter menerima keduanya) dan apakah memuat Authentication-Results/Received-SPF/DKIM-Signature.
- Param query REST resmi (`limit/after`) dan ketersediaan alamat resend.app di akun Free.

## Perilaku adapter
- Fail-closed: kind selain `resend` = `NOT_IMPLEMENTED: provider not chosen`; token/alamat/fetch kosong = `INBOX_MISCONFIGURED`.
- Alamat wajib di `qa.tanyopo.com` (daftar `allowedDomains` eksplisit); `clear({address})` menolak alamat lain; pesan alamat lain tidak disentuh.
- Polling dengan backoff eksponensial, batas percobaan (bawaan 20, maks 60) dan batas waktu; tanpa busy loop.
- Token dari `QA_INBOX_READ_TOKEN` hanya lewat parameter, disamarkan dengan `redact`; tanpa redirect, tanpa membuka tautan atau HTML.

## Persetujuan Founder yang dibutuhkan
1. `APPROVE QA-2-INBOX` dengan pilihan A atau B. 2. (B saja) persetujuan perubahan DNS MX. 3. API key Resend untuk Environment QA, cakupan sekecil mungkin (apakah ada key hanya-baca untuk penerimaan: UNKNOWN); tidak dibuat di sini.
