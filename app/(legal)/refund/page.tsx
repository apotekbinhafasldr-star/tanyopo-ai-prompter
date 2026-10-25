import Link from "next/link";
import { LegalDocument, LegalList, LegalSection } from "@/features/legal/legal-parts";
import { LEGAL, legalMetadata } from "@/features/legal/legal-meta";

export const metadata = legalMetadata({
  title: "Kebijakan Refund",
  description:
    "Kebijakan pembatalan langganan dan pengembalian dana LINOE by Tanyopo: trial 14 hari, pembatalan perpanjangan, kasus yang dapat diajukan refund, dan cara mengajukan.",
  path: "/refund",
});

const TOC = [
  { id: "ruang-lingkup", title: "Ruang lingkup" },
  { id: "trial", title: "Trial gratis 14 hari" },
  { id: "status", title: "Status pembayaran saat ini" },
  { id: "pembatalan", title: "Membatalkan perpanjangan" },
  { id: "tidak-dikembalikan", title: "Pembayaran yang umumnya tidak dikembalikan" },
  { id: "dapat-diajukan", title: "Kasus yang dapat diajukan" },
  { id: "cara-mengajukan", title: "Cara mengajukan refund" },
  { id: "hak-konsumen", title: "Hak konsumen" },
  { id: "kontak", title: "Kontak" },
];

export default function RefundPage() {
  return (
    <LegalDocument
      title="Kebijakan Refund"
      intro="Halaman ini menjelaskan pembatalan langganan dan pengembalian dana (refund) untuk LINOE. Baca bersama Syarat & Ketentuan."
      toc={TOC}
      current="/refund"
    >
      <LegalSection id="ruang-lingkup" title="1. Ruang lingkup">
        <p>
          Kebijakan ini berlaku untuk pembayaran langganan paket berbayar {LEGAL.product}, yang dikelola oleh{" "}
          {LEGAL.operator}. Kebijakan ini merupakan bagian dari{" "}
          <Link href="/terms" className="font-medium text-brand hover:underline">
            Syarat &amp; Ketentuan
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection id="trial" title="2. Trial gratis 14 hari">
        <LegalList
          items={[
            <>Setiap workspace mendapat satu masa uji coba 14 hari tanpa biaya dan tanpa kartu kredit.</>,
            <>Trial adalah kesempatan mencoba layanan. Trial tidak menggantikan atau mengurangi hak refund Anda pada Kebijakan ini.</>,
          ]}
        />
      </LegalSection>

      <LegalSection id="status" title="3. Status pembayaran saat ini">
        <p>
          Saat ini pembayaran daring di LINOE masih dalam tahap uji coba (sandbox). Belum ada penagihan atau pembayaran
          riil melalui LINOE, sehingga belum ada pembayaran yang dapat dikembalikan. Kebijakan ini berlaku untuk
          pembayaran riil setelah fitur pembayaran diaktifkan dan diumumkan.
        </p>
      </LegalSection>

      <LegalSection id="pembatalan" title="4. Membatalkan perpanjangan">
        <LegalList
          items={[
            <>Bila langganan berbayar tersedia, Anda dapat membatalkan perpanjangan langganan kapan saja.</>,
            <>Setelah dibatalkan, langganan tidak diperpanjang dan akses tetap berlaku sampai akhir periode yang sudah dibayar.</>,
            <>Pembatalan perpanjangan tidak otomatis mengembalikan pembayaran untuk periode yang sedang berjalan.</>,
          ]}
        />
      </LegalSection>

      <LegalSection id="tidak-dikembalikan" title="5. Pembayaran yang umumnya tidak dikembalikan">
        <p>
          Pembayaran langganan yang sudah aktif umumnya tidak dikembalikan hanya karena Anda berubah pikiran atau tidak
          lagi memakai layanan, sepanjang hal itu diperbolehkan oleh hukum yang berlaku.
        </p>
      </LegalSection>

      <LegalSection id="dapat-diajukan" title="6. Kasus yang dapat diajukan">
        <p>Anda dapat mengajukan pemeriksaan dan refund untuk kasus berikut:</p>
        <LegalList
          items={[
            <>Pembayaran ganda untuk periode atau paket yang sama.</>,
            <>Kesalahan penagihan, misalnya jumlah atau paket yang ditagih tidak sesuai dengan yang Anda pilih.</>,
            <>Layanan yang Anda bayar tidak diberikan sesuai ketentuan Syarat &amp; Ketentuan.</>,
          ]}
        />
        <p>
          Pengajuan diperiksa satu per satu. Pengajuan tidak otomatis disetujui, dan hasil pemeriksaan diberitahukan
          kepada Anda.
        </p>
      </LegalSection>

      <LegalSection id="cara-mengajukan" title="7. Cara mengajukan refund">
        <LegalList
          items={[
            <>
              Kirim email ke <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a> dengan subjek “Permohonan
              Refund LINOE”.
            </>,
            <>Sebutkan email akun Anda, tanggal dan jumlah pembayaran, paket yang dibeli, serta alasan pengajuan. Lampirkan bukti pembayaran bila ada.</>,
            <>Kami dapat meminta informasi tambahan untuk memverifikasi pembayaran dan kepemilikan akun.</>,
            <>
              Refund diproses secara manual oleh tim kami. LINOE belum menyediakan fitur refund otomatis. Jika disetujui,
              dana dikembalikan melalui penyedia pembayaran; kami tidak menetapkan jangka waktu pencairan karena
              bergantung pada penyedia pembayaran dan bank Anda.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection id="hak-konsumen" title="8. Hak konsumen">
        <p>
          Kebijakan ini tidak menghapus atau mengurangi hak Anda sebagai konsumen berdasarkan peraturan perundang-undangan
          yang berlaku di Indonesia. Bila ada pertentangan antara Kebijakan ini dan hukum yang berlaku, hukum yang
          berlaku yang diutamakan.
        </p>
      </LegalSection>

      <LegalSection id="kontak" title="9. Kontak">
        <p>
          {LEGAL.operator}, <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>. Lihat juga{" "}
          <Link href="/privacy" className="font-medium text-brand hover:underline">
            Kebijakan Privasi
          </Link>
          .
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
