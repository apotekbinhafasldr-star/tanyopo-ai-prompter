import { describe, expect, it } from "vitest";
import { loginSchema, registerSchema } from "@/schemas/auth";

describe("loginSchema", () => {
  it("accepts a valid email/password pair", () => {
    const result = loginSchema.safeParse({
      email: "owner@usaha.com",
      password: "secret123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid email", () => {
    const result = loginSchema.safeParse({ email: "not-an-email", password: "x" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty password", () => {
    const result = loginSchema.safeParse({ email: "owner@usaha.com", password: "" });
    expect(result.success).toBe(false);
  });
});

describe("registerSchema", () => {
  const valid = {
    nama: "Budi Santoso",
    namaUsaha: "Kopi Nusantara",
    email: "budi@usaha.com",
    password: "supersecret",
  };

  it("accepts valid registration data", () => {
    expect(registerSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a password shorter than 8 characters", () => {
    const result = registerSchema.safeParse({ ...valid, password: "short" });
    expect(result.success).toBe(false);
  });

  it("rejects a business name that is too short", () => {
    const result = registerSchema.safeParse({ ...valid, namaUsaha: "K" });
    expect(result.success).toBe(false);
  });
});
