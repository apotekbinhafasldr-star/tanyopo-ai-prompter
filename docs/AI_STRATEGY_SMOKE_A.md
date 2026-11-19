# AI Strategy smoke, tahap A

**Status: NOT ACTIVATED.** Kode dan workflow sudah ada, tetapi tidak ada key, Environment, atau variabel yang aktif. Tidak ada panggilan AI yang pernah dijalankan oleh dokumen ini.

## Tujuan
Membuktikan SATU hal: penyedia AI menerima skema generasi AI Strategy yang dikirim produk (`CampaignProposalGenerationSchema`, PR #176) dan mengembalikan proposal yang lolos skema simpan. Itu adalah risiko terbuka yang menahan deploy PR #176 ke production.

Yang TIDAK diuji di sini (butuh tahap B): kuota tenant, baris `prompter_ai_jobs`, provenance `ai_job_id`, penyimpanan ke database, Auth, billing.

## Kelas bukti
| Hal | Kelas |
|---|---|
| Harness (satu percobaan, tanpa bocor, kriteria lulus) | UNIT / MOCK (`tests/unit`, di CI, tanpa jaringan) |
| Penyedia menerima skema | REAL, hanya setelah workflow dijalankan manual |
| Quality Gate atas salinan aktif | Informasi saja dalam smoke ini (aturannya sudah diuji UNIT di CI) |

## Apa yang dijalankan
- `lib/ai/smoke/strategy-smoke.ts`: memakai `CampaignProposalGenerationSchema`, `buildSystemPreamble`, `buildCampaignProposalPrompt`, dan `normalizeProposalAdditions` yang SAMA dengan produk. Panggilan lewat adaptor produk (`AnthropicProvider` atau `OpenAIProvider`), yang menserialkan skema Zod ke penyedia. Tidak ada skema tiruan.
- `tests/smoke/ai-strategy.smoke.test.ts`: satu uji nyata. Dijalankan hanya oleh `vitest.smoke.config.ts`, yang tidak pernah dipakai `npm test` maupun CI.
- Produk contoh fiktif ("Kopi Susu Aren Contoh LINOE"). Tidak ada data tenant atau pelanggan.

## Batas
| Batas | Nilai |
|---|---|
| Percobaan | tepat 1. Tanpa retry (`maxRetries: 0`, SDK retry mati), tanpa fallback. Runner sekali pakai |
| Token keluaran | maks. 4.000 (sama dengan bawaan produk) |
| Timeout | 45 detik per percobaan |
| Model | wajib diisi eksplisit, tanpa bawaan, agar biaya dipilih sadar |
| Kredensial | satu: key QA khusus. Run ditolak bila ada variabel produk/produksi (`OPENAI_API_KEY`, `SUPABASE_*`, `PAYMENT_*`, `META_*`, dll.) |
| Biaya | tidak bisa dihitung dari kode (tabel harga model kosong). Batas pasti ada di dashboard penyedia. Biaya tertinggi satu panggilan <= 4.000 token keluaran |

## Kriteria lulus (semua wajib)
1. Tepat 1 percobaan dan tanpa kategori error.
2. Penyedia menerima skema (adaptor tidak melempar).
3. Hasil lolos `CampaignProposalSchema` (skema simpan) setelah `normalizeProposalAdditions`.
4. Tepat 3 kandidat.
5. `objective_recommendation` kosong atau salah satu nilai daftar.
6. Tidak ada angka yang mirip ID minat di `audience.interest_suggestions_text`.
7. `missing_facts` berupa daftar atau kosong.
8. Tidak ada URL, domain, atau nomor telepon di salinan aktif.

Hasil Quality Gate (status, skor, ada tidaknya blokir, kode isu) dicatat sebagai informasi dan tidak menggagalkan smoke: pertanyaan smoke ini adalah penerimaan skema.

## Keamanan log
Laporan hanya berisi boolean, angka, nilai enum, dan KATEGORI error (`AUTH`, `RATE_LIMIT`, `API` + status HTTP, dst.). Tidak pernah: key, pesan error penyedia, teks yang ditulis model. Ringkasan ditulis ke job summary GitHub.

## Aturan workflow (`.github/workflows/qa-ai-strategy-smoke.yml`)
- Hanya `workflow_dispatch`. Tanpa push, pull_request, atau schedule.
- Job jalan bila: dari `main`, variabel repo `AI_SMOKE_ENABLED == 'true'`, dan frasa `RUN-AI-STRATEGY-SMOKE-A` benar.
- Environment GitHub `qa-ai-smoke`. Secret hanya di langkah smoke. Checkout dan `npm ci` tidak menerima secret.
- Action dipin ke SHA penuh. Input lewat env, bukan disisipkan ke skrip shell.
- Tidak menyebut Supabase, Auth, billing, Netlify, Meta, atau Resend.

## Cara pakai dari Android (setelah PR di-merge dan Founder menyetujui tiap langkah)
Tiap langkah menunggu frasa persetujuan terpisah dari Founder. Tidak ada langkah yang dijalankan otomatis.
1. Dashboard penyedia yang SUDAH punya kredit: buat satu key khusus QA di workspace/project terpisah dengan batas pengeluaran rendah. Jangan pakai atau salin key production. Jangan beli kredit atau buat akun baru. Bila belum ada kredit: berhenti (BLOCKER).
2. GitHub (browser Android) > Settings > Environments > New environment `qa-ai-smoke`. Batasi "Deployment branches" ke `main`. Opsional: Required reviewers (Founder).
3. Di Environment itu tambah SATU secret: `QA_AI_SMOKE_ANTHROPIC_API_KEY` atau `QA_AI_SMOKE_OPENAI_API_KEY`, sesuai penyedia yang dipilih.
4. Settings > Secrets and variables > Actions > Variables: `AI_SMOKE_ENABLED` = `true` (mempersenjatai). Setelah selesai, hapus atau set kembali ke bukan `true`.
5. Actions > "QA AI Strategy smoke A" > Run workflow dari `main`: pilih provider, isi ID model persis dari dashboard (jangan menebak), ketik `RUN-AI-STRATEGY-SMOKE-A`.
6. Buka run, lihat job summary: PASS atau FAIL, penyedia, model yang dilaporkan, jumlah token, kategori error bila ada.
7. Selesai: hapus secret dan matikan `AI_SMOKE_ENABLED`. Cabut key QA di dashboard penyedia bila tidak dipakai lagi.

## Bila gagal
Jangan jalankan ulang otomatis. Laporkan kategori error dari summary. `AUTH` = key salah atau tanpa kredit. `INVALID_OUTPUT` atau `API` 400 = penyedia menolak atau tidak bisa memenuhi skema: ini justru temuan yang dicari, dan deploy PR #176 tetap HOLD.

## Tahap B (tidak termasuk di sini)
Kuota, provenance, dan penyimpanan butuh project Supabase QA berskema dan environment aplikasi terpisah. Hanya dipertimbangkan setelah tahap A lulus dan atas persetujuan Founder.
