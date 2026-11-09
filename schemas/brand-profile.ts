import { z } from "zod";

/**
 * Edit Profil Brand (Settings). Semantik "tidak menimpa dengan kosong":
 *  - brandName wajib (min 2) — tidak pernah boleh dikosongkan.
 *  - Field opsional (website, WhatsApp, yang dijual): nilai kosong = TIDAK DIUBAH;
 *    menghapus nilai tersimpan hanya lewat centang "Hapus" eksplisit (clear*).
 */

const MAX_URL = 300;

/** Normalisasi URL: skema http/https saja; tanpa skema → https://. Mengembalikan null bila tidak valid. */
export function normalizeWebsiteUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t || t.length > MAX_URL || /\s/.test(t)) return null;
  let candidate = t;
  if (!/^https?:\/\//i.test(t)) {
    // skema lain (javascript:, data:, ftp://, mailto:, ...) ditolak; "host:port" tanpa // dianggap host
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^(javascript|data|vbscript|mailto|tel|file):/i.test(t)) return null;
    candidate = `https://${t}`;
  }
  let u: URL;
  try {
    u = new URL(candidate);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  if (!u.hostname.includes(".") || u.hostname.startsWith(".") || u.hostname.endsWith(".")) return null;
  const pathless = u.pathname === "/" && !u.search && !u.hash;
  return pathless ? u.origin : u.href;
}

/** Nomor WhatsApp: boleh spasi/tanda hubung/kurung; hasil: digit dengan "+" opsional di depan, 8-15 digit. */
export function normalizeWhatsapp(raw: string): string | null {
  const cleaned = raw.trim().replace(/[\s\-().]/g, "");
  return /^\+?\d{8,15}$/.test(cleaned) ? cleaned : null;
}

const flag = z
  .union([z.literal("on"), z.literal("1"), z.literal("true"), z.literal("")])
  .nullish()
  .transform((v) => !!v);

export const brandProfileSchema = z
  .object({
    brandName: z.string().trim().min(2, "Nama brand minimal 2 karakter").max(120, "Nama brand maksimal 120 karakter"),
    whatDoYouSell: z.string().trim().max(500, "Deskripsi yang dijual maksimal 500 karakter").nullish(),
    websiteUrl: z.string().trim().max(MAX_URL, "URL maksimal 300 karakter").nullish(),
    whatsappNumber: z.string().trim().max(40, "Nomor WhatsApp terlalu panjang").nullish(),
    clearWhatDoYouSell: flag,
    clearWebsiteUrl: flag,
    clearWhatsappNumber: flag,
  })
  .superRefine((v, ctx) => {
    if (v.websiteUrl && !normalizeWebsiteUrl(v.websiteUrl)) {
      ctx.addIssue({ code: "custom", path: ["websiteUrl"], message: "URL tidak valid. Gunakan alamat http:// atau https://, contoh https://tokoanda.id" });
    }
    if (v.whatsappNumber && !normalizeWhatsapp(v.whatsappNumber)) {
      ctx.addIssue({ code: "custom", path: ["whatsappNumber"], message: "Nomor WhatsApp tidak valid. Gunakan 8–15 digit, contoh 08123456789 atau +628123456789" });
    }
  });

export type BrandProfileInput = z.infer<typeof brandProfileSchema>;
