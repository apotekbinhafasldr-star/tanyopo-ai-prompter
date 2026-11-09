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

const rupiah = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

function faqAnswer(question: string): string | null {
  return FAQS.find((f) => f.q === question)?.a ?? null;
}

export function buildLinoePublicFacts(): LinoePublicFact[] {
  const facts: LinoePublicFact[] = [];

  facts.push({ key: "linoe_operator", label: "Pengembang LINOE", value: `${LEGAL.operator}, ${LEGAL.location}`, status: "TERSEDIA" });
  facts.push({ key: "linoe_contact", label: "Kontak resmi LINOE", value: `Email ${LEGAL.contactEmail}`, status: "TERSEDIA" });
  facts.push({
    key: "linoe_register",
    label: "Cara mendaftar LINOE",
    value: "Daftar lewat halaman /register; setiap workspace baru mendapat trial gratis 14 hari tanpa kartu kredit.",
    status: "TERSEDIA",
  });

  for (const tier of PLAN_TIERS) {
    if (tier.availability !== "ACTIVE") continue;
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
    const status: LinoeFactStatus = tier.isPriceTarget ? "TARGET" : ONLINE_PAYMENT_LIVE ? "TERSEDIA" : "SEGERA";
    const note = tier.isPriceTarget
      ? "harga target, belum final"
      : ONLINE_PAYMENT_LIVE
        ? "harga paket"
        : "harga rencana; pembayaran online belum aktif, belum bisa dibeli";
    const feats = tier.coreFeatures.length ? ` Fitur: ${tier.coreFeatures.join("; ")}.` : "";
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

/**
 * Fakta LINOE hanya boleh masuk konteks AI bila bisnis/produk/project ITU SENDIRI adalah LINOE,
 * dibuktikan dari website yang diisi tenant = host resmi LINOE. Tenant lain tidak pernah menerimanya.
 * (Fakta ini publik, bukan rahasia; gerbang ini mencegah tercampurnya konteks bisnis pelanggan.)
 */
export function isLinoeSelfEntity(websiteUrls: (string | null | undefined)[], env?: Record<string, string | undefined>): boolean {
  const own = new Set([hostOf(PRODUCTION_ORIGIN), hostOf(env ? getSiteOrigin(env) : getSiteOrigin())].filter(Boolean) as string[]);
  return websiteUrls.some((u) => {
    const h = hostOf(u);
    return !!h && own.has(h);
  });
}
