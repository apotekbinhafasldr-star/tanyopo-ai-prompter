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
  // Explicit acceptance of the Terms and Privacy Policy. Only the literal
  // `true` passes: a missing, false or any other value is rejected. The
  // browser sends "on" for a checked checkbox, which the action normalises
  // to `true` before parsing. Enforced here (server side) so a direct
  // invocation of registerAction cannot skip it. Not persisted anywhere —
  // see the PR description: permanent consent evidence is a separate decision.
  acceptLegal: z.literal(true, {
    error: "Anda harus menyetujui Syarat & Ketentuan dan Kebijakan Privasi untuk mendaftar.",
  }),
});

export type RegisterInput = z.infer<typeof registerSchema>;

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
