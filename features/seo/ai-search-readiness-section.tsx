import { Bot, HelpCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { parseStoredAiSearchReadiness } from "@/lib/seo/ai-search-readiness";
import { buildCustomerJsonLdExport } from "@/lib/seo/customer-json-ld";
import { JsonLdSnippet } from "@/features/seo/structured-data-export";

const FORMAT_LABEL: Record<string, string> = {
  FAQ: "FAQ",
  ARTICLE: "Artikel",
  PRODUCT_PAGE: "Halaman produk",
  SOCIAL_POST: "Postingan",
  PROFILE_BIO: "Bio profil",
};

/**
 * AI Search Readiness (AEO + GEO). Read-only view of what the owner can publish.
 * Honest by design: this is a content plan built from the tenant's own data —
 * LINOE does not measure or guarantee appearing in AI answers.
 */
export function AiSearchReadinessSection({ stored }: { stored: unknown }) {
  const data = parseStoredAiSearchReadiness(stored);
  const jsonLd = data ? buildCustomerJsonLdExport(data) : null;

  return (
    <div className="flex flex-col gap-4" data-testid="ai-search-readiness">
      <div className="flex items-center gap-2">
        <Bot className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold text-foreground">Kesiapan Pencarian AI (AEO &amp; GEO)</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Rencana konten agar bisnis Anda lebih mudah dipahami mesin pencari berbasis AI, disusun dari data yang Anda
        isi di LINOE. LINOE tidak mengukur dan tidak menjamin bisnis Anda muncul atau dikutip di ChatGPT, Gemini,
        Perplexity, atau Google AI Overviews.
      </p>

      {!data ? (
        <Card>
          <CardContent className="p-5 text-sm text-muted-foreground">
            Bagian ini belum dibuat untuk project ini. Klik &quot;Buat ulang&quot; di atas untuk menyusunnya
            (memakai 1 kuota AI, sama seperti rekomendasi biasa).
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Fakta Terverifikasi (dari data Anda)</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 pt-4">
              {data.verified_facts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Belum ada data produk/bisnis. Lengkapi profil brand dan produk agar jawaban bisa dibuat.
                </p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {data.verified_facts.map((f) => (
                    <li key={f.key}>
                      {f.status ? (
                        <Badge variant={f.status === "TERSEDIA" ? "success" : "warning"} className="mr-1.5">
                          {f.status === "TERSEDIA" ? "Tersedia" : f.status === "SEGERA" ? "Segera / rencana" : "Target"}
                        </Badge>
                      ) : null}
                      <span className="text-muted-foreground">{f.label}:</span>{" "}
                      <span className="text-foreground">{f.value}</span>
                    </li>
                  ))}
                </ul>
              )}
              {data.missing_facts.length > 0 ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Perlu dilengkapi:</span>
                  {data.missing_facts.map((m) => (
                    <Badge key={m} variant="warning">
                      {m}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center gap-2 space-y-0">
              <HelpCircle className="size-4 text-muted-foreground" aria-hidden />
              <CardTitle>Pertanyaan Pelanggan &amp; Jawaban Ringkas</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 pt-4">
              {data.customer_questions.map((q, i) => (
                <div key={i} className="rounded-[var(--radius-md)] border border-border p-3">
                  <p className="text-sm font-medium text-foreground">{q.question}</p>
                  {q.short_answer ? (
                    <p className="mt-1 text-xs text-muted-foreground">{q.short_answer}</p>
                  ) : (
                    <p className="mt-1 text-xs text-warning">
                      Belum bisa dijawab dari data Anda. {q.owner_input_needed}
                    </p>
                  )}
                </div>
              ))}
              {data.removed_count > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {data.removed_count} jawaban/saran disembunyikan karena memuat angka atau klaim yang tidak ada di
                  data Anda.
                </p>
              ) : null}
            </CardContent>
          </Card>

          {jsonLd && (jsonLd.faq || jsonLd.product) ? (
            <Card data-testid="structured-data-export">
              <CardHeader>
                <CardTitle>Data Terstruktur (JSON-LD) untuk Website Anda</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 pt-4">
                <p className="text-xs text-muted-foreground">
                  Salin lalu tempel ke halaman website Anda sendiri. Isinya hanya data yang Anda isi di LINOE dan
                  jawaban yang lolos pemeriksaan fakta; tidak ada rating, ulasan, atau ketersediaan stok yang dibuat.
                  Pastikan pertanyaan, jawaban, dan harga yang sama juga tampil di halaman tersebut. Google sudah
                  tidak menampilkan hasil kaya (rich result) FAQ, dan LINOE tidak menjamin ranking atau kutipan oleh AI;
                  ini hanya markup standar schema.org.
                </p>
                {jsonLd.faq ? (
                  <JsonLdSnippet label={`FAQPage (${jsonLd.faq.count} pertanyaan)`} snippet={jsonLd.faq.snippet} />
                ) : null}
                {jsonLd.product ? <JsonLdSnippet label="Product" snippet={jsonLd.product.snippet} /> : null}
              </CardContent>
            </Card>
          ) : null}

          {data.entity_context ? (
            <Card>
              <CardHeader>
                <CardTitle>Konteks Entitas Bisnis</CardTitle>
              </CardHeader>
              <CardContent className="pt-4 text-sm text-foreground">{data.entity_context}</CardContent>
            </Card>
          ) : null}

          {data.content_recommendations.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Rekomendasi Konten</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 pt-4">
                {data.content_recommendations.map((r, i) => (
                  <div key={i} className="rounded-[var(--radius-md)] border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">{r.title}</p>
                      <Badge variant="neutral">{FORMAT_LABEL[r.format] ?? r.format}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{r.reason}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
