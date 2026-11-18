import { Badge } from "@/components/ui/badge";
import { EVIDENCE_TEXT, type EvidenceKind } from "@/lib/campaigns/evidence";

const VARIANT = { AI: "info", RULE: "neutral", HEURISTIC: "warning", PLATFORM: "success" } as const;

/** Small text badge saying where a section's content comes from (text, not colour alone). */
export function EvidenceLabel({ kind }: { kind: EvidenceKind }) {
  const t = EVIDENCE_TEXT[kind];
  return (
    <Badge variant={VARIANT[kind]} title={t.hint} data-testid={`evidence-${kind.toLowerCase()}`}>
      {t.label}
    </Badge>
  );
}
