import Link from "next/link";
import { LegalDocument, LegalList, LegalSection } from "@/features/legal/legal-parts";
import { LEGAL, legalMetadata } from "@/features/legal/legal-meta";

export const metadata = legalMetadata({
  title: "Kebijakan Privasi",
  description:
    "Cara LINOE by Tanyopo memproses data akun dan data bisnis Anda, penyedia pihak ketiga yang terlibat, dan cara mengajukan permintaan terkait data Anda.",
  path: "/privacy",
});

const TOC = [
  { id: "penyelenggara", title: "Penyelenggara" },
  { id: "data", title: "Data yang kami proses" },
  { id: "tujuan", title: "Tujuan pemrosesan" },
  { id: "pihak-ketiga", title: "AI dan pihak ketiga" },
  { id: "platform", title: "Meta, TikTok, dan X" },
  { id: "akun-bersama", title: "Akun bersama lintas produk Tanyopo" },
  { id: "keamanan", title: "Keamanan" },
  { id: "penyimpanan", title: "Penyimpanan data" },
  { id: "hak", title: "Hak Anda" },
  { id: "perubahan", title: "Perubahan kebijakan" },
  { id: "kontak", title: "Kontak" },
];

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Kebijakan Privasi"
      intro="Halaman ini menjelaskan data apa yang diproses LINOE, untuk apa, dan bagaimana Anda dapat mengajukan permintaan terkait data Anda."
      toc={TOC}
      current="/privacy"
    >
      <LegalSection id="penyelenggara" title="1. Penyelenggara">
        <p>
          {LEGAL.product} dikelola oleh <strong>{LEGAL.operator}</strong> (“kami”). Pertanyaan atau permintaan terkait
          data pribadi dapat dikirim ke <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>.
        </p>
      </LegalSection>

      <LegalSection id="data" title="2. Data yang kami proses">
        <LegalList
          items={[
            <>
              <strong>Akun:</strong> email, nama, peran (misalnya Owner), dan pengenal workspace.
            </>,
            <>
              <strong>Sesi dan keamanan:</strong> sistem autentikasi mencatat sesi login, termasuk alamat IP dan
              informasi perangkat atau peramban. Penyedia hosting dan infrastruktur juga dapat mencatat alamat IP pada
              log teknis mereka.
            </>,
            <>
              <strong>Data yang Anda masukkan:</strong> informasi produk, media atau gambar, brief, kampanye, konten,
              dan pengaturan.
            </>,
            <>
              <strong>Masukan dan hasil AI:</strong> teks yang Anda kirim ke fitur AI, hasilnya, dan catatan
              pemakaian (jumlah dan waktu) yang dipakai untuk menghitung kuota.
            </>,
            <>
              <strong>Koneksi platform:</strong> bila Anda menghubungkan Meta, TikTok, atau X: pengenal akun, izin
              yang diberikan, token akses (disimpan dalam bentuk terenkripsi), dan data kinerja iklan yang diizinkan.
            </>,
            <>
              <strong>Langganan dan transaksi:</strong> status trial atau langganan, serta catatan transaksi bila ada.
            </>,
            <>
              <strong>Catatan aktivitas:</strong> catatan tindakan penting di workspace, misalnya menghubungkan atau
              memutus akun.
            </>,
            <>
              <strong>Cookie:</strong> cookie yang diperlukan untuk menjaga sesi login dan alur keamanan penyambungan
              akun.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection id="tujuan" title="3. Tujuan pemrosesan">
        <p>
          Kami memproses data untuk menyediakan dan mengamankan layanan yang Anda minta, menjalankan fitur AI dan
          koneksi platform atas perintah Anda, mengelola trial dan kuota, mencegah penyalahgunaan, memenuhi kewajiban
          hukum, dan menanggapi permintaan Anda.
        </p>
      </LegalSection>

      <LegalSection id="pihak-ketiga" title="4. AI dan pihak ketiga">
        <LegalList
          items={[
            <>
              Saat Anda memakai fitur AI, masukan Anda dikirim ke penyedia model AI yang kami gunakan (dapat berupa
              OpenAI atau Anthropic). Pemrosesan di sana tunduk pada ketentuan penyedia tersebut. Jangan memasukkan data
              pribadi pihak lain atau data sensitif yang tidak diperlukan.
            </>,
            <>
              Kami memakai Netlify (hosting aplikasi), Supabase (basis data, autentikasi, dan penyimpanan berkas), serta
              layanan pengiriman email. Data dapat diproses di sistem penyedia tersebut.
            </>,
            <>Kami tidak dapat menjamin bahwa data yang sudah diteruskan ke pihak ketiga dihapus dari sistem mereka.</>,
            <>
              Bila pembayaran daring tersedia bagi Anda, data transaksi dapat diproses melalui penyedia pembayaran.
              Penyedia yang digunakan akan dicantumkan pada kebijakan ini.
            </>,
          ]}
        />
      </LegalSection>

      <LegalSection id="platform" title="5. Meta, TikTok, dan X">
        <p>
          Koneksi dibuat hanya atas tindakan Owner dan dapat diputus oleh Owner dari halaman Koneksi. Izin yang kami
          minta saat ini: Meta (<code>ads_management</code>, <code>ads_read</code>, <code>business_management</code>,{" "}
          <code>pages_show_list</code>); X (<code>ads.read</code>, <code>ads.write</code>, <code>offline.access</code>
          ); TikTok (izin yang tampil pada layar persetujuan TikTok). Data dari platform digunakan untuk menyediakan
          fitur LINOE yang Anda jalankan.
        </p>
        <p>
          Saat koneksi diputus, kami menghapus token dari sistem kami dan mencoba mencabutnya di platform. Jika
          pencabutan gagal, cabut izin aplikasi dari pengaturan akun platform Anda. Data kinerja yang sudah diimpor
          sebelumnya tidak otomatis terhapus saat koneksi diputus. Lihat{" "}
          <Link href="/data-deletion" className="font-medium text-brand hover:underline">
            Penghapusan Data
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection id="akun-bersama" title="6. Akun bersama lintas produk Tanyopo">
        <p>
          Akun login Anda dapat dipakai bersama oleh produk Tanyopo lainnya. Karena itu data akun login dan profil
          dasar dikelola bersama dan tidak otomatis terhapus ketika data LINOE dihapus. Lihat{" "}
          <Link href="/data-deletion" className="font-medium text-brand hover:underline">
            Penghapusan Data
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection id="keamanan" title="7. Keamanan">
        <p>
          Kami berupaya menerapkan langkah teknis dan organisasi yang wajar untuk melindungi data. Tidak ada sistem yang
          bebas risiko, dan kami tidak dapat menjamin keamanan mutlak.
        </p>
      </LegalSection>

      <LegalSection id="penyimpanan" title="8. Penyimpanan data">
        <p>
          Kami belum menetapkan jangka retensi tetap. Saat ini data disimpan selama workspace aktif dan sampai ada
          permintaan penghapusan yang kami proses. Setelah penghapusan, sebagian catatan (misalnya transaksi, jejak
          keamanan, atau catatan pemakaian) dapat dipertahankan atau dianonimkan bila ada alasan teknis atau hukum. Bila
          kami membuat cadangan, cadangan itu dapat masih memuat data yang sudah dihapus sampai cadangan tersebut
          diganti.
        </p>
      </LegalSection>

      <LegalSection id="hak" title="9. Hak Anda">
        <p>
          Anda dapat mengajukan permintaan akses, koreksi, atau penghapusan data pribadi, atau menarik persetujuan yang
          pernah diberikan, melalui <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>. Hak-hak ini dan
          tenggat penanganannya tunduk pada hukum yang berlaku di Indonesia, dan kami menanggapi permintaan sesuai
          ketentuan tersebut. Kami dapat menolak atau membatasi sebagian permintaan bila ada alasan hukum, dengan
          penjelasan. Tata cara penghapusan data ada di{" "}
          <Link href="/data-deletion" className="font-medium text-brand hover:underline">
            Penghapusan Data
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection id="perubahan" title="10. Perubahan kebijakan">
        <p>
          Perubahan kebijakan berlaku setelah diumumkan di halaman ini. Perubahan penting juga diberitahukan melalui
          aplikasi atau email.
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
