import Link from "next/link";
import { LegalDocument, LegalList, LegalSection } from "@/features/legal/legal-parts";
import { LEGAL, legalMetadata } from "@/features/legal/legal-meta";
import { PLAN_TIERS } from "@/lib/billing/plans";

export const metadata = legalMetadata({
  title: "Syarat & Ketentuan",
  description:
    "Ketentuan penggunaan LINOE by Tanyopo: akun, trial dan paket, koneksi platform iklan, konten AI, pembatasan layanan, dan kontak.",
  path: "/terms",
});

const TOC = [
  { id: "penerimaan", title: "Penerimaan" },
  { id: "layanan", title: "Layanan" },
  { id: "akun", title: "Akun dan kewajiban Anda" },
  { id: "paket", title: "Trial, paket, dan pembayaran" },
  { id: "iklan", title: "Iklan dan platform pihak ketiga" },
  { id: "konten-ai", title: "Konten AI" },
  { id: "kepemilikan", title: "Kepemilikan" },
  { id: "penghentian", title: "Pembatasan dan penghentian" },
  { id: "ketersediaan", title: "Ketersediaan dan hasil" },
  { id: "perubahan", title: "Perubahan dan hukum yang berlaku" },
  { id: "kontak", title: "Kontak" },
];

// Trial limits come from the same source the product enforces/presents, so
// this page cannot drift from lib/billing/plans.ts.
const FREE = PLAN_TIERS.find((tier) => tier.id === "FREE");

export default function TermsPage() {
  return (
    <LegalDocument
      title="Syarat & Ketentuan"
      intro="Ketentuan ini mengatur penggunaan LINOE. Baca bersama Kebijakan Privasi."
      toc={TOC}
      current="/terms"
    >
      <LegalSection id="penerimaan" title="1. Penerimaan">
        <p>
          Dengan membuat akun atau memakai LINOE, Anda menyetujui Syarat ini dan{" "}
          <Link href="/privacy" className="font-medium text-brand hover:underline">
            Kebijakan Privasi
          </Link>
          . {LEGAL.product} dikelola oleh {LEGAL.operator} (<a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>
          ). Jika Anda tidak setuju, jangan memakai layanan.
        </p>
      </LegalSection>

      <LegalSection id="layanan" title="2. Layanan">
        <p>
          LINOE adalah alat bantu pemasaran berbasis AI untuk membuat brief, konten, perencanaan kampanye, SEO, dan
          analitik, serta menghubungkan akun platform iklan atas izin Anda. Fitur dapat berubah, dibatasi, atau
          dinonaktifkan, termasuk batas anggaran dan fitur peluncuran iklan.
        </p>
      </LegalSection>

      <LegalSection id="akun" title="3. Akun dan kewajiban Anda">
        <LegalList
          items={[
            <>Anda cukup umur untuk membuat perjanjian yang mengikat menurut hukum dan memberi data yang benar.</>,
            <>Anda menjaga kerahasiaan kredensial dan bertanggung jawab atas aktivitas akun Anda.</>,
            <>
              Anda memiliki hak atas materi yang diunggah dan tidak melanggar hukum, hak pihak lain, atau kebijakan
              platform.
            </>,
            <>
              Anda tidak menyalahgunakan layanan, termasuk membuat banyak akun untuk menghindari batas trial atau
              kuota, mengganggu keamanan, atau mengakses data workspace lain.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection id="paket" title="4. Trial, paket, dan pembayaran">
        <LegalList
          items={[
            FREE ? (
              <>
                Setiap workspace mendapat satu masa uji coba 14 hari. Paket {FREE.name} dibatasi{" "}
                {FREE.limits.aiUsageAllowance} penggunaan AI, {FREE.limits.maxActiveProducts} produk aktif,{" "}
                {FREE.limits.maxActiveCampaigns} kampanye aktif, dan {FREE.limits.maxUsers} pengguna.
              </>
            ) : (
              <>Setiap workspace mendapat satu masa uji coba 14 hari dengan batas yang tampil di aplikasi.</>
            ),
            <>
              Saat ini pembayaran daring di LINOE masih dalam tahap uji coba (sandbox). Belum ada penagihan atau
              pembayaran riil melalui LINOE. Ketentuan pembayaran akan diperbarui sebelum pembayaran riil diaktifkan.
            </>,
            <>Paket dan harga ditampilkan pada halaman Harga dan di dalam aplikasi, serta dapat berubah.</>,
            <>Pembatalan langganan menghentikan perpanjangan, dan akses berlaku sampai akhir periode berjalan.</>,
            <>
              Kebijakan pembatalan dan pengembalian dana ditetapkan terpisah dan diumumkan sebelum berlaku bagi Anda.
              Sampai diumumkan, Syarat ini tidak menjanjikan pengembalian dana.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection id="iklan" title="5. Iklan dan platform pihak ketiga">
        <p>
          Anda memberi izin kepada LINOE untuk bertindak atas akun Meta, TikTok, atau X yang Anda hubungkan, sebatas
          izin yang Anda berikan dan fitur yang Anda jalankan. Biaya iklan ditagih platform kepada Anda. Anda
          bertanggung jawab atas anggaran, kebijakan platform, dan persetujuan atas setiap kampanye. Kami tidak
          menjamin hasil iklan (jangkauan, penjualan, konversi). Platform dapat berubah, membatasi, atau menolak akun
          atau iklan tanpa tanggung jawab kami. Hanya Owner yang dapat menghubungkan dan memutus koneksi.
        </p>
      </LegalSection>

      <LegalSection id="konten-ai" title="6. Konten AI">
        <p>
          Hasil AI dapat keliru atau tidak lengkap. Anda wajib meninjau setiap konten dan klaim (termasuk klaim
          produk, harga, kesehatan, dan hukum) sebelum dipublikasikan atau dijadikan iklan, dan bertanggung jawab atas
          konten yang Anda gunakan.
        </p>
      </LegalSection>

      <LegalSection id="kepemilikan" title="7. Kepemilikan">
        <p>
          Anda tetap memiliki data dan materi Anda dan memberi kami izin terbatas untuk memprosesnya demi menyediakan
          layanan. LINOE, kode, dan mereknya milik kami dan/atau pemberi lisensi kami.
        </p>
      </LegalSection>

      <LegalSection id="penghentian" title="8. Pembatasan dan penghentian">
        <p>
          Kami dapat membatasi, menangguhkan, atau menghentikan akses bila Anda melanggar Syarat ini, menyalahgunakan
          layanan, atau diwajibkan hukum. Anda dapat berhenti kapan saja. Penghapusan data mengikuti{" "}
          <Link href="/data-deletion" className="font-medium text-brand hover:underline">
            Penghapusan Data
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection id="ketersediaan" title="9. Ketersediaan dan hasil">
        <p>
          Layanan disediakan sebagaimana adanya. Kami tidak menjanjikan tingkat layanan (SLA) tertentu atau hasil bisnis
          tertentu. Tidak ada ketentuan di sini yang meniadakan hak Anda atau tanggung jawab kami yang menurut hukum
          tidak dapat dikecualikan.
        </p>
      </LegalSection>

      <LegalSection id="perubahan" title="10. Perubahan dan hukum yang berlaku">
        <p>
          Perubahan Syarat berlaku setelah diumumkan di halaman ini, dan perubahan penting diberitahukan melalui
          aplikasi atau email. Jika Anda tidak setuju, Anda dapat berhenti memakai layanan. Syarat ini tunduk pada hukum
          Republik Indonesia.
        </p>
      </LegalSection>

      <LegalSection id="kontak" title="11. Kontak">
        <p>
          {LEGAL.operator}, <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
