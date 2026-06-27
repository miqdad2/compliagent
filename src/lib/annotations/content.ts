/**
 * Deterministic annotation content templates.
 *
 * Generates concise callout text and full report reasoning from approved
 * finding fields.  Never calls AI — all output is derived from the
 * stored reviewer-approved fields.
 */
import type { ComplianceStatus } from "@/types/domain";

export type AnnotationTextInput = {
  clauseNumber:      string | null;
  subClauseNumber:   string | null;
  status:            ComplianceStatus;
  /** Short (≤ 300 chars) approved reasoning from the reviewer. */
  reasoning:         string;
  /** Approved missing information, if any. */
  missingInformation: string | null;
  /** Approved contractor action, if any. */
  contractorAction:  string | null;
  /** Exact quote from the evidence region. */
  exactQuote:        string | null;
};

export type AnnotationTextOutput = {
  /** Short callout text shown in the annotated PDF — max ~300 chars. */
  calloutText:       string;
  /** Full reasoning for report / inspector view — no length limit. */
  fullReasoning:     string;
  /** Contractor action line for the callout — null if not applicable. */
  actionLine:        string | null;
  /** Status label rendered in the callout header. */
  statusLabel:       string;
  /** Clause reference label. */
  clauseLabel:       string;
};

const STATUS_LABELS: Record<ComplianceStatus, string> = {
  complied:             "COMPLIED",
  exceeds_requirement:  "EXCEEDS REQUIREMENT",
  partially_complied:   "PARTIALLY COMPLIED",
  not_complied:         "NOT COMPLIED",
  ambiguous:            "AMBIGUOUS",
  not_proven:           "NOT PROVEN",
  not_applicable:       "NOT APPLICABLE",
  not_verified:         "NOT VERIFIED",
  ambiguous_not_proven: "AMBIGUOUS / NOT PROVEN"
};

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}

export function generateAnnotationText(input: AnnotationTextInput): AnnotationTextOutput {
  const clauseLabel = [input.clauseNumber, input.subClauseNumber]
    .filter(Boolean)
    .join(" ") || "—";

  const statusLabel = STATUS_LABELS[input.status] ?? input.status.toUpperCase();

  // Callout text: header + short reasoning + optional action.
  const headerLine   = `${clauseLabel} — ${statusLabel}`;
  const reasoningLine = truncate(input.reasoning, 200);

  const calloutLines = [headerLine, "", reasoningLine];

  if (input.missingInformation) {
    calloutLines.push("", `Missing: ${truncate(input.missingInformation, 120)}`);
  }

  const actionLine = input.contractorAction
    ? `Action: ${truncate(input.contractorAction, 150)}`
    : null;

  if (actionLine) {
    calloutLines.push("", actionLine);
  }

  const calloutText = truncate(calloutLines.join("\n"), 500);

  // Full reasoning: no truncation.
  const fullReasoningLines = [
    `${clauseLabel} — ${statusLabel}`,
    "",
    input.reasoning
  ];
  if (input.exactQuote) {
    fullReasoningLines.push("", `Evidence: "${input.exactQuote}"`);
  }
  if (input.missingInformation) {
    fullReasoningLines.push("", `Missing information: ${input.missingInformation}`);
  }
  if (input.contractorAction) {
    fullReasoningLines.push("", `Contractor action: ${input.contractorAction}`);
  }

  return {
    calloutText,
    fullReasoning:  fullReasoningLines.join("\n"),
    actionLine,
    statusLabel,
    clauseLabel
  };
}
