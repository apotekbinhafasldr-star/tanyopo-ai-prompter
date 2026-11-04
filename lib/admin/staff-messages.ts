/** Fixed result messages for the staff form. The URL carries only a code from this list, never free text. */
export const STAFF_MESSAGES = {
  ok: "Akses staf disimpan.",
  denied: "Tidak diizinkan.",
  rate: "Terlalu sering, coba lagi sebentar.",
  invalid: "Isian tidak valid.",
  config: "Admin Center belum dikonfigurasi.",
  format: "Format email tidak valid.",
  permission: "Ada izin yang tidak boleh diberikan.",
  unregistered: "Akun dengan email itu belum terdaftar. Minta orangnya mendaftar dulu.",
  rules: "Ditolak aturan akses: akun sendiri dan Super Admin tidak bisa diubah, dan izin khusus Founder tidak bisa diberikan.",
  audit: "Log audit gagal ditulis, perubahan dibatalkan.",
  failed: "Perubahan gagal disimpan.",
} as const;
export type StaffMessageCode = keyof typeof STAFF_MESSAGES;
export const isStaffMessageCode = (v: unknown): v is StaffMessageCode => typeof v === "string" && Object.prototype.hasOwnProperty.call(STAFF_MESSAGES, v);
