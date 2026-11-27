import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().min(1, "Email wajib diisi").email("Format email tidak valid"),
  password: z.string().min(1, "Kata sandi wajib diisi"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  nama: z.string().trim().min(2, "Nama minimal 2 karakter").max(120),
  namaUsaha: z.string().trim().min(2, "Nama bisnis minimal 2 karakter").max(120),
  email: z.string().trim().min(1, "Email wajib diisi").email("Format email tidak valid"),
  password: z
    .string()
    .min(8, "Kata sandi minimal 8 karakter")
    .max(72, "Kata sandi maksimal 72 karakter"),
  // Explicit acceptance of the Terms & Conditions ONLY. The Privacy Policy is a notice shown separately on the form;
  // it is not accepted through this field. Only the literal `true` passes: a missing, false or any other value is
  // rejected. The browser sends "on" for a checked checkbox, which the action normalises to `true` before parsing.
  // Enforced here (server side) so a direct invocation of registerAction cannot skip it. The field name stays
  // `acceptLegal` (e2e and server contract). Persistence (Paket 3): after signUp the server records TERMS/ACCEPTED
  // (version + server time) via lib/consent/signup-legal.ts, and PRIVACY_NOTICE/DELIVERED only when the form posted
  // the current privacyNoticeVersion. Neither is a PDP consent. The value itself is never stored by this schema.
  acceptLegal: z.literal(true, {
    error: "Anda harus menyetujui Syarat & Ketentuan untuk mendaftar.",
  }),
});

export type RegisterInput = z.infer<typeof registerSchema>;

/**
 * Client-side, no-network format check for the email field (runs when the person leaves the field, not on every
 * keystroke). It only helps the person fix a typo early: the server (registerSchema above, then Supabase Auth) stays
 * the final authority. An empty value returns null here on purpose — "required" is reported on submit, so merely
 * tabbing past the field never shows an error.
 */
export const EMAIL_FORMAT_MESSAGE = "Format email belum benar. Contoh: nama@usaha.com";

export function validateEmailFormat(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return registerSchema.shape.email.safeParse(trimmed).success ? null : EMAIL_FORMAT_MESSAGE;
}

export const forgotPasswordSchema = z.object({
  email: z.string().trim().min(1, "Email wajib diisi").email("Format email tidak valid"),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, "Kata sandi minimal 8 karakter")
      .max(72, "Kata sandi maksimal 72 karakter"),
    confirmPassword: z.string().min(1, "Konfirmasi kata sandi wajib diisi"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Konfirmasi kata sandi tidak sama",
    path: ["confirmPassword"],
  });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
