import { describe, expect, it } from "vitest";
import { mapSignupError } from "@/lib/auth/signup-error";

describe("mapSignupError", () => {
  it("falls back to the generic message when there is no error", () => {
    expect(mapSignupError(null)).toBe("Gagal membuat akun. Silakan coba lagi.");
  });

  it("maps a 5xx / unexpected_failure to a service-disruption message, not the raw internal error", () => {
    // This is the exact shape a real Production failure surfaced: Supabase's
    // signup endpoint returning 500 because the transactional email
    // provider (Resend) rejected the confirmation email — the raw error
    // text names the provider and an internal email address and must never
    // reach the user.
    const result = mapSignupError({ status: 500, code: "unexpected_failure" });
    expect(result).toBe("Layanan pendaftaran sedang mengalami gangguan. Silakan coba lagi dalam beberapa saat.");
    expect(result).not.toMatch(/resend|gomail|smtp/i);
  });

  it("maps a 429 status to a rate-limit message", () => {
    expect(mapSignupError({ status: 429 })).toBe(
      "Terlalu banyak percobaan pendaftaran. Silakan coba lagi dalam beberapa menit.",
    );
  });

  it("maps a rate_limit error code even without a 429 status", () => {
    expect(mapSignupError({ code: "over_email_send_rate_limit" })).toBe(
      "Terlalu banyak percobaan pendaftaran. Silakan coba lagi dalam beberapa menit.",
    );
  });

  it("maps weak_password to a specific, actionable message", () => {
    expect(mapSignupError({ status: 422, code: "weak_password" })).toBe(
      "Kata sandi belum memenuhi syarat keamanan. Gunakan kombinasi yang lebih kuat.",
    );
  });

  it("maps email_address_invalid to a specific message", () => {
    expect(mapSignupError({ status: 400, code: "email_address_invalid" })).toBe(
      "Alamat email tidak valid atau tidak dapat digunakan.",
    );
  });

  it("maps signup_disabled to a specific message", () => {
    expect(mapSignupError({ status: 422, code: "signup_disabled" })).toBe(
      "Pendaftaran akun baru sedang tidak tersedia. Silakan coba lagi nanti.",
    );
  });

  it("falls back to the generic message for an unrecognized error, never guessing", () => {
    expect(mapSignupError({ status: 400, code: "some_future_unknown_code" })).toBe(
      "Gagal membuat akun. Silakan coba lagi.",
    );
  });
});
