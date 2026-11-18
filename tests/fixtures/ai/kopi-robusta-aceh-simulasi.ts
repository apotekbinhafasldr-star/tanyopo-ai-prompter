import { buildProposal } from "./proposal-builder";

/**
 * SCENARIO A — SIMULATED product. Every fact below is fictional by design and
 * exists only to test the quality rubric. It must never be published as a real
 * offer or lead to a transaction.
 */
export const KOPI_ROBUSTA_SIMULASI = {
  isSimulation: true,
  productName: "Kopi Robusta Aceh",
  knownFacts: "Kopi robusta dari Aceh, sangrai medium, kemasan 200 gram. Produk simulasi untuk pengujian, bukan penawaran nyata.",
} as const;

/** A weak, "template-like" proposal: the failure modes the rubric must catch. */
export const KOPI_ROBUSTA_WEAK = buildProposal({
  customer_pain: "Orang butuh kopi.",
  desired_outcome: "Orang membeli kopi.",
  value_proposition: "Solusi terbaik untuk semua pecinta kopi di seluruh Indonesia.",
  positioning: "Kopi terbaik.",
  audience_summary: "Semua orang.",
  marketing_angle: "Kopi enak.",
  creative_concept: "Foto kopi.",
  candidates: [
    {
      hook: "Solusi terbaik untuk pecinta kopi",
      headline: "Kopi Robusta Aceh grade 1 dari 1.200 mdpl",
      cta: "Beli sekarang",
      primary_text:
        "Stok terbatas! Kopi robusta Aceh dijamin laris dan dipercaya 1000 pelanggan. Kunjungi www.kopiaceh.com atau hubungi 0812-3456-7890 hari ini juga.",
      rationale: "Kopi enak.",
    },
    {
      hook: "Solusi terbaik untuk pecinta kopi",
      headline: "Kopi Robusta Aceh grade 1 dari 1.200 mdpl",
      cta: "Beli sekarang",
      primary_text:
        "Stok terbatas! Kopi robusta Aceh dijamin laris dan dipercaya 1000 pelanggan. Kunjungi www.kopiaceh.com atau hubungi 0812-3456-7890 hari ini juga.",
      rationale: "Kopi enak.",
    },
    {
      hook: "Solusi terbaik untuk pecinta kopi",
      headline: "Kopi Robusta Aceh grade 1 dari 1.200 mdpl",
      cta: "Beli sekarang",
      primary_text:
        "Stok terbatas! Kopi robusta Aceh dijamin laris dan dipercaya 1000 pelanggan. Kunjungi www.kopiaceh.com atau hubungi 0812-3456-7890 hari ini juga.",
      rationale: "Kopi enak.",
    },
  ],
  budget_allocation: [{ channel: "INSTAGRAM", percentage: 30, reason: "Populer." }],
});

/**
 * An improved proposal for the same simulated product: only facts that were
 * given, three genuinely different angles, no purchase CTA (it is a simulation).
 */
export const KOPI_ROBUSTA_IMPROVED = buildProposal({
  customer_pain: "Penyuka kopi sering bingung memilih jenis biji yang cocok dengan selera pahit yang kuat.",
  desired_outcome: "Memahami karakter kopi robusta Aceh sebelum memutuskan apakah cocok untuk rutinitas pagi.",
  value_proposition: "Kopi robusta dari Aceh sangrai medium dalam kemasan 200 gram, untuk yang menyukai rasa kuat.",
  positioning: "Kopi robusta Aceh untuk penikmat rasa kuat yang ingin mengenal karakter bijinya.",
  audience_summary: "Penikmat kopi dewasa yang menyeduh sendiri dan menyukai rasa pahit yang tegas.",
  marketing_angle: "Mengenalkan karakter robusta Aceh secara jujur: kuat, pahit, dan sangrai medium.",
  creative_concept: "Foto biji kopi sangrai medium di meja kayu, tanpa klaim angka atau penghargaan.",
  candidates: [
    {
      hook: "Suka kopi yang pahitnya terasa tegas?",
      headline: "Kenali karakter kopi robusta Aceh",
      cta: "Pelajari karakter rasanya",
      primary_text:
        "Kopi robusta dari Aceh dengan sangrai medium ini cocok untuk Anda yang menyukai rasa kuat di pagi hari. Baca penjelasan karakternya dulu sebelum menentukan pilihan.",
      rationale: "Menjawab selera pahit yang kuat.",
    },
    {
      hook: "Kemasan 200 gram untuk dicoba pelan-pelan",
      headline: "Ukuran kemasan yang mudah dihabiskan",
      cta: "Lihat detail produk",
      primary_text:
        "Kemasan 200 gram membuat kopi robusta Aceh ini mudah dikenali tanpa menyimpan terlalu lama di rumah. Lihat detail produk untuk memahami tingkat sangrainya.",
      rationale: "Sudut ukuran kemasan, berdasarkan fakta yang ada.",
    },
    {
      hook: "Dari Aceh ke cangkir Anda",
      headline: "Cerita asal kopi robusta Aceh",
      cta: "Baca cerita kopinya",
      primary_text:
        "Biji robusta dari Aceh disangrai medium agar karakternya tetap terasa. Baca cerita singkat tentang asal kopi ini bagi yang suka mengenal bahan minumannya.",
      rationale: "Sudut asal-usul tanpa menambah klaim.",
    },
  ],
  budget_allocation: [
    { channel: "INSTAGRAM", percentage: 60, reason: "Foto produk dan cerita singkat cocok untuk format visual." },
    { channel: "FACEBOOK", percentage: 40, reason: "Audiens dewasa yang menyeduh kopi di rumah." },
  ],
});
