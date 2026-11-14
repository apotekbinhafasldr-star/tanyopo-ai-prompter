# QA-2 browser driver (inert)

`scripts/qa/real-e2e-driver.mjs` mengimplementasikan antarmuka `driver` untuk `runRealE2E`. Belum dihubungkan ke `main()`.

## Konstruksi (fail-closed, sinkron, tanpa jaringan)
`createRealDriver({ appUrl, qaSupabaseUrl, allowedOrigins, browser?, fetchImpl?, exactAppOrigin?, env?, timeouts? })`
- `appUrl`: localhost/127.0.0.1 (atau origin https yang sama persis dengan `exactAppOrigin`); host produksi/hosting ditolak.
- `qaSupabaseUrl`: persis `https://<ref>.supabase.co`, ref wajib di `ALLOWED_QA_PROJECT_REFS`; `.supabase.com`/ref lain ditolak.
- `allowedOrigins` harus subset {origin aplikasi, origin Supabase QA}.
- Playwright tidak ada di package.json: disuntikkan lewat `browser`, atau diimpor dinamis saat langkah pertama.

## Perilaku
- Browser: `context.route("**/*")` mengabort semua request di luar allowlist (termasuk subresource); service worker diblokir.
- `fetchHop`: satu GET, `redirect:"manual"`, timeout, tanpa retry. Cookie disimpan in-memory untuk hop berikutnya dan
  untuk menyuntik sesi ke browser; tidak pernah dikembalikan/dicatat. Error dibersihkan (tanpa URL, token, password).
- `signup`: maksimal 1 panggilan/driver (dihitung sebelum aksi), 1 klik, satu identitas @qa.tanyopo.com tanpa plus-address.
- `signupDuplicate`: maks 1 panggilan; menolak (`refused-*`, tanpa request) sebelum akun terkonfirmasi, karena Supabase
  mengirim ulang email untuk akun belum terkonfirmasi. Probe inbox orkestrator (langkah 10) tetap yang menilai.
  Setelah konfirmasi, pendaftaran ulang dijalankan di konteks browser BARU tanpa cookie (sesi login membuat `/register` hanya menampilkan
  pemberitahuan "sudah masuk", tanpa form) dengan penyaring origin yang sama; hasil `duplicate`/`check-email` dikenali segera.
- `close()` menutup browser buatan driver dan membuang jar cookie.
- `openDashboard`/`openBilling`/`completeOnboarding`: hanya status/url (tanpa query). Validasi 14 hari bukan tugas driver.
- Driver tidak membaca `process.env`; secret hanya lewat parameter.

## Belum teruji nyata
Selektor UI mengikuti QA-1 (`#nama`, `#email`, "Daftar Gratis", "Lanjut", dst.); perilaku Supabase untuk duplikat
terkonfirmasi dan ketahanan jar cookie dengan `/auth/confirm` nyata baru terbukti saat run QA-2 sebenarnya.
