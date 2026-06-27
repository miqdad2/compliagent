import { Badge } from "@/components/ui/badge";
import type { ConfidenceFlag } from "@/lib/ai/review-schemas";

const FLAG_LABELS: Partial<Record<ConfidenceFlag, string>> = {
  LOW_EXTRACTION_CONFIDENCE:    "Low Extraction",
  LOW_REQUIREMENT_CONFIDENCE:   "Low Requirement",
  LOW_RETRIEVAL_CONFIDENCE:     "Low Retrieval",
  LOW_COMPARISON_CONFIDENCE:    "Low Comparison",
  VERIFIER_DISAGREEMENT:        "Verifier Disagreement",
  CITATION_FAILURE:             "Citation Failure",
  MODEL_IDENTITY_UNCERTAIN:     "Model Uncertain",
  UNIT_COMPATIBILITY_UNCERTAIN: "Unit Uncertain",
  MISSING_DIRECT_EVIDENCE:      "No Direct Evidence",
  AI_COMPARISON_USED:           "AI Compared",
  AI_RERANKING_USED:            "AI Reranked",
  DETERMINISTIC_FALLBACK_USED:  "Deterministic",
  REPAIR_ATTEMPTED:             "Output Repaired",
  PROVIDER_TIMEOUT:             "Timeout",
  CONSENT_BLOCKED:              "Consent Blocked"
};

export function ConfidenceFlagBadge({ flag }: { flag: ConfidenceFlag }) {
  const label = FLAG_LABELS[flag] ?? flag;
  const isWarning = [
    "VERIFIER_DISAGREEMENT", "CITATION_FAILURE", "LOW_COMPARISON_CONFIDENCE",
    "MISSING_DIRECT_EVIDENCE", "UNIT_COMPATIBILITY_UNCERTAIN", "PROVIDER_TIMEOUT"
  ].includes(flag);
  return <Badge tone={isWarning ? "red" : "gray"}>{label}</Badge>;
}

export function ConfidenceFlagList({ flags }: { flags: ConfidenceFlag[] }) {
  if (flags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((flag) => <ConfidenceFlagBadge key={flag} flag={flag} />)}
    </div>
  );
}
