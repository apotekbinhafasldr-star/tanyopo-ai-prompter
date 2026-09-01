import type { ComplianceFlagType } from "@/types/database";

/** Pure constant, safe to import from both server and client code (no
 * "server-only" dependency) — see services/compliance.ts for the actual
 * DB-backed reads/writes. */
export const COMPLIANCE_FLAG_TYPES: ComplianceFlagType[] = [
  "DATA_RESIDENCY",
  "MARKETING_CONSENT",
  "AGE_SENSITIVE_PRODUCT",
  "REGULATED_PRODUCT",
  "PLATFORM_AD_RESTRICTION",
  "TERMS_PRIVACY_LINK",
];
