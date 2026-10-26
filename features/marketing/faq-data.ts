/**
 * Single source of truth for the landing FAQ. Rendered by sections/faq.tsx AND
 * serialised into FAQPage JSON-LD (lib/seo/json-ld.ts), so the structured data
 * can never drift from what visitors actually see.
 */
export const FAQS = [
  {
    q: "Apa itu LINOE?",
    a: "Tim marketing AI yang membantu memahami produk Anda, menyusun strategi, membuat konten, menyiapkan campaign, menganalisis hasil, dan terus mengoptimasi — dengan Anda tetap memegang kendali penuh.",
  },
  {
    q: "Bisakah saya pakai tanpa UMKMpro AI?",
    a: "Bisa. Integrasi dengan UMKMpro AI sepenuhnya opsional. Anda bisa menambahkan produk secara langsung dan menggunakan seluruh fitur LINOE sebagai bisnis mandiri.",
  },
  {
    q: "Apakah AI mengontrol budget iklan saya?",
    a: "Tidak. AI menyusun rekomendasi budget, tapi Budget Guard membatasi setiap aksi berbayar sesuai batas yang Anda tentukan, dan aksi penting tetap menunggu persetujuan Anda.",
  },
  {
    q: "Platform marketing apa saja yang didukung?",
    a: "Anda dapat menghubungkan akun Facebook, Instagram, TikTok, dan X, serta menyusun strategi untuk website/SEO. Persiapan campaign tersedia. Untuk Meta (Facebook & Instagram), publikasi campaign berbayar masih menunggu persetujuan platform. Untuk TikTok dan X, publikasi campaign masih dalam pengembangan. Status tiap platform selalu ditampilkan apa adanya.",
  },
  {
    q: "Bisakah saya menyetujui campaign sebelum dijalankan?",
    a: "Ya. Setiap campaign berbayar melewati Approval Center — Anda meninjau, mengedit, atau meminta regenerasi sebelum campaign dijalankan.",
  },
  {
    q: "Bisakah bisnis internasional menggunakannya?",
    a: "Ya. Arsitektur Global Edition mendukung banyak bahasa, mata uang, dan zona waktu — target pasar campaign Anda bisa berbeda dari negara asal bisnis Anda.",
  },
];
