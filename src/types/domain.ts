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
  "main_specification",
  "reference_standard",
  "proposed_product",
  "product_datasheet",
  "certificate",
  "drawing",
  "manual",
  "compliance_statement",
  "supporting_evidence",
  "other"
] as const;
export type DocumentRole = (typeof documentRoles)[number];

export const processingStatuses = ["queued", "running", "completed", "failed", "cancelled"] as const;
export type ProcessingStatus = (typeof processingStatuses)[number];

export const complianceStatuses = [
  "complied",
  "partially_complied",
  "not_complied",
  "ambiguous_not_proven",
  "not_applicable",
  "not_verified"
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
