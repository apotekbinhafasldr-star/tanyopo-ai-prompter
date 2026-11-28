import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSessionContext } from "@/services/session";
import { createClient } from "@/lib/supabase/server";
import { isConsentUiEnabled } from "@/lib/consent/flags";
import { LEGAL } from "@/features/legal/legal-meta";
import { PrivacyPage } from "@/features/privacy/privacy-page";
import { buildLegalDocRows } from "@/features/privacy/legal-docs";

export const metadata: Metadata = { title: "Privasi & Data Saya — LINOE" };

interface LegalEventsClient {
  from(table: string): {
    select(columns: string): { eq(column: string, value: string): PromiseLike<{ data: unknown; error: unknown }> };
  };
}

/**
 * Halaman Privasi & Data Saya (Paket 5b). Hanya ada bila CONSENT_UI_ENABLED === "true"; selain itu 404 (identik sebelum paket ini).
 * Sumber dimuat terpisah: persetujuan (di ConsentSection), peristiwa dokumen hukum, zona waktu. Galat satu sumber tidak menjatuhkan yang lain.
 */
export default async function PrivasiPage() {
  if (!isConsentUiEnabled()) notFound();
  const session = await requireSessionContext({ allowIncompleteOnboarding: true });
  const supabase = await createClient();

  let timeZone = "Asia/Jakarta";
  try {
    const { data } = await supabase.from("prompter_brand_profiles").select("default_timezone").eq("tenant_id", session.tenantId).maybeSingle();
    if (data?.default_timezone) timeZone = data.default_timezone;
  } catch {
    // zona waktu bawaan
  }

  let legalRows: unknown = null;
  let legalLoadError = false;
  try {
    const { data, error } = await (supabase as unknown as LegalEventsClient)
      .from("prompter_legal_document_events")
      .select("doc_code, version, event, occurred_at")
      .eq("subject_user_id", session.userId);
    if (error) legalLoadError = true;
    else legalRows = data;
  } catch {
    legalLoadError = true;
  }

  return (
    <PrivacyPage
      role={session.role}
      timeZone={timeZone}
      legalRows={buildLegalDocRows(legalRows, timeZone)}
      legalLoadError={legalLoadError}
      contactEmail={LEGAL.contactEmail}
    />
  );
}
