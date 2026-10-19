import Link from "next/link";
import { LegalDocument, LegalList, LegalSection } from "@/features/legal/legal-parts";
import { LEGAL, legalMetadata } from "@/features/legal/legal-meta";
import { isCollectionEnabled } from "@/lib/trial-abuse/config";

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

// The notice describes anti-abuse signal collection only while it is actually switched on
// (TRIAL_ABUSE_MODE), so it must be rendered per request, not frozen at build time.
export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  const abuse = isCollectionEnabled();
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
              <strong>Akun:</strong> email, nama, peran (misalnya Owner), dan pengenal workspace. Akun login dikelola pada
              infrastruktur autentikasi yang sama dengan produk Tanyopo lainnya (lihat bagian 6).
            </>,
            <>
              <strong>Sesi dan keamanan:</strong> sistem autentikasi mencatat sesi login, termasuk alamat IP dan
              informasi perangkat atau peramban. Penyedia hosting dan infrastruktur juga dapat mencatat alamat IP pada
              log teknis mereka. {abuse
                ? "Saat pendaftaran, aplikasi LINOE juga memproses alamat IP untuk perlindungan masa uji coba seperti dijelaskan pada butir berikutnya."
                : "Saat pendaftaran, aplikasi LINOE memakai alamat IP hanya untuk membatasi jumlah percobaan pendaftaran dari satu jaringan; pembatas itu berjalan di memori server dan alamat IP tidak kami simpan pada tabel data LINOE."}
            </>,
            ...(abuse
              ? [
                  <>
                    <strong>Perlindungan masa uji coba:</strong> untuk mencegah penyalahgunaan masa uji coba gratis
                    (pendaftaran berulang), saat pendaftaran server kami membuat kode samaran (pseudonim) satu arah dari
                    email (dinormalkan), alamat IP (dipersempit ke jaringan, bukan alamat lengkap), sebuah cookie acak
                    milik LINOE di peramban Anda, dan sinyal peramban terbatas: zona waktu, bahasa, ukuran layar yang
                    dibulatkan, jumlah inti prosesor, dan jenis sistem operasi. Kami hanya menyimpan kode samaran itu,
                    bukan nilai aslinya, bersama hasil penilaian risiko dan status pendaftaran. Kami tidak memakai
                    pengambilan sidik jari lewat canvas, WebGL, atau audio, tidak melacak Anda di situs lain, dan tidak
                    melakukan identifikasi biometrik. Kode samaran tetap dapat dianggap data pribadi. Sinyal ini bukan
                    bukti identitas seseorang karena perangkat dan jaringan sering dipakai bersama; bila pendaftaran
                    Anda ditahan untuk verifikasi atau ditolak otomatis, Anda dapat meminta peninjauan oleh manusia
                    melalui <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>. Catatan ini disimpan
                    selama 90 hari, lalu dihapus.
                  </>,
                ]
              : []),
            <>
              <strong>Sesi demo:</strong> mode demo memakai cookie sesi bertanda tangan dan mencatat pemakaian AI demo
              per sesi (pengenal sesi dan jumlah pemakaian). Data demo berupa data simulasi dan tidak terhubung ke
              akun, iklan, atau pembayaran nyata.
            </>,
            <>
              <strong>Data yang Anda masukkan:</strong> informasi produk, media atau gambar, brief, kampanye, konten,
              dan pengaturan, termasuk data bisnis dan pemasaran seperti produk, promosi, kampanye, dan
              materi kreatif. Konten bebas yang Anda tulis dapat memuat data pribadi apa pun yang Anda masukkan.
            </>,
            <>
              <strong>Data dari UMKMpro AI:</strong> bila akun Anda juga dipakai di UMKMpro AI, data produk, promosi,
              dan konversi yang tersinkron dari UMKMpro AI dapat muncul di LINOE. Catatan konversi atau pengikut yang
              Anda masukkan secara manual juga kami simpan.
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
              <strong>Langganan, transaksi, dan invoice:</strong> status trial atau langganan, serta catatan transaksi dan
              invoice bila ada.
            </>,
            <>
              <strong>Catatan aktivitas dan keamanan:</strong> catatan tindakan penting di workspace, misalnya
              menghubungkan atau memutus akun, persetujuan, dan kejadian keamanan. Catatan ini dapat memuat teks
              konteks bebas.
            </>,
            <>
              <strong>Cookie:</strong> cookie yang diperlukan untuk menjaga sesi login dan alur keamanan penyambungan
              akun{abuse ? ", serta satu cookie acak (lnx_dv, berlaku sekitar 180 hari) yang dipakai untuk perlindungan masa uji coba dan tidak berisi data pribadi" : ""}.
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
          Saat ini LINOE membantu Anda menyiapkan rencana pemasaran, materi kreatif, dan kampanye. Penayangan iklan
          berbayar otomatis belum tersedia, dan LINOE tidak membelanjakan anggaran iklan atas nama
          Anda. Bila fitur itu nanti tersedia, kebijakan ini akan diperbarui sebelum dipakai.
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
          permintaan penghapusan yang kami proses. Setelah penghapusan, sebagian catatan (misalnya transaksi, invoice, jejak
          keamanan, atau catatan pemakaian) dapat dipertahankan bila diperlukan untuk kewajiban hukum, keuangan, atau
          keamanan yang sah. Kami tidak menjanjikan bahwa semua data dapat dihapus atau dianonimkan secara otomatis;
          penghapusan dilakukan secara manual. Bila
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
