# QA-2: inbox tetap @qa.tanyopo.com (keputusan Founder: opsi B)

Status: dipilih, BELUM aktif. DNS TIDAK diubah, tidak ada secret/email dibuat atau dikirim. Adapter: `scripts/qa/inbox-adapter.mjs` (kind `resend`, fetch disuntik, hanya GET). Selaras dengan sender-lock #151: hanya satu alamat tunggal persis `@qa.tanyopo.com` (tanpa plus-address, subdomain, homoglyph); domain tidak bisa diperluas lewat deps.

## Perbandingan (ringkas)
| Opsi | Biaya | DNS | Risiko |
|---|---|---|---|
| B. Resend Receiving di qa.tanyopo.com (DIPILIH) | Rp0; email masuk memakai kuota Free | Tambah 1 MX di qa.tanyopo.com | Salah prioritas MX mengganggu surat lain di subdomain itu |
| IMAP ke mailbox QA | UNKNOWN | Mungkin MX | Dependensi klien IMAP, sandi akun penuh |
| API mail pihak ketiga | UNKNOWN | UNKNOWN | Belum diverifikasi |
Opsi alamat `*.resend.app` DIHAPUS (bukan @qa.tanyopo.com).

## Audit read-only (dokumentasi resmi)
- MX: nilai dan prioritas TIDAK tertulis di dokumen; disalin dari halaman domain di dashboard Resend (contoh host: `receive.forge.rmta.net`, `inbound-smtp.<region>.amazonaws.com`). Nilai pasti untuk qa.tanyopo.com: UNKNOWN sampai dashboard dibuka. MX penerimaan harus berprioritas terendah di domain itu. https://resend.com/docs/dashboard/receiving/custom-domains.md
- Bentrok dengan sending: TIDAK. Record sending ada di subdomain `send.<domain>`, "MX records only impact the subdomain they are associated to". Rekomendasi resmi: MX penerimaan di subdomain. Catatan: domain baru setelah Agustus 2026 mungkin memakai CNAME untuk sending (UNKNOWN untuk akun ini). https://www.resend.com/docs/knowledge-base/how-do-i-avoid-conflicting-with-my-mx-records
- Kuota: tiap email masuk dihitung 1 terhadap kuota Free (100/hari, 3000/bulan, sent+received; 3 domain; 10 request/detik per tim; retensi 30 hari). https://resend.com/docs/knowledge-base/account-quotas-and-limits , https://resend.com/pricing.md
- Endpoint: `GET /emails/receiving` (list, `limit/after/before`) dan `GET /emails/receiving/{id}` (html, text, headers) dari SDK resmi (https://docs.rs/crate/resend-rs/0.25.0/source/src/receiving.rs, https://www.mintlify.com/resend/resend-go/api-reference/receiving/list-inbound-emails). Endpoint HAPUS pesan masuk: tidak ditemukan (UNKNOWN); `clear()` hanya menandai pesan lama, tidak menghapus.
- API key: hanya `full_access` (semua resource) dan `sending_access` (hanya kirim); `sending_access` hampir pasti tak bisa membaca penerimaan, key hanya-baca: UNKNOWN. https://resend.com/docs/llms-full.txt . Mitigasi: key khusus QA, simpan hanya sebagai secret Environment QA.
- UNKNOWN lain: format pasti `headers` (adapter menerima objek atau larik) dan apakah memuat Authentication-Results/Received-SPF/DKIM-Signature.

## Langkah Founder dari HP Android (setelah `APPROVE QA-2-INBOX-DNS`)
1. Buka resend.com di browser HP, Domains, qa.tanyopo.com, aktifkan Receiving; salin nilai MX dan prioritas yang ditampilkan.
2. Buka panel DNS tanyopo.com di browser HP; tambah SATU MX pada host `qa` dengan nilai itu. Pastikan prioritas terendah di `qa` dan jangan sentuh record root `tanyopo.com`.
3. Tunggu status Receiving "verified"; lalu buat API key Resend baru untuk QA dan simpan sebagai secret Environment QA (`QA_INBOX_READ_TOKEN`).
Sampai frasa `APPROVE QA-2-INBOX-DNS` diberikan, tidak ada yang diubah; `real-e2e.mjs` tetap exit 3.

## Perilaku adapter
Fail-closed (kind lain = `NOT_IMPLEMENTED`, parameter kosong = `INBOX_MISCONFIGURED`, alamat non-QA = `INBOX_REFUSED`); polling backoff dengan batas percobaan (bawaan 20, maks 60) dan batas waktu; token disamarkan dengan `redact`; tanpa redirect, tanpa membuka tautan/HTML.
