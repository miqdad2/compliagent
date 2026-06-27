/**
 * Client-facing project stage types and finding classification.
 *
 * Separates the internal `project_status` enum (used in the database) from the
 * human-readable stages shown to clients.  Finding classification drives the
 * exception-based review model: reviewers focus on "requires attention" items
 * while automatically verified items are available for spot-check only.
 */

// ── Client project stages ──────────────────────────────────────────────────────

export type ClientProjectStage =
  | "documents_required"
  | "documents_processing"
  | "ready_for_review"
  | "automated_review_running"
  | "human_verification_required"
  | "ready_for_approval"
  | "ready_for_report"
  | "report_ready"
  | "attention_required";

export const CLIENT_STAGE_LABEL: Record<ClientProjectStage, string> = {
  documents_required:          "Documents required",
  documents_processing:        "Processing documents",
  ready_for_review:            "Ready for automated review",
  automated_review_running:    "Running automated review",
  human_verification_required: "Needs your review",
  ready_for_approval:          "Ready for approval",
  ready_for_report:            "Ready for report",
  report_ready:                "Report ready",
  attention_required:          "Attention required"
};

/** Primary action label shown to the reviewer for each client stage. */
export const CLIENT_STAGE_ACTION: Record<ClientProjectStage, string> = {
  documents_required:          "Upload documents",
  documents_processing:        "View processing status",
  ready_for_review:            "Run automated review",
  automated_review_running:    "View review progress",
  human_verification_required: "Review flagged findings",
  ready_for_approval:          "Approve assessment",
  ready_for_report:            "Generate compliance report",
  report_ready:                "Download compliance report",
  attention_required:          "Review flagged findings"
};

// ── Internal project_status → ClientProjectStage mapping ─────────────────────

export function deriveClientStage(
  projectStatus: string,
  hasSpec: boolean,
  hasSubmission: boolean,
  reviewStatus: string | null
): ClientProjectStage {
  const hasDocuments = hasSpec && hasSubmission;

  if (projectStatus === "archived") return "attention_required";

  if (!hasDocuments) return "documents_required";

  if (projectStatus === "processing") return "documents_processing";

  if (reviewStatus === "running") return "automated_review_running";

  if (reviewStatus === "awaiting_human_review") return "human_verification_required";

  if (reviewStatus === "approved") return "ready_for_report";

  if (hasDocuments && reviewStatus == null) return "ready_for_review";

  if (projectStatus === "ready_for_review") return "ready_for_review";

  return "ready_for_review";
}

// ── Finding classification ─────────────────────────────────────────────────────

/**
 * Statuses considered "automatically verified" — the system has sufficient
 * evidence and no unresolved contradictions.  Reviewers can spot-check these
 * but are not required to action them.
 */
const AUTO_VERIFIED_STATUSES = new Set([
  "complied",
  "exceeds_requirement",
  "not_applicable"
]);

/**
 * Statuses that require reviewer attention before the assessment is complete.
 * Includes ambiguous, not_proven, not_complied, partially_complied, and
 * legacy/error states.
 */
const REQUIRES_ATTENTION_STATUSES = new Set([
  "not_complied",
  "partially_complied",
  "not_proven",
  "ambiguous",
  "ambiguous_not_proven",
  "not_verified"
]);

export type FindingClassification = "auto_verified" | "requires_attention" | "unknown";

export function classifyFinding(status: string): FindingClassification {
  if (AUTO_VERIFIED_STATUSES.has(status)) return "auto_verified";
  if (REQUIRES_ATTENTION_STATUSES.has(status)) return "requires_attention";
  return "unknown";
}

export function countAutoVerified(findings: { status: string }[]): number {
  return findings.filter((f) => classifyFinding(f.status) === "auto_verified").length;
}

export function countRequiresAttention(findings: { status: string }[]): number {
  return findings.filter(
    (f) => classifyFinding(f.status) === "requires_attention" || classifyFinding(f.status) === "unknown"
  ).length;
}

// ── Compliance report scope (documentation only — export not yet implemented) ──

/**
 * Structure of the compliance report produced after human approval.
 * Implementation of report generation is deferred; this documents what the
 * report will contain when implemented.
 */
export const COMPLIANCE_REPORT_SECTIONS = [
  "Executive summary",
  "Project information",
  "Documents reviewed",
  "Review methodology",
  "Overall compliance summary",
  "Clause-by-clause compliance matrix",
  "Items not complied",
  "Items not proven",
  "Ambiguous items",
  "Missing-information schedule",
  "Contractor-action schedule",
  "Standards mapping",
  "Reviewer decisions",
  "Audit trail",
  "Limitations and disclaimer"
] as const;

export type ComplianceReportSection = (typeof COMPLIANCE_REPORT_SECTIONS)[number];

/** Supported output formats for the compliance report (deferred). */
export const COMPLIANCE_REPORT_OUTPUT_FORMATS = ["pdf", "docx", "xlsx_matrix"] as const;
export type ComplianceReportOutputFormat = (typeof COMPLIANCE_REPORT_OUTPUT_FORMATS)[number];
