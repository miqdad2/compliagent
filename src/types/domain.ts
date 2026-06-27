export const userRoles = ["super_admin", "admin", "engineer", "reviewer", "viewer", "contractor"] as const;
export type UserRole = (typeof userRoles)[number];

export const projectStatuses = [
  "draft",
  "documents_uploaded",
  "processing",
  "ready_for_review",
  "ai_review_running",
  "ai_review_completed",
  "human_review_pending",
  "approved",
  "rejected",
  "archived"
] as const;
export type ProjectStatus = (typeof projectStatuses)[number];

export const documentRoles = [
  // Legacy values — retained for backward compatibility.
  "main_specification",
  "proposed_product",
  "manual",
  "compliance_statement",
  // Current controlled-review roles.
  "specification",
  "reference_standard",
  "contractor_submission",
  "product_datasheet",
  "certificate",
  "drawing",
  "calculation",
  "method_statement",
  "test_report",
  "supporting_evidence",
  "correspondence",
  "other"
] as const;
export type DocumentRole = (typeof documentRoles)[number];

/** Roles that indicate a document is a source of requirements. */
export const specificationRoles: DocumentRole[] = ["specification", "main_specification", "reference_standard"];

/** Roles that indicate a document is contractor-submitted evidence. */
export const submissionRoles: DocumentRole[] = [
  "contractor_submission",
  "proposed_product",
  "product_datasheet",
  "certificate",
  "drawing",
  "calculation",
  "method_statement",
  "test_report",
  "supporting_evidence",
  "correspondence",
  "manual",
  "compliance_statement"
];

export const processingStatuses = ["queued", "claimed", "running", "completed", "failed", "cancelled", "retry_wait"] as const;
export type ProcessingStatus = (typeof processingStatuses)[number];

export const complianceStatuses = [
  "complied",
  "partially_complied",
  "not_complied",
  "ambiguous",
  "not_proven",
  "exceeds_requirement",
  "not_applicable",
  "not_verified",
  // Retained for rows created before ambiguous and not_proven became separate states.
  "ambiguous_not_proven"
] as const;
export type ComplianceStatus = (typeof complianceStatuses)[number];

export const riskLevels = ["low", "medium", "high", "critical"] as const;
export type RiskLevel = (typeof riskLevels)[number];

export const humanReviewStatuses = ["accepted", "modified", "rejected", "needs_more_information"] as const;
export type HumanReviewStatus = (typeof humanReviewStatuses)[number];

export type SourceReference = {
  documentName: string;
  pageNumber: number;
  clauseNumber?: string;
  quote: string;
};
