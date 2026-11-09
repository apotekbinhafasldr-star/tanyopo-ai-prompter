import { PLAN_TIERS } from "@/lib/billing/plans";
import { LEGAL } from "@/features/legal/legal-meta";
import { FAQS } from "@/features/marketing/faq-data";
import { PRODUCTION_ORIGIN, getSiteOrigin } from "@/lib/seo/site-url";

/**
 * Fakta PUBLIK LINOE untuk konteks AI — disusun HANYA dari sumber resmi yang sudah tampil
 * di situs: PLAN_TIERS (halaman harga), LEGAL (kontak), FAQS (trial/status platform).
 * Tidak ada angka kuota/limit internal, tidak ada data tenant, tidak ada fitur/harga baru.
 *
 * Status:
 *  - TERSEDIA : sudah berfungsi hari ini.
 *  - SEGERA   : diumumkan tetapi belum aktif (termasuk harga paket berbayar selama
 *               pembayaran online belum aktif).
 *  - TARGET   : angka target/rencana, belum ditetapkan final.
 *
 * ONLINE_PAYMENT_LIVE harus diubah bersamaan dengan persetujuan Founder untuk mengaktifkan
 * pembayaran live; selama false, harga paket berbayar SELALU berlabel rencana.
 */
export const ONLINE_PAYMENT_LIVE = false;

export type LinoeFactStatus = "TERSEDIA" | "SEGERA" | "TARGET";

export interface LinoePublicFact {
  key: string;
  label: string;
  value: string;
  status: LinoeFactStatus;
}

/**
 * Produk Tanyopo lain yang BELUM tersedia. Sumber: instruksi Founder (2026-11-09) — tidak ada halaman/kode resmi
 * yang mendeskripsikannya, jadi hanya status "dalam pengembangan" yang dinyatakan; tidak ada fitur, tanggal, atau
 * harga untuk keduanya. Ubah daftar ini hanya atas persetujuan Founder ketika statusnya berubah.
 */
export const ECOSYSTEM_IN_DEVELOPMENT = ["PUBLOE", "MITAPENG"] as const;

const rupiah = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

function faqAnswer(question: string): string | null {
  return FAQS.find((f) => f.q === question)?.a ?? null;
}

export function buildLinoePublicFacts(): LinoePublicFact[] {
  const facts: LinoePublicFact[] = [];

  const what = faqAnswer("Apa itu LINOE?");
  if (what) facts.push({ key: "linoe_what", label: "Apa itu LINOE", value: what, status: "TERSEDIA" });
  // Target pengguna HANYA dari jawaban FAQ resmi di landing (bukan karangan, bukan klaim baru).
  const audience = faqAnswer("Siapa yang cocok menggunakan LINOE?");
  if (audience) facts.push({ key: "linoe_target_users", label: "Target pengguna LINOE", value: audience, status: "TERSEDIA" });
  facts.push({
    key: "linoe_standalone",
    label: "Kemandirian LINOE",
    value: "LINOE dapat dipakai sebagai bisnis mandiri; integrasi dengan UMKMpro AI bersifat opsional.",
    status: "TERSEDIA",
  });
  facts.push({
    key: "linoe_ecosystem_status",
    label: "Produk Tanyopo lain",
    value: `${ECOSYSTEM_IN_DEVELOPMENT.join(" dan ")} masih dalam pengembangan dan belum tersedia untuk publik; keduanya bukan bagian dari LINOE.`,
    status: "SEGERA",
  });
  facts.push({ key: "linoe_operator", label: "Pengembang LINOE", value: `${LEGAL.operator}, ${LEGAL.location}`, status: "TERSEDIA" });
  facts.push({ key: "linoe_contact", label: "Kontak resmi LINOE", value: `Email ${LEGAL.contactEmail}`, status: "TERSEDIA" });
  facts.push({
    key: "linoe_register",
    label: "Cara mendaftar LINOE",
    value: "Daftar lewat halaman /register; setiap workspace baru mendapat trial gratis 14 hari tanpa kartu kredit.",
    status: "TERSEDIA",
  });

  for (const tier of PLAN_TIERS) {
    if (tier.priceIDR === 0) {
      facts.push({
        key: `linoe_plan_${tier.id.toLowerCase()}`,
        label: `Paket ${tier.name}`,
        value: `Gratis selama ${tier.pricePeriodLabel}. Fitur: ${tier.coreFeatures.join("; ")}.`,
        status: "TERSEDIA",
      });
      continue;
    }
    const price = `${rupiah(tier.priceIDR)}${tier.pricePeriodLabel}`;
    const notOpen = tier.availability !== "ACTIVE";
    const status: LinoeFactStatus = tier.isPriceTarget || notOpen ? "TARGET" : ONLINE_PAYMENT_LIVE ? "TERSEDIA" : "SEGERA";
    const note = tier.isPriceTarget || notOpen
      ? "paket belum dibuka; harga target, belum final"
      : ONLINE_PAYMENT_LIVE
        ? "harga paket"
        : "harga rencana; pembayaran online belum aktif, belum bisa dibeli";
    const feats = !notOpen && tier.coreFeatures.length ? ` Fitur: ${tier.coreFeatures.join("; ")}.` : "";
    const soon = tier.comingSoonFeatures.length ? ` Segera hadir (belum tersedia): ${tier.comingSoonFeatures.join("; ")}.` : "";
    facts.push({
      key: `linoe_plan_${tier.id.toLowerCase()}`,
      label: `Paket ${tier.name}`,
      value: `${price} (${note}).${feats}${soon}`,
      status,
    });
  }

  const platforms = faqAnswer("Platform marketing apa saja yang didukung?");
  if (platforms) facts.push({ key: "linoe_platform_status", label: "Status platform iklan", value: platforms, status: "SEGERA" });
  if (!ONLINE_PAYMENT_LIVE) {
    facts.push({
      key: "linoe_payment_status",
      label: "Status pembayaran online",
      value: "Pembayaran online belum aktif; saat ini belum ada penagihan melalui LINOE.",
      status: "SEGERA",
    });
  }
  return facts;
}

function hostOf(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

const LINOE_NAME = /linoe|tanyopo/i;

/**
 * Fakta LINOE hanya boleh masuk konteks AI bila DUA syarat terpenuhi sekaligus:
 *  1. brand.website_url berhost resmi LINOE (cocok persis; subdomain/host tiruan ditolak), dan
 *  2. brand_name mengandung "LINOE" atau "Tanyopo".
 * product.website_url dan project.website_url SENGAJA bukan pemicu: itu sekadar referensi dan tidak
 * boleh membuat identitas bisnis tenant lain tercampur dengan LINOE.
 * (Fakta ini publik, bukan rahasia. Gerbang yang tidak bisa dipalsukan butuh ID tenant resmi di
 * konfigurasi — keputusan Founder, di luar PR ini.)
 */
export function isLinoeSelfEntity(
  brand: { brand_name?: string | null; website_url?: string | null } | null | undefined,
  env?: Record<string, string | undefined>,
): boolean {
  if (!brand || typeof brand.brand_name !== "string" || !LINOE_NAME.test(brand.brand_name)) return false;
  const host = hostOf(brand.website_url);
  if (!host) return false;
  const own = new Set([hostOf(PRODUCTION_ORIGIN), hostOf(env ? getSiteOrigin(env) : getSiteOrigin())].filter(Boolean) as string[]);
  return own.has(host);
}
